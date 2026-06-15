# #71 — Supabase/Firebase Client SDK

`source: edstem thread #71`

**Question:** Does using the Supabase/Firebase client SDK directly in the frontend satisfy the Milestone 2 requirement that the front-end and back-end be "end-to-end complete" and connected, or is a traditional API layer (e.g. cloud/edge functions) required?

**Answer (Mark Wheelhouse):** Using a client SDK is acceptable. The requirement is satisfied as long as a change made on the front-end is genuinely sent to and saved in the back-end, and can then be retrieved and visualised in the front-end again. The interaction must be real — local state such as cookies or browser cache cannot be used to fake a back-end update. The goal of the Walking Skeleton milestone is simply to have a full (if minimal) end-to-end deployment; the specific method of connecting front-end to back-end is not prescribed.
