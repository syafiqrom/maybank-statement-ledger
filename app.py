from flask import Flask, request, jsonify
from flask_cors import CORS
import pdfplumber
import re
import tempfile
import os

app = Flask(__name__)
CORS(app, origins=["http://localhost:5000", "http://127.0.0.1:5000", "null"])


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
    return {
        "bank":         "Maybank",
        "statement":    _mb_extract_metadata(lines),
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

# Debit descriptions (the balance goes DOWN = debit).
# We determine debit vs credit by comparing balance: if balance decreases it's debit.
RHB_DEBIT_KEYWORDS = {"MBKSTDR", "DMBASNBSCDR", "DMBASNBDR"}

# Page 2 is the commodity trading notice — skip lines inside it
RHB_PAGE2_MARKER = "NOTICEОНCOMPLETIONOFTRADING"
RHB_PAGE2_START = "NOTICEONCOMPLETIONOFTRADING"


def _rhb_classify_amount(desc, prev_balance, curr_balance, amount):
    """Return (debit, credit) tuple — one will be None, one will be the amount string."""
    prev = float(prev_balance.replace(",", ""))
    curr = float(curr_balance.replace(",", ""))
    if curr < prev:
        return amount, None   # debit
    else:
        return None, amount   # credit


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

            debit, credit = _rhb_classify_amount(desc, prev_balance, bal, amount)
            prev_balance  = bal

            transactions.append({
                "date":        date,
                "description": desc,
                "serial_no":   serial,
                "debit":       debit,
                "credit":      credit,
                "balance":     bal,
            })

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

def extract_lines(pdf_path):
    lines = []
    with pdfplumber.open(pdf_path) as pdf:
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
        lines = extract_lines(tmp_path)
        bank  = detect_bank(lines)

        if bank == "rhb":
            result = parse_rhb(lines)
        elif bank == "maybank":
            result = parse_maybank(lines)
        else:
            return jsonify({"error": "Unrecognised bank statement format"}), 422

        if not result.get("transactions"):
            return jsonify({"error": "No transactions found in PDF"}), 422

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    finally:
        os.unlink(tmp_path)


# ================================================================
#  SERVE index.html
# ================================================================

@app.route("/")
def index():
    return app.send_static_file("index.html")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)