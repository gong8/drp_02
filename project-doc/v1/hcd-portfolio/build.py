#!/usr/bin/env python3
"""Render the v1 HCD Techniques Portfolio to a multi-page A4-portrait PDF.

The portfolio is one self-contained document (portfolio.html + portfolio.css,
the BeThere refined-neobrutalist brand). Each <section class="page"> is sized to
A4 portrait and breaks to its own PDF page in print. This script prints it to
PDF with headless Chrome, reusing the project's proven invocation. Self-contained:
reads only files in this folder. Run from anywhere: `python3 build.py`."""
import os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

SRC = os.path.join(HERE, "portfolio.html")
OUT = os.path.join(HERE, "hcd-portfolio.pdf")


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
