# MayLedger — Bank Statement Analyser for Maybank

A fully local, privacy-first bank statement analyser. Your PDFs never leave your machine.

---

## How It Works

```
PDF on your disk
      ↓
Flask (app.py) — runs pdfplumber locally
      ↓
JSON returned to browser
      ↓
index.html — displays, tags, and analyses your transactions
```

Everything runs on `127.0.0.1`. No cloud, no accounts, no data sent anywhere.

---

## Requirements

### System

| Requirement | Version |
|---|---|
| Python | 3.8 or newer |
| A modern browser | Chrome, Firefox, Edge, Safari |

### Python packages

| Package | Purpose |
|---|---|
| `flask` | Local web server that serves the app and converts PDFs |
| `flask-cors` | Allows the browser to call the Flask API |
| `pdfplumber` | Extracts text from bank statement PDFs |

---

## Installation

**1. Clone or download this project**

```
your_folder/
├── app.py
├── index.html
├── requirements.txt
├── styles.css
```

**2. Install Python dependencies**

```bash
pip install -r requirements.txt
```

If you are on a system with a managed Python environment (e.g. Ubuntu 24+):

```bash
pip install -r requirements.txt --break-system-packages
```
---

## Running the App

```bash
python app.py
```

Then open your browser and go to:

```
http://127.0.0.1:5000
```

Keep the terminal open while using the app. To stop the server, press `Ctrl+C`.

---

## Usage

### Importing a Statement

1. Go to the **Import** page
2. Drag and drop your bank statement PDF, or click **Browse Files**
3. The app converts it automatically — no manual steps needed
4. A balance verification result is shown (✓ or ⚠) if the PDF contains totals

### Tagging Transactions

1. Go to **Tag Manager** and create tags (e.g. Food, Transport, Salary)
2. Add keyword rules — any transaction whose payee contains the keyword gets auto-tagged on import
3. On the **Transactions** page, click the tag badge on any row to manually assign or change a tag
4. Tagging by payee applies to **all transactions from that payee** at once

### Back Up Tags

Tags are saved in LocalStorage. To back up the tags:

- Click **Save Tags JSON** to export your tags to a `.json` file
- On your next session, click **Load Tags JSON** to restore them

This keeps your tags portable and separate from transaction data.

### Filtering & Export

- Filter transactions by month, type (income/expense), tag, or search by payee
- Click **Export CSV** to download the currently filtered view

---

## Data & Privacy

| Data | Where it lives |
|---|---|
| Transactions | Browser `localStorage` only |
| Tags | Loaded from / saved to a `.json` file you control |
| PDFs | Opened in memory, temp file deleted immediately after parsing |
| Anything else | Nowhere — no database, no server storage, no internet |

Clearing your browser's site data for `127.0.0.1` will erase all transaction history.

---

## Troubleshooting

**"Cannot reach local server"**
→ Make sure `python app.py` is running in your terminal before uploading.

**Balance verification shows ⚠ mismatch**
→ Not all transactions parsed correctly, or the PDF totals include items the parser skipped (e.g. dividend entries). Check the transaction count against your statement.
