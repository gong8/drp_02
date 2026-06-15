# #75 — Core interaction(s) in walking skeleton

`source: edstem thread #75`

**Question:** For the walking skeleton, does every defined core interaction need to be working end-to-end with the backend, or is it acceptable to have only one connected and show the rest using hardcoded/mocked data?

**Answer (Zaki Amin):** Only the first core interaction needs to be working end-to-end. Other interactions may appear as mock-ups, but broken or inconsistent interactions (e.g. buttons that do nothing) should not be included in the deployed skeleton. Partially implementing several interactions at once is discouraged — it is better to complete each interaction fully through the stack ("thin slicing") to keep development cycles and feedback collection manageable.

**Answer (Mark Wheelhouse):** Buttons for future/unimplemented features are an unhelpful distraction during the walking skeleton stage. Remove them or disable them; you can verbally tell test users that a feature is not yet implemented, rather than taking them to a dead-end page.
