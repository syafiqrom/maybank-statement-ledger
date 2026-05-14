from flask import Flask, request, jsonify
from flask_cors import CORS
import pdfplumber
import re
import tempfile
import os

app = Flask(__name__)
CORS(app, origins=["http://localhost:5000", "http://127.0.0.1:5000", "null"])

# ================= REGEX =================
TXN_HEADER = re.compile(
    r"^(\d{2}/\d{2})\s+(.+?)\s+([\d,]*\.\d{2}[+-]?)\s+([\d,]+\.\d{2})\s*$"
)

BALANCE_PATTERNS = {
    "beginning_balance": re.compile(r"BEGINNING BALANCE\s+([\d,]+\.\d{2})"),
    "ending_balance":    re.compile(r"ENDING BALANCE\s*:\s*([\d,]+\.\d{2})"),
    "ledger_balance":    re.compile(r"LEDGER BALANCE\s*:\s*([\d,]+\.\d{2})"),
    "total_debit":       re.compile(r"TOTAL DEBIT\s*:\s*([\d,]+\.\d{2})"),
    "total_credit":      re.compile(r"TOTAL CREDIT\s*:\s*([\d,]+\.\d{2})"),
}


# ================= EXTRACT TEXT =================
def extract_lines(pdf_path):
    lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                lines.extend(text.split("\n"))
    return [l.strip() for l in lines if l.strip()]


# ================= PARSE METADATA =================
def extract_metadata(lines):
    meta = {}
    for line in lines:
        for key, pattern in BALANCE_PATTERNS.items():
            match = pattern.search(line)
            if match:
                meta[key] = match.group(1)
    return meta


# ================= SPLIT DETAILS =================
def split_details(details):
    return {
        "name":      details[0] if len(details) > 0 else None,
        "reference": details[1] if len(details) > 1 else None,
        "method":    details[2] if len(details) > 2 else None,
    }


# ================= PARSE TRANSACTIONS =================
def parse_transactions(lines):
    transactions = []
    current = None

    for line in lines:
        match = TXN_HEADER.match(line)
        if match:
            if current:
                current["details"] = split_details(current["details"])
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
        current["details"] = split_details(current["details"])
        transactions.append(current)

    return transactions


# ================= ROUTE =================
@app.route("/convert", methods=["POST"])
def convert():
    if "pdf" not in request.files:
        return jsonify({"error": "No PDF file uploaded"}), 400

    pdf_file = request.files["pdf"]

    if not pdf_file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "File must be a PDF"}), 400

    # Write to a temp file — pdfplumber needs a file path
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        pdf_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        lines        = extract_lines(tmp_path)
        metadata     = extract_metadata(lines)
        transactions = parse_transactions(lines)

        if not transactions:
            return jsonify({"error": "No transactions found in PDF"}), 422

        return jsonify({
            "statement":    metadata,
            "transactions": transactions,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    finally:
        os.unlink(tmp_path)  # always delete the temp file


# ================= SERVE index.html =================
@app.route("/")
def index():
    return app.send_static_file("index.html")


if __name__ == "__main__":
    # Only listens on localhost — never exposed to the network
    app.run(host="127.0.0.1", port=5000, debug=False)