"""
Shared pytest fixtures.

Two kinds of tests live in this suite:
  - test_parsers.py  — pure unit tests against the regex/parsing functions,
                        driven by plain Python lists of text lines. No PDF
                        involved, so these run instantly and don't depend
                        on any PDF library behaving a particular way.
  - test_routes.py   — integration tests against the Flask /convert route,
                        using real (tiny, generated) PDF files so we also
                        exercise pdfplumber's text extraction and the
                        route's error handling end to end.

reportlab is used to synthesize simple text-based PDFs on the fly so the
test suite doesn't need to ship real (and sensitive) bank statement PDFs.
"""
import io
import sys
from pathlib import Path

# Make sure app.py (in the project root, one level up from tests/) is
# importable no matter where pytest is invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

import app as app_module


@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c


def make_pdf_bytes(pages_of_lines, font_size=9):
    """Build a minimal text-based PDF from a list of pages, where each page
    is a list of text lines. Returns raw PDF bytes.

    This mimics what pdfplumber sees when reading a real statement: each
    call to page.extract_text().split("\\n") should recover these lines
    (modulo whitespace), which is all the app's parsers care about.
    """
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    for page_lines in pages_of_lines:
        y = height - 40
        c.setFont("Courier", font_size)
        for line in page_lines:
            c.drawString(40, y, line)
            y -= font_size + 3
        c.showPage()
    c.save()
    return buf.getvalue()


def make_encrypted_pdf_bytes(password="secret"):
    """Build a tiny password-protected PDF, used to test the
    PDFPasswordIncorrect handling path in /convert."""
    from pypdf import PdfWriter

    plain = make_pdf_bytes([["ENCRYPTED TEST PDF"]])
    reader_bytes = io.BytesIO(plain)
    writer = PdfWriter(clone_from=reader_bytes)
    writer.encrypt(password)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def make_corrupt_pdf_bytes():
    """Bytes that are not a valid PDF at all (but pass the '.pdf' filename
    check), used to test the PDFSyntaxError handling path."""
    return b"%PDF-1.4\nthis is not actually a valid pdf body"


# ================================================================
#  SAMPLE STATEMENT LINES
# ================================================================
# These are synthetic but structurally faithful to the formats the regexes
# in app.py are written against (see the comments above MB_TXN_HEADER and
# RHB_TXN). They are NOT copied from any real statement.

MAYBANK_HEADER_LINES = [
    "MALAYAN BANKING BERHAD",
    "ACCOUNT STATEMENT",
    "STATEMENT DATE : 31/01/2026",
]

MAYBANK_BODY_LINES = [
    "01/01                 BEGINNING BALANCE                          1,000.00",
    "05/01 IBK FUND TRANSFER          150.00-                          850.00",
    "AHMAD BIN ALI",
    "REF00012345",
    "DUITNOW",
    "12/01 SALARY                   3,000.00+                        3,850.00",
    "EMPLOYER SDN BHD",
    "REF00098765",
    "SALARY",
    "20/01 DIVIDEND PAID               12.34+                        3,862.34",
    "SHOULD BE SKIPPED AS DETAIL",
    "31/01                 ENDING BALANCE  :                         3,862.34",
    "TOTAL DEBIT  :                       150.00",
    "TOTAL CREDIT :                     3,012.34",
]

MAYBANK_LINES = MAYBANK_HEADER_LINES + MAYBANK_BODY_LINES

RHB_HEADER_LINES = [
    "RHB ISLAMIC BANK BERHAD",
    "PRO SAVINGS ACCOUNT-i",
    "STATEMENT PERIOD 01/01/2026-31/01/2026",
]

RHB_ACCOUNT_SUMMARY_LINE = (
    "PROSAVINGSACCOUNT-i 15603500121285 1,666.32 1,546.26 1.02"
)

RHB_BODY_LINES = [
    "01Jan B/FBALANCE 1,666.32",
    "29Mar DMBASNBDR 003 120.00 1,545.91",   # keyword-classified debit
    "040309100357",                          # pure reference line, skipped
    "31Jan PROFITCREDIT      0.35 1,666.67", # keyword-classified credit
    "31Jan C/FBALANCE 1,546.26",
    RHB_ACCOUNT_SUMMARY_LINE,
    "ProfitCredited/Keuntunganyangdikreditkan : 0.35",
]

RHB_LINES = RHB_HEADER_LINES + RHB_BODY_LINES
