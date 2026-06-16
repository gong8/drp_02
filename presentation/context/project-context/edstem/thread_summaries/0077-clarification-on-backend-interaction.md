# #77 — Clarification on backend interaction

`source: edstem thread #77`

**Question:** A student asked what counts as a "backend" for Milestone 2 — specifically, whether it must be a separate server on a different machine or whether a backend process that interacts with a database on the same machine is sufficient.

**Answer (Mark Wheelhouse):** Either approach is fine; implementation decisions are intentionally left open-ended. The requirement for the Walking Skeleton is that the app is not running on localhost or in an emulator, and that data sent from the user interface persists somewhere and can be reflected back to the UI. More important than the architecture is designing and developing the right core interaction, in both mock-ups/prototypes and the initial digital touchpoint.

**Answer (Zaki Amin):** The architecture does not matter — a distinct frontend/backend split is not required. Frameworks like Next.js that handle both server and client side in a single project are acceptable. The key requirement in any case is proper access control: users must not be able to access important credentials or the database directly.
