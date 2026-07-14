"""
Integration tests for the /convert Flask route.

These build real (tiny) PDF files on the fly with reportlab and post them
through the actual route, exercising pdfplumber extraction + parsing +
error handling together — the parts test_parsers.py can't reach because it
calls the parsing functions directly with plain text lines.
"""
import io

import app as app_module
from conftest import (
    MAYBANK_LINES,
    RHB_LINES,
    make_pdf_bytes,
    make_corrupt_pdf_bytes,
    make_encrypted_pdf_bytes,
)


def post_pdf(client, pdf_bytes, filename="statement.pdf"):
    return client.post(
        "/convert",
        data={"pdf": (io.BytesIO(pdf_bytes), filename)},
        content_type="multipart/form-data",
    )


class TestConvertHappyPath:
    def test_maybank_statement_end_to_end(self, client):
        pdf = make_pdf_bytes([MAYBANK_LINES])
        resp = post_pdf(client, pdf, "maybank_jan.pdf")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["bank"] == "Maybank"
        assert len(data["transactions"]) == 3
        assert data["statement"]["statement_year"] == "2026"

    def test_rhb_statement_end_to_end(self, client):
        pdf = make_pdf_bytes([RHB_LINES])
        resp = post_pdf(client, pdf, "rhb_jan.pdf")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["bank"] == "RHB Islamic Bank"
        assert len(data["transactions"]) == 2

    def test_multi_page_statement_combines_all_pages(self, client):
        # Split the Maybank sample across two pages — extract_lines should
        # concatenate text from every page before parsing.
        half = len(MAYBANK_LINES) // 2
        pdf = make_pdf_bytes([MAYBANK_LINES[:half], MAYBANK_LINES[half:]])
        resp = post_pdf(client, pdf, "maybank_multi.pdf")
        assert resp.status_code == 200
        assert len(resp.get_json()["transactions"]) == 3


class TestConvertValidation:
    def test_missing_file_returns_400(self, client):
        resp = client.post("/convert", data={}, content_type="multipart/form-data")
        assert resp.status_code == 400
        assert "error" in resp.get_json()

    def test_non_pdf_extension_rejected(self, client):
        resp = client.post(
            "/convert",
            data={"pdf": (io.BytesIO(b"hello"), "statement.txt")},
            content_type="multipart/form-data",
        )
        assert resp.status_code == 400

    def test_unrecognised_bank_format_returns_422(self, client):
        pdf = make_pdf_bytes([["SOME OTHER BANK", "ACCOUNT STATEMENT", "no transactions here"]])
        resp = post_pdf(client, pdf)
        assert resp.status_code == 422
        assert "error" in resp.get_json()

    def test_pdf_with_no_transactions_returns_422(self, client):
        # Recognisable as Maybank, but no transaction lines at all
        pdf = make_pdf_bytes([["MALAYAN BANKING BERHAD", "ACCOUNT STATEMENT"]])
        resp = post_pdf(client, pdf)
        assert resp.status_code == 422


class TestFrontendServing:
    """Regression coverage for a bug where Flask's default static_folder
    ('static/') didn't match where index.html/styles.css actually live
    (next to app.py), causing both to 404 even though the API itself
    worked fine."""

    def test_index_page_is_served_at_root(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        assert b"<html" in resp.data.lower() or b"<!doctype" in resp.data.lower()

    def test_styles_css_is_served(self, client):
        resp = client.get("/styles.css")
        assert resp.status_code == 200
        assert resp.content_type.startswith("text/css")

    def test_app_source_is_not_exposed_over_http(self, client):
        # Serving the frontend shouldn't accidentally expose the backend
        # source, dependency list, etc.
        assert client.get("/app.py").status_code == 404
        assert client.get("/requirements.txt").status_code == 404


class TestConvertErrorHandling:
    """Covers the friendly-error-message fixes for corrupted, encrypted,
    scanned, and oversized PDFs — these previously either crashed with a
    raw exception string or gave a confusing generic message."""

    def test_corrupted_pdf_returns_friendly_422(self, client):
        resp = post_pdf(client, make_corrupt_pdf_bytes(), "corrupt.pdf")
        assert resp.status_code == 422
        assert "corrupted" in resp.get_json()["error"].lower() or \
               "valid pdf" in resp.get_json()["error"].lower()

    def test_password_protected_pdf_returns_friendly_422(self, client):
        resp = post_pdf(client, make_encrypted_pdf_bytes(), "encrypted.pdf")
        assert resp.status_code == 422
        assert "password" in resp.get_json()["error"].lower()

    def test_oversized_pdf_returns_413(self, client, monkeypatch):
        # Don't actually generate a 20MB PDF — temporarily lower the limit
        # instead, so the test stays fast.
        monkeypatch.setattr(app_module, "MAX_PDF_SIZE_BYTES", 100)
        pdf = make_pdf_bytes([MAYBANK_LINES])
        assert len(pdf) > 100  # sanity check the fixture is actually bigger
        resp = post_pdf(client, pdf)
        assert resp.status_code == 413

    def test_too_many_pages_returns_friendly_422(self, client, monkeypatch):
        monkeypatch.setattr(app_module, "MAX_PDF_PAGES", 1)
        pdf = make_pdf_bytes([MAYBANK_LINES, MAYBANK_LINES])  # 2 pages
        resp = post_pdf(client, pdf)
        assert resp.status_code == 422
        assert "page" in resp.get_json()["error"].lower()

    def test_no_extractable_text_returns_friendly_422(self, client):
        # A structurally valid PDF with a blank page — pdfplumber will
        # extract no text, simulating a scanned/image-only statement.
        pdf = make_pdf_bytes([[]])
        resp = post_pdf(client, pdf)
        assert resp.status_code == 422
        assert "scanned" in resp.get_json()["error"].lower() or \
               "no text" in resp.get_json()["error"].lower()

    def test_temp_file_is_cleaned_up_after_request(self, client, tmp_path, monkeypatch):
        # Regression guard for the `finally: os.unlink(tmp_path)` cleanup —
        # count temp files before/after to make sure nothing is leaked.
        import tempfile
        import os
        before = set(os.listdir(tempfile.gettempdir()))
        pdf = make_pdf_bytes([MAYBANK_LINES])
        post_pdf(client, pdf)
        after = set(os.listdir(tempfile.gettempdir()))
        assert after - before == set()  # no new files left behind
