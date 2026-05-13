import pdfplumber
import re
import json

# ================= FILES =================
INPUT_PDF = "statement.pdf"
OUTPUT_JSON = "statement.json"

# ================= REGEX =================
TXN_HEADER = re.compile(
    r"^(\d{2}/\d{2})\s+(.+?)\s+([\d,]*\.\d{2}[+-]?)\s+([\d,]+\.\d{2})\s*$"
)

BALANCE_PATTERNS = {
    "beginning_balance": re.compile(r"BEGINNING BALANCE\s+([\d,]+\.\d{2})"),
    "ending_balance": re.compile(r"ENDING BALANCE\s*:\s*([\d,]+\.\d{2})"),
    "ledger_balance": re.compile(r"LEDGER BALANCE\s*:\s*([\d,]+\.\d{2})"),
    "total_debit": re.compile(r"TOTAL DEBIT\s*:\s*([\d,]+\.\d{2})"),
    "total_credit": re.compile(r"TOTAL CREDIT\s*:\s*([\d,]+\.\d{2})"),
}


# ================= EXTRACT TEXT =================
def extract_lines(pdf_path):
    lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                lines.extend(text.split("\n"))

    # Clean empty lines and trim whitespace
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
    """
    Heuristic:
    - name = first line
    - reference/account = second line
    - method = third line
    """
    name = details[0] if len(details) > 0 else None
    reference = details[1] if len(details) > 1 else None
    method = details[2] if len(details) > 2 else None

    return {
        "name": name,
        "reference": reference,
        "method": method
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
                "date": match.group(1),
                "type": match.group(2).strip(),
                "amount": match.group(3),
                "balance": match.group(4),
                "details": []
            }

        else:
            if current:
                if current["type"] != "DIVIDEND PAID":
                    current["details"].append(line)

    if current:
        current["details"] = split_details(current["details"])
        transactions.append(current)

    return transactions

# ================= MAIN =================
def main():
    lines = extract_lines(INPUT_PDF)

    metadata = extract_metadata(lines)
    transactions = parse_transactions(lines)

    result = {
        "statement": metadata,
        "transactions": transactions
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print("Done ->", OUTPUT_JSON)


if __name__ == "__main__":
    main()