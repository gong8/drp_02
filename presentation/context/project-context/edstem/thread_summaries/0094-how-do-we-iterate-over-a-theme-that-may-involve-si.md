# #94 — How do we iterate over a theme that may involve significant backend processing?

`source: edstem thread #94`

**Question:** The team's project involves a recommendation engine for discovering group activities in London. After receiving feedback on activity discovery, they want to iterate on it, but are unsure whether to mock the backend algorithm (giving the same stub response regardless of input) or invest time building it out properly — given that complex processing algorithms are out of scope.

**Answer (Mark Wheelhouse):** Spending significant effort on a recommendation algorithm is not in the spirit of thin-slicing, but a minimal implementation is preferable to a fully static mock — the system should at least vary its suggestions rather than always returning the same result. Key points:
- Full/real data for all possible activities can never be populated anyway, so there is always a realism ceiling regardless of algorithm sophistication.
- Design, development, and testing focus should be on the experience **around** the algorithm, not the algorithm itself; keep it simple for now.
- The algorithm can be expanded later if time permits or if user feedback demands something more advanced.
- Using a scenario-based prompt to guide interviewees (e.g. "Imagine you are planning a museum trip — type in your context") so that the backend can return a suitable hard-coded mock is a reasonable HCD technique, though the prompt wording should be made clearer so users know what to enter.
