# #68 — Frontend and Backend Repository Setup

`source: edstem thread #68`

**Question:** A student asked whether it is acceptable to use two separate repositories (one for frontend, one for backend) or whether a monorepo setup is preferred.

**Answer (Jamie Willis):** Either approach is fine. Key considerations:
- A monorepo gives AI tools full system context, making them more effective.
- If frontend and backend share a language, a monorepo allows shared code/types (e.g. a `shared/` module for endpoint descriptions and JSON codecs), keeping things consistent and type-safe.
- Jamie's own setup uses a monorepo with a `frontend/` folder and a `shared/` module for endpoint descriptions and shared data structures, ensuring server and client stay in sync.

**Answer (Mark Wheelhouse):** LabTS uses a hybrid: a monorepo for the main website (different system components in different folders), plus separate repos for the testing clients and the automated testing framework. This maintains a clear separation of concerns where modules share nothing.

**Answer (Zaki Amin):** EdTech uses a separate repo per microservice, with frontend types generated from backend API schemas. Separate repos keep responsibilities independent and allow per-project tailoring of code quality and build processes — especially useful when projects use different frameworks or languages — but introduce organisational overhead and a risk of inconsistency between projects.
