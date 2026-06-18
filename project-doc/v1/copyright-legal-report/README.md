# Copyright and Legal Issues Report (v1)

The DRP "Copyright/Legal Issues Report" deliverable, rebuilt for v1 as a single
plain-formatted A4 page (no brand chrome), per the assessment rubric's one-side limit.

## Files

- `report.html` - the source of truth: self-contained semantic HTML with inline grayscale
  CSS (system font, no colour). Structure: a resource/licence table, then one short
  paragraph per issue type - licence implications (2), copyright (3), wider legal (4).
  Edit this to change content.
- `build.py` - renders `report.html` to `copyright-legal-report.pdf` with headless Chrome
  (same invocation as `project-doc/v0/build.py`).
- `copyright-legal-report.pdf` - the deliverable, exactly one A4 side.

## Rebuild

```bash
python3 build.py    # needs Google Chrome installed (macOS path hardcoded in build.py)
```

## Formatting rules (from staff EdStem clarifications, do not violate)

- **Margins: 2.5cm (1 inch) all sides. Never change them** (EdStem #156, Jamie Willis).
- **Body 11pt**; table text may be smaller but **no less than 9pt** (#156, Mark Wheelhouse).
  This report uses 11pt body / 9pt table.
- **One short paragraph per issue type** - licence / copyright / wider-legal (#153). The
  one-side limit exists to stop over-writing, so the win is concision, NOT shrinking font
  or margins to cram more in. Fit by cutting words, not by fiddling with fonts/margins.
- Show enough depth to prove the issues were genuinely considered, and highlight specific
  terms-of-service / store elements that matter (e.g. the in-app account-deletion path),
  but do not unpack every clause (#154), and do not over-enumerate the project's own gaps.
- Honest reflection of what actually applies; if something does not apply, just say so (#158).

## Notes

- It must stay to one A4 side. If edits overflow, the PDF renders a second page; trim
  wording until `pdfinfo` reports `Pages: 1` (do NOT shrink the 11pt body or 2.5cm margins).
- Convention: no em dashes anywhere (use hyphens).
- The licence facts were verified against `node_modules` and the schema/config on 2026-06-18;
  re-verify if dependencies change.
