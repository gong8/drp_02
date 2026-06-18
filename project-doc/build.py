#!/usr/bin/env python3
"""Rebuild the BeThere project-documentation deliverables (root: project-doc/).

Steps: (1) render the impact-asset image cover-story.png from cover-story.html;
(2) rebuild the branded HTML for the markdown-driven docs (HCD portfolio, legal
report) by injecting the current .md into each brand template; (3) re-export
every PDF with headless Chrome.

Each deliverable lives in its own subfolder (copyright-legal-report/,
hcd-portfolio/, pitch-leaflet/); cover-story.{html,png} sits inside
hcd-portfolio/ since the portfolio embeds it via the relative path
cover-story.png. Self-contained: reads only files under this folder.

The pitch leaflet HTML is hand-authored (not generated from .md), so it is only
re-exported, never regenerated. Run from this folder: `python3 build.py`."""
import os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# each deliverable lives in its own subfolder under HERE
LEGAL_DIR = os.path.join(HERE, "copyright-legal-report")
HCD_DIR = os.path.join(HERE, "hcd-portfolio")
PITCH_DIR = os.path.join(HERE, "pitch-leaflet")

SRC_OPEN = '<script id="src" type="text/plain">'
SRC_CLOSE = '</script>'

# extra CSS for the portfolio: embedded images + reflection callouts
EXTRA_CSS = """
.md img{ display:block; width:100%; max-width:560px; margin:8px auto 18px; border:2px solid var(--ink); border-radius:12px; box-shadow:var(--shadow); }
.md blockquote.reflect{ border-left-color:var(--purple); background:var(--lav); }
.md blockquote.reflect p:last-child{ margin:0; }
.md .reflect-tag{ font-family:var(--display); font-weight:800; font-size:9px; letter-spacing:.7px; text-transform:uppercase; color:var(--purple); margin-bottom:5px; }
"""

# extra JS: tag reflection blockquotes (those whose first paragraph starts
# "Reflection.") and give them an uppercase eyebrow label.
REFLECT_JS = """
  out.querySelectorAll('blockquote').forEach(function(b){
    var p = b.querySelector('p');
    if(p && /^\\s*Reflection[.\\s]/.test(p.textContent)){
      b.classList.add('reflect');
      p.innerHTML = p.innerHTML.replace(/^\\s*Reflection\\.\\s*/, '');
      var tag = document.createElement('div');
      tag.className = 'reflect-tag';
      tag.textContent = 'Reflection';
      b.insertBefore(tag, b.firstChild);
    }
  });
"""


def inject_md(html, md):
    i = html.index(SRC_OPEN) + len(SRC_OPEN)
    j = html.index(SRC_CLOSE, i)
    return html[:i] + md + html[j:]


def rebuild(doc_dir, html_name, md_name, portfolio=False):
    html_path = os.path.join(doc_dir, html_name)
    md_path = os.path.join(doc_dir, md_name)
    with open(html_path) as f:
        html = f.read()
    with open(md_path) as f:
        md = f.read()
    html = inject_md(html, md)
    if portfolio:
        if ".reflect-tag" not in html:  # idempotent
            html = html.replace("</style>", EXTRA_CSS + "</style>", 1)
        if "reflect-tag" not in html.split("</style>")[1]:
            # insert reflect JS right before mermaid.initialize
            html = html.replace("  mermaid.initialize(", REFLECT_JS + "\n  mermaid.initialize(", 1)
    with open(html_path, "w") as f:
        f.write(html)
    print(f"rebuilt {html_name} ({len(html)} bytes)")


def render_cover():
    """Render the impact-asset image cover-story.png from cover-story.html."""
    html = os.path.join(HCD_DIR, "cover-story.html")
    png = os.path.join(HCD_DIR, "cover-story.png")
    pdftoppm = shutil.which("pdftoppm")
    if not os.path.exists(html) or not pdftoppm:
        print("  skipping cover render (need cover-story.html + pdftoppm); keeping existing png")
        return
    tmp = tempfile.mkdtemp()
    try:
        pdf = os.path.join(tmp, "cover.pdf")
        subprocess.run([
            CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
            "--virtual-time-budget=20000", "--run-all-compositor-stages-before-draw",
            "--no-pdf-header-footer", f"--print-to-pdf={pdf}", "file://" + html,
        ], check=True, stderr=subprocess.DEVNULL)
        subprocess.run([pdftoppm, "-png", "-r", "150", "-singlefile", pdf,
                        os.path.join(tmp, "cover")], check=True, stderr=subprocess.DEVNULL)
        shutil.copy(os.path.join(tmp, "cover.png"), png)
        print(f"  rendered cover-story.png ({os.path.getsize(png)} bytes)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def export_pdf(doc_dir, html_name):
    html_path = os.path.join(doc_dir, html_name)
    pdf_path = os.path.splitext(html_path)[0] + ".pdf"
    subprocess.run([
        CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--virtual-time-budget=30000", "--run-all-compositor-stages-before-draw",
        "--no-pdf-header-footer", f"--print-to-pdf={pdf_path}",
        "file://" + html_path,
    ], check=True, stderr=subprocess.DEVNULL)
    size = os.path.getsize(pdf_path)
    print(f"  exported {os.path.basename(pdf_path)}  {size} bytes")


if __name__ == "__main__":
    render_cover()
    rebuild(HCD_DIR, "hcd-portfolio.html", "hcd-portfolio.md", portfolio=True)
    rebuild(LEGAL_DIR, "copyright-legal-report.html", "copyright-legal-report.md")
    for doc_dir, h in ((HCD_DIR, "hcd-portfolio.html"),
                       (LEGAL_DIR, "copyright-legal-report.html"),
                       (PITCH_DIR, "pitch-leaflet.html")):
        export_pdf(doc_dir, h)
    print("done")
