# #66 — Is backend logic considered during design iterations?

`source: edstem thread #66`

**Question:** Does the design iteration process need to account for backend features (e.g. AI-generated content) that affect the user experience but are not direct UI elements the user interacts with?

**Answer (Jamie Willis):** If the user does not directly interact with something, it should not be part of the design iteration. If the user does interact with it, it requires user testing and feedback.

**Answer (Mark Wheelhouse):** The human-centred design process does not focus on backend features at all — everything should be grounded in specific user needs and interactions, not implementation details. For the scope of this project, you can assume backend content generation happens and simply mock up representative data for 1–2 cases that illustrate the user engagement your service aims to foster. The focus should be on user workflows and interactions through the system (not just how it looks), and whether backend details ever need fleshing out further will depend on your specific context and user feedback.

**Answer (Zaki Amin):** AI-generated content is not a feature in itself. Presenting content to enable a user interaction may be a feature, but otherwise it is just a means of generating data to support a feature, not a design concern in its own right.
