# Copyright and Legal Issues Report (v1)

The DRP "Copyright/Legal Issues Report" deliverable, rebuilt for v1 as a single
plain-formatted A4 page (no brand chrome), per the assessment rubric's one-side limit.

## Files

- `report.html` - the source of truth: self-contained semantic HTML with inline plain
  CSS (system font, no colour or borders). Edit this to change content.
- `build.py` - renders `report.html` to `copyright-legal-report.pdf` with headless Chrome
  (same invocation as `project-doc/v0/build.py`).
- `copyright-legal-report.pdf` - the deliverable, exactly one A4 side.

## Rebuild

```bash
python3 build.py    # needs Google Chrome installed (macOS path hardcoded in build.py)
```

## Notes

- It must stay to one A4 side. If edits overflow, the PDF renders a second page; tighten
  the font size / spacing in the `<style>` block, or trim wording, until `pdfinfo` reports
  `Pages: 1`.
- Convention: no em dashes anywhere (use hyphens).
- The licence facts were verified against `node_modules` and the schema/config on 2026-06-18;
  re-verify if dependencies change.
