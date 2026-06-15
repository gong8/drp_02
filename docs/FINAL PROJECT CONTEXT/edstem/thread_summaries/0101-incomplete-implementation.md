# #101 — Incomplete Implementation

`source: edstem thread #101`

**Question:** A student asks whether it is acceptable to stub out file upload functionality — showing the file name and size without actually uploading the file — because Firebase Storage is a paid feature not currently enabled on their plan.

**Answer (Mark Wheelhouse):** Full implementation is required by the end of the project; faking the interaction risks mark deductions for stability/correctness and will also prevent genuine user feedback on that feature. Three suggested solutions:

- Set up a back-end database server and store files directly in it (not best practice, but functional).
- Move the codebase off Firebase to a framework that does not have this limitation.
- Upgrade to the Firebase Blaze tier — research suggests no real cost within usage limits, and new accounts receive $300 in free credit as a buffer.
