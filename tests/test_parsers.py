"""
Unit tests for the regex-driven parsing logic in app.py.

These are the highest-value tests in the suite: the app's correctness
almost entirely rides on these regexes staying correct as bank statement
layouts get tweaked, and a broken regex fails *silently* (it just matches
nothing, or matches the wrong groups) rather than raising — exactly the
kind of bug that's easy to ship without tests.
"""
import pytest

import app
from conftest import MAYBANK_LINES, RHB_LINES, RHB_ACCOUNT_SUMMARY_LINE


# ================================================================
#  MAYBANK PARSER
# ================================================================

class TestMaybankTxnHeaderRegex:
    def test_matches_debit_line(self):
        m = app.MB_TXN_HEADER.match(
            "05/01 IBK FUND TRANSFER          150.00-                          850.00"
        )
        assert m is not None
        assert m.groups() == ("05/01", "IBK FUND TRANSFER", "150.00-", "850.00")

    def test_matches_credit_line(self):
        m = app.MB_TXN_HEADER.match(
            "12/01 SALARY                   3,000.00+                        3,850.00"
        )
        assert m is not None
        assert m.groups() == ("12/01", "SALARY", "3,000.00+", "3,850.00")

    def test_does_not_match_beginning_balance_line(self):
        # Only one amount present — should NOT be treated as a transaction
        m = app.MB_TXN_HEADER.match(
            "01/01                 BEGINNING BALANCE                          1,000.00"
        )
        assert m is None

    def test_does_not_match_ending_balance_line(self):
        m = app.MB_TXN_HEADER.match(
            "31/01                 ENDING BALANCE  :                         3,862.34"
        )
        assert m is None

    def test_does_not_match_plain_detail_line(self):
        m = app.MB_TXN_HEADER.match("AHMAD BIN ALI")
        assert m is None


class TestMaybankMetadata:
    def test_extracts_all_known_fields(self):
        meta = app._mb_extract_metadata([
            "01/01 BEGINNING BALANCE 1,000.00",
            "31/01 ENDING BALANCE : 3,862.34",
            "LEDGER BALANCE : 3,862.34",
            "TOTAL DEBIT : 150.00",
            "TOTAL CREDIT : 3,012.34",
        ])
        assert meta == {
            "beginning_balance": "1,000.00",
            "ending_balance": "3,862.34",
            "ledger_balance": "3,862.34",
            "total_debit": "150.00",
            "total_credit": "3,012.34",
        }

    def test_missing_fields_are_absent_not_none(self):
        meta = app._mb_extract_metadata(["nothing relevant here"])
        assert meta == {}


class TestMaybankTransactionParsing:
    def test_full_statement_parses_expected_transaction_count(self):
        result = app.parse_maybank(MAYBANK_LINES)
        assert result["bank"] == "Maybank"
        assert len(result["transactions"]) == 3

    def test_debit_and_credit_amounts_preserved_with_sign_suffix(self):
        result = app.parse_maybank(MAYBANK_LINES)
        by_type = {t["type"]: t for t in result["transactions"]}
        assert by_type["IBK FUND TRANSFER"]["amount"] == "150.00-"
        assert by_type["SALARY"]["amount"] == "3,000.00+"

    def test_details_split_into_name_reference_method(self):
        result = app.parse_maybank(MAYBANK_LINES)
        txn = next(t for t in result["transactions"] if t["type"] == "SALARY")
        assert txn["details"] == {
            "name": "EMPLOYER SDN BHD",
            "reference": "REF00098765",
            "method": "SALARY",
        }

    def test_dividend_paid_lines_have_no_details_collected(self):
        # _mb_parse_transactions explicitly excludes detail lines that follow
        # a "DIVIDEND PAID" header — this is a deliberate quirk of the
        # source format, not a bug, so we pin it down with a test.
        result = app.parse_maybank(MAYBANK_LINES)
        txn = next(t for t in result["transactions"] if t["type"] == "DIVIDEND PAID")
        assert txn["details"] == {"name": None, "reference": None, "method": None}

    def test_statement_metadata_included(self):
        result = app.parse_maybank(MAYBANK_LINES)
        assert result["statement"]["total_debit"] == "150.00"
        assert result["statement"]["total_credit"] == "3,012.34"

    def test_statement_year_extracted_from_header(self):
        result = app.parse_maybank(MAYBANK_LINES)
        assert result["statement"]["statement_year"] == "2026"

    def test_empty_input_yields_no_transactions(self):
        result = app.parse_maybank([])
        assert result["transactions"] == []


# ================================================================
#  RHB PARSER
# ================================================================

class TestRhbTxnRegex:
    def test_matches_line_with_serial_number(self):
        m = app.RHB_TXN.match("29Mar DMBASNBDR 003 120.00 1,545.91")
        assert m is not None
        assert m.groups() == ("29Mar", "DMBASNBDR", "003", "120.00", "1,545.91")

    def test_matches_line_without_serial_number(self):
        m = app.RHB_TXN.match("31Jan PROFITCREDIT      0.35 1,666.67")
        assert m is not None
        date, desc, serial, amount, bal = m.groups()
        assert (date, desc, serial, amount, bal) == (
            "31Jan", "PROFITCREDIT", None, "0.35", "1,666.67"
        )

    def test_does_not_match_balance_line(self):
        assert app.RHB_TXN.match("01Jan B/FBALANCE 1,666.32") is None


class TestRhbBalanceRegex:
    def test_matches_opening_balance(self):
        m = app.RHB_BAL.match("01Jan B/FBALANCE 1,666.32")
        assert m is not None
        assert m.groups() == ("01Jan", "B/FBALANCE", "1,666.32")

    def test_matches_closing_balance(self):
        m = app.RHB_BAL.match("31Jan C/FBALANCE 1,546.26")
        assert m is not None
        assert m.group(2) == "C/FBALANCE"


class TestRhbAccountSummaryRegex:
    def test_extracts_account_and_balances(self):
        m = app.RHB_ACCT_SUMMARY.search(RHB_ACCOUNT_SUMMARY_LINE)
        assert m is not None
        assert m.groups() == ("15603500121285", "1,666.32", "1,546.26", "1.02")


class TestRhbClassifyAmount:
    """This is the highest-risk piece of logic in the app (see bug #1 in
    prior review): debit/credit was originally inferred purely from whether
    the balance went up or down, which is fragile. These tests pin down the
    keyword-first, balance-fallback behaviour."""

    def test_keyword_debit_takes_priority_even_if_balance_looks_like_credit(self):
        # Balance went UP (1000 -> 1100), which naively looks like a credit,
        # but the description contains a known debit keyword — that should win.
        debit, credit, conflict = app._rhb_classify_amount(
            "DMBASNBDR", "1000.00", "1100.00", "50.00"
        )
        assert debit == "50.00"
        assert credit is None
        assert conflict is True  # signals disagree — flagged, not hidden

    def test_keyword_credit_takes_priority_even_if_balance_looks_like_debit(self):
        debit, credit, conflict = app._rhb_classify_amount(
            "PROFITCREDIT", "1000.00", "900.00", "0.35"
        )
        assert credit == "0.35"
        assert debit is None
        assert conflict is True

    def test_falls_back_to_balance_diff_when_no_keyword_matches(self):
        debit, credit, conflict = app._rhb_classify_amount(
            "UNKNOWN MERCHANT", "1000.00", "900.00", "100.00"
        )
        assert debit == "100.00"
        assert credit is None
        assert conflict is False

    def test_falls_back_to_balance_diff_for_credit(self):
        debit, credit, conflict = app._rhb_classify_amount(
            "UNKNOWN MERCHANT", "1000.00", "1100.00", "100.00"
        )
        assert credit == "100.00"
        assert debit is None
        assert conflict is False

    def test_no_conflict_when_keyword_and_balance_agree(self):
        debit, credit, conflict = app._rhb_classify_amount(
            "DMBASNBDR", "1000.00", "900.00", "100.00"
        )
        assert debit == "100.00"
        assert conflict is False

    def test_malformed_balance_does_not_crash_and_keyword_still_wins(self):
        debit, credit, conflict = app._rhb_classify_amount(
            "DMBASNBDR", "not-a-number", "also-not-a-number", "100.00"
        )
        assert debit == "100.00"
        assert credit is None
        assert conflict is False  # balance signal unavailable, so no conflict


class TestRhbTransactionParsing:
    def test_full_statement_parses_expected_transaction_count(self):
        result = app.parse_rhb(RHB_LINES)
        assert result["bank"] == "RHB Islamic Bank"
        assert len(result["transactions"]) == 2

    def test_reference_number_lines_are_skipped(self):
        result = app.parse_rhb(RHB_LINES)
        descriptions = [t["description"] for t in result["transactions"]]
        assert "040309100357" not in descriptions

    def test_balance_lines_are_not_treated_as_transactions(self):
        result = app.parse_rhb(RHB_LINES)
        descriptions = [t["description"] for t in result["transactions"]]
        assert "B/FBALANCE" not in descriptions
        assert "C/FBALANCE" not in descriptions

    def test_account_metadata_extracted(self):
        result = app.parse_rhb(RHB_LINES)
        assert result["statement"]["account_number"] == "15603500121285"
        assert result["statement"]["opening_balance"] == "1,666.32"

    def test_statement_year_extracted_from_header(self):
        result = app.parse_rhb(RHB_LINES)
        assert result["statement"]["statement_year"] == "2026"

    def test_page2_commodity_notice_lines_are_excluded(self):
        lines_with_page2 = RHB_LINES + [
            app.RHB_PAGE2_START,
            "29Mar SHOULDNOTPARSE 003 999.00 1.00",
        ]
        result = app.parse_rhb(lines_with_page2)
        descriptions = [t["description"] for t in result["transactions"]]
        assert "SHOULDNOTPARSE" not in descriptions

    def test_empty_input_yields_no_transactions(self):
        result = app.parse_rhb([])
        assert result["transactions"] == []


# ================================================================
#  BANK DETECTION
# ================================================================

class TestDetectBank:
    def test_detects_maybank(self):
        assert app.detect_bank(MAYBANK_LINES) == "maybank"

    def test_detects_rhb(self):
        assert app.detect_bank(RHB_LINES) == "rhb"

    def test_unknown_format_returns_unknown(self):
        assert app.detect_bank(["SOME OTHER BANK", "STATEMENT"]) == "unknown"

    def test_detection_only_looks_at_header_lines(self):
        # A stray mention of "maybank" deep in the transaction body (e.g. an
        # inter-bank transfer description) shouldn't cause misdetection of
        # an RHB statement — only the first few header lines are checked.
        lines = RHB_LINES + ["TRANSFER TO MAYBANK ACCOUNT"]
        assert app.detect_bank(lines) == "rhb"


# ================================================================
#  STATEMENT YEAR EXTRACTION
# ================================================================

class TestExtractStatementYear:
    def test_extracts_year_from_slash_date(self):
        assert app._extract_statement_year(["STATEMENT DATE : 31/01/2026"]) == "2026"

    def test_extracts_year_from_dash_date(self):
        assert app._extract_statement_year(["PERIOD 01-01-2025 TO 31-01-2025"]) == "2025"

    def test_extracts_year_from_ddmonyyyy_format(self):
        assert app._extract_statement_year(["PAID ON 31Jan2027"]) == "2027"

    def test_returns_none_when_no_full_date_present(self):
        # Maybank/RHB transaction lines only ever carry DD/MM or DDMon (no
        # year) — this should NOT be mistaken for a full date.
        assert app._extract_statement_year(["05/01 SALARY 100.00 200.00"]) is None

    def test_returns_none_for_empty_input(self):
        assert app._extract_statement_year([]) is None

    def test_ignores_years_outside_19xx_20xx_range(self):
        # A stray "30/12/1899" style figure (unlikely, but guards against a
        # regex that accepts any 4 digits as a year)
        assert app._extract_statement_year(["30/12/1899"]) is None
