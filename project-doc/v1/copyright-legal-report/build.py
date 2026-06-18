#!/usr/bin/env python3
"""Render the v1 Copyright and Legal Issues Report to a plain one-page A4 PDF.

The report is a single self-contained HTML file (report.html: semantic markup +
inline plain CSS, system font, no colour or brand chrome). This script just
prints it to PDF with headless Chrome, reusing the same invocation as
project-doc/v0/build.py. Self-contained: reads only files in this folder.

Run from anywhere: `python3 build.py`."""
import os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

SRC = os.path.join(HERE, "report.html")
OUT = os.path.join(HERE, "copyright-legal-report.pdf")


def export_pdf(html_path, pdf_path):
    subprocess.run([
        CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--virtual-time-budget=30000", "--run-all-compositor-stages-before-draw",
        "--no-pdf-header-footer", f"--print-to-pdf={pdf_path}",
        "file://" + html_path,
    ], check=True, stderr=subprocess.DEVNULL)
    print(f"  exported {os.path.basename(pdf_path)}  {os.path.getsize(pdf_path)} bytes")


if __name__ == "__main__":
    export_pdf(SRC, OUT)
    print("done")
