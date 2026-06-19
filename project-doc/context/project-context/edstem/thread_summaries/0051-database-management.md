# #51 — Database management

`source: edstem thread #51`

**Question:** A student asked for clarification on the requirement to "manage your own database" — specifically whether using third-party database-as-a-service tools like Firebase or Supabase would violate the rule.

**Answer (Mark Wheelhouse):** The core requirement is that your project's digital touchpoint provides a **persistent** service across devices, meaning you must use server-side data storage (a database). Client-side storage alone is not acceptable as it does not persist across devices or between users. You are free to implement data storage however you like — including services like Firebase or Supabase — as long as you are able to control your own database schema (tables and data types).
