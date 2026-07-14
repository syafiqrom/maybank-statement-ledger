from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfminer.pdfparser import PDFSyntaxError
from pdfplumber.utils.exceptions import PdfminerException
import re
import tempfile
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)
# Only allow the origins this app is actually meant to be used from.
# NOTE: "null" was previously allowed here to support opening index.html
# directly via file://, but "null" is also the Origin header sent by many
# untrusted/sandboxed contexts (data: URIs, sandboxed iframes, some
# downloaded HTML files) — allowing it means ANY such page on the visitor's
# machine could make requests to this local server. The documented (and
# only supported) way to use this app is via `python app.py` +
# http://127.0.0.1:5000, so we restrict CORS to that.
CORS(app, origins=[
    "http://localhost:5000",  "http://127.0.0.1:5000",   # original (Flask-served)
    "http://localhost:5173",  "http://127.0.0.1:5173",   # Vite dev server
])


# ================================================================
#  MAYBANK PARSER
# ================================================================

MB_TXN_HEADER = re.compile(
    r"^(\d{2}/\d{2})\s+(.+?)\s+([\d,]*\.\d{2}[+-]?)\s+([\d,]+\.\d{2})\s*$"
)

MB_BALANCE_PATTERNS = {
    "beginning_balance": re.compile(r"BEGINNING BALANCE\s+([\d,]+\.\d{2})"),
    "ending_balance":    re.compile(r"ENDING BALANCE\s*:\s*([\d,]+\.\d{2})"),
    "ledger_balance":    re.compile(r"LEDGER BALANCE\s*:\s*([\d,]+\.\d{2})"),
    "total_debit":       re.compile(r"TOTAL DEBIT\s*:\s*([\d,]+\.\d{2})"),
    "total_credit":      re.compile(r"TOTAL CREDIT\s*:\s*([\d,]+\.\d{2})"),
}


def _mb_split_details(details):
    return {
        "name":      details[0] if len(details) > 0 else None,
        "reference": details[1] if len(details) > 1 else None,
        "method":    details[2] if len(details) > 2 else None,
    }


def _mb_extract_metadata(lines):
    meta = {}
    for line in lines:
        for key, pattern in MB_BALANCE_PATTERNS.items():
            match = pattern.search(line)
            if match:
                meta[key] = match.group(1)
    return meta


def _mb_parse_transactions(lines):
    transactions = []
    current = None

    for line in lines:
        match = MB_TXN_HEADER.match(line)
        if match:
            if current:
                current["details"] = _mb_split_details(current["details"])
                transactions.append(current)
            current = {
                "date":    match.group(1),
                "type":    match.group(2).strip(),
                "amount":  match.group(3),
                "balance": match.group(4),
                "details": [],
            }
        else:
            if current and current["type"] != "DIVIDEND PAID":
                current["details"].append(line)

    if current:
        current["details"] = _mb_split_details(current["details"])
        transactions.append(current)

    return transactions


def parse_maybank(lines):
    meta = _mb_extract_metadata(lines)
    meta["statement_year"] = _extract_statement_year(lines)
    return {
        "bank":         "Maybank",
        "statement":    meta,
        "transactions": _mb_parse_transactions(lines),
    }


# ================================================================
#  RHB PARSER
# ================================================================

# Matches: "29Mar DMBASNBDR 003 120.00 1,545.91"
#          "31Jan PROFITCREDIT      0.35 1,666.67"
# Group 1 = date (e.g. "29Mar")
# Group 2 = description
# Group 3 = serial number (optional, 3-digit)
# Group 4 = debit OR credit amount
# Group 5 = running balance
RHB_TXN = re.compile(
    r"^(\d{2}[A-Za-z]{3})\s+(.+?)\s+(?:(\d{3})\s+)?([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$"
)

# Matches opening/closing balance lines: "01Jan B/FBALANCE 1,666.32"
RHB_BAL = re.compile(
    r"^(\d{2}[A-Za-z]{3})\s+(B/FBALANCE|C/FBALANCE)\s+([\d,]+\.\d{2})\s*$"
)

# Summary line in the account activity section
RHB_SUMMARY = re.compile(
    r"^PROSAVINGSACCOUNT-i\s*([\d]+)\s*$"
)

# Account summary table: "PROSAVINGSACCOUNT-i 15603500121285 1,666.32 1,546.26 1.02"
RHB_ACCT_SUMMARY = re.compile(
    r"PROSAVINGSACCOUNT-i\s+([\d]+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})"
)

# Profit line on page 2
RHB_PROFIT_CREDITED = re.compile(
    r"ProfitCredited/Keuntunganyangdikreditkan\s*:\s*([\d,]+\.\d{2})"
)

# Known transaction-description keywords, used as the PRIMARY signal for
# debit/credit classification (balance comparison is only a fallback — see
# _rhb_classify_amount below).
RHB_DEBIT_KEYWORDS = {"MBKSTDR", "DMBASNBSCDR", "DMBASNBDR"}
RHB_CREDIT_KEYWORDS = {"PROFITCREDIT", "DMBASNBCR", "MBKSTCR"}

# Page 2 is the commodity trading notice — skip lines inside it
RHB_PAGE2_START = "NOTICEONCOMPLETIONOFTRADING"


def _rhb_classify_amount(desc, prev_balance, curr_balance, amount):
    """Return (debit, credit) tuple — one will be None, one will be the amount string.

    Classification priority:
      1. Known keyword in the description (most reliable — independent of
         balance arithmetic, so it can't be fooled by same-line netting,
         OCR/line-merge glitches, or a misread balance figure).
      2. Balance-diff fallback for descriptions we don't recognise yet.

    If both signals are available and disagree, we trust the keyword but
    note the conflict in the returned dict so it surfaces during import
    review rather than failing silently.
    """
    desc_key = desc.upper().replace(" ", "")

    keyword_says = None
    if any(kw in desc_key for kw in RHB_DEBIT_KEYWORDS):
        keyword_says = "debit"
    elif any(kw in desc_key for kw in RHB_CREDIT_KEYWORDS):
        keyword_says = "credit"

    try:
        prev = float(prev_balance.replace(",", ""))
        curr = float(curr_balance.replace(",", ""))
        balance_says = "debit" if curr < prev else "credit"
    except (TypeError, ValueError):
        balance_says = None

    classification = keyword_says or balance_says or "credit"
    conflict = (
        keyword_says is not None
        and balance_says is not None
        and keyword_says != balance_says
    )

    if classification == "debit":
        return amount, None, conflict
    else:
        return None, amount, conflict


def parse_rhb(lines):
    # --- metadata from account summary table ---
    meta = {
        "account_name":    "PRO SAVINGS ACCOUNT-i",
        "account_number":  None,
        "opening_balance": None,
        "ending_balance":  None,
        "profit_paid_ytd": None,
    }

    for line in lines:
        m = RHB_ACCT_SUMMARY.search(line)
        if m:
            meta["account_number"]  = m.group(1)
            meta["opening_balance"] = m.group(2)
            meta["ending_balance"]  = m.group(3)
            meta["profit_paid_ytd"] = m.group(4)
            break

    for line in lines:
        m = RHB_PROFIT_CREDITED.search(line)
        if m:
            meta["profit_credited"] = m.group(1)
            break

    meta["statement_year"] = _extract_statement_year(lines)

    # --- skip page 2 commodity lines ---
    # Page 2 starts after "NOTICEONCOMPLETIONOFTRADING"
    activity_lines = []
    in_page2 = False
    for line in lines:
        if RHB_PAGE2_START in line:
            in_page2 = True
        if not in_page2:
            activity_lines.append(line)

    # --- parse transactions ---
    transactions = []
    prev_balance = meta.get("opening_balance", "0.00")

    # Skip reference number lines (pure numeric continuation lines like "040309100357")
    REF_LINE = re.compile(r"^\d{10,}$")

    for line in activity_lines:
        # Skip pure reference number lines
        if REF_LINE.match(line):
            continue

        bal_match = RHB_BAL.match(line)
        if bal_match:
            # B/F and C/F are not real transactions — just update prev_balance
            prev_balance = bal_match.group(3)
            continue

        txn_match = RHB_TXN.match(line)
        if txn_match:
            date   = txn_match.group(1)
            desc   = txn_match.group(2).strip()
            serial = txn_match.group(3)
            amount = txn_match.group(4)
            bal    = txn_match.group(5)

            debit, credit, conflict = _rhb_classify_amount(desc, prev_balance, bal, amount)
            prev_balance  = bal

            txn = {
                "date":        date,
                "description": desc,
                "serial_no":   serial,
                "debit":       debit,
                "credit":      credit,
                "balance":     bal,
            }
            if conflict:
                # Keyword and balance-diff disagreed — keyword was trusted,
                # but flag it so it's easy to spot-check during review.
                txn["classification_conflict"] = True
            transactions.append(txn)

    return {
        "bank":         "RHB Islamic Bank",
        "statement":    meta,
        "transactions": transactions,
    }


# ================================================================
#  BANK DETECTION
# ================================================================

def detect_bank(lines):
    """Return 'rhb' or 'maybank' based on header lines."""
    header = " ".join(lines[:10]).lower()
    if "rhb" in header or "rhbislamicbank" in header:
        return "rhb"
    if "maybank" in header or "malayan banking" in header:
        return "maybank"
    return "unknown"


# ================================================================
#  SHARED UTILITIES
# ================================================================

# Full dates with an explicit 4-digit year, e.g. statement period headers
# like "STATEMENT DATE : 31/01/2026" or "PERIOD 01/01/2026 - 31/01/2026".
# Used to recover the correct year for transactions, which otherwise only
# carry a day/month (Maybank: "DD/MM", RHB: "DDMon").
_FULL_DATE_PATTERNS = [
    re.compile(r"\b\d{2}/\d{2}/(\d{4})\b"),
    re.compile(r"\b\d{2}-\d{2}-(\d{4})\b"),
    re.compile(r"\b\d{2}[A-Za-z]{3}(\d{4})\b"),   # e.g. "31Jan2026"
]


def _extract_statement_year(lines):
    """Best-effort extraction of the statement's year directly from the PDF
    text (statement date/period headers). Returns a 4-digit year string, or
    None if nothing was found — callers should fall back sensibly rather
    than guessing from the uploaded filename, which is often wrong (renamed
    files, generic names, multi-year batches, etc.)."""
    for line in lines:
        for pattern in _FULL_DATE_PATTERNS:
            match = pattern.search(line)
            if match:
                year = match.group(1)
                if year.startswith(("19", "20")):
                    return year
    return None


# Guardrails for the /convert upload — a real bank statement is a handful
# of pages and well under a megabyte of text. Without these limits, a huge
# or maliciously crafted PDF could tie up this local Flask process (and its
# single-threaded dev server) for a long time.
MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024   # 20 MB
MAX_PDF_PAGES = 50

# Also enforced at the Flask/Werkzeug level as a hard backstop — this makes
# oversized uploads fail fast (before we even finish receiving the body)
# rather than only being caught after the fact.
app.config["MAX_CONTENT_LENGTH"] = MAX_PDF_SIZE_BYTES


@app.errorhandler(413)
def handle_too_large(e):
    return jsonify({
        "error": f"File is too large — the limit is "
                 f"{MAX_PDF_SIZE_BYTES // (1024 * 1024)} MB per statement."
    }), 413


class PDFTooLargeError(Exception):
    pass


def extract_lines(pdf_path, max_pages=None):
    if max_pages is None:
        # Read fresh on each call rather than binding as a default-argument
        # value — a default arg is evaluated once at function-definition
        # time, so changing MAX_PDF_PAGES afterwards (e.g. via config or in
        # tests) would silently have no effect.
        max_pages = MAX_PDF_PAGES
    lines = []
    with pdfplumber.open(pdf_path) as pdf:
        if len(pdf.pages) > max_pages:
            raise PDFTooLargeError(
                f"This PDF has {len(pdf.pages)} pages, which is more than "
                f"the {max_pages}-page limit for a single statement. Split "
                f"it into smaller files and import them separately."
            )
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                lines.extend(text.split("\n"))
    return [l.strip() for l in lines if l.strip()]


# ================================================================
#  ROUTE
# ================================================================

@app.route("/convert", methods=["POST"])
def convert():
    if "pdf" not in request.files:
        return jsonify({"error": "No PDF file uploaded"}), 400

    pdf_file = request.files["pdf"]

    if not pdf_file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "File must be a PDF"}), 400

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        pdf_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        # Belt-and-braces size check: MAX_CONTENT_LENGTH catches most
        # oversized uploads before we get here, but this covers cases where
        # the reported Content-Length didn't match the actual bytes written.
        if os.path.getsize(tmp_path) > MAX_PDF_SIZE_BYTES:
            return jsonify({
                "error": f"File is too large — the limit is "
                         f"{MAX_PDF_SIZE_BYTES // (1024 * 1024)} MB per statement."
            }), 413

        try:
            lines = extract_lines(tmp_path)
        except PdfminerException as e:
            # pdfplumber wraps the *original* pdfminer exception as the sole
            # arg of its own PdfminerException rather than letting it
            # propagate directly — so PDFPasswordIncorrect/PDFSyntaxError
            # raised deep inside pdfminer never reach us unless we unwrap
            # this first. (Caught by tests/test_routes.py — without this,
            # both cases fell through to the generic 500 handler below.)
            cause = e.args[0] if e.args else None
            if isinstance(cause, PDFPasswordIncorrect):
                return jsonify({
                    "error": "This PDF is password-protected. Remove the "
                             "password and try again."
                }), 422
            if isinstance(cause, PDFSyntaxError):
                return jsonify({
                    "error": "This file doesn't look like a valid PDF (it "
                             "may be corrupted or not actually a PDF)."
                }), 422
            raise  # unrecognised cause — let the outer handler log & report it
        except PDFPasswordIncorrect:
            # Kept as a fallback in case a future pdfplumber version raises
            # this directly instead of wrapping it.
            return jsonify({
                "error": "This PDF is password-protected. Remove the password "
                         "and try again."
            }), 422
        except PDFSyntaxError:
            return jsonify({
                "error": "This file doesn't look like a valid PDF (it may be "
                         "corrupted or not actually a PDF)."
            }), 422
        except PDFTooLargeError as e:
            return jsonify({"error": str(e)}), 422

        if not lines:
            return jsonify({
                "error": "No text could be extracted from this PDF. It may be "
                         "a scanned image rather than a text-based statement — "
                         "OCR is not currently supported."
            }), 422

        bank = detect_bank(lines)

        if bank == "rhb":
            result = parse_rhb(lines)
        elif bank == "maybank":
            result = parse_maybank(lines)
        else:
            return jsonify({"error": "Unrecognised bank statement format"}), 422

        if not result.get("transactions"):
            return jsonify({"error": "No transactions found in PDF"}), 422

        return jsonify(result)

    except Exception:
        # Don't leak raw exception internals to the client — log server-side
        # for debugging, return a generic message to the UI.
        app.logger.exception("Unexpected error while converting %s", pdf_file.filename)
        return jsonify({
            "error": "Something went wrong while reading this PDF. Check the "
                     "terminal running app.py for details."
        }), 500

    finally:
        os.unlink(tmp_path)


# ================================================================
#  SERVE index.html
# ================================================================

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/styles.css")
def styles():
    return send_from_directory(BASE_DIR, "styles.css")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)