# #53 — Mobile Apps

`source: edstem thread #53`

**Question:** A student asks whether building an Android app for the walking skeleton also requires a corresponding iOS app, or whether targeting a single OS is acceptable.

**Answer (Zaki Amin):** Sticking to one OS is fine for now. Frameworks like React Native can deploy the same code to multiple platforms, but there is no requirement to target a specific one. Be mindful that the platform choice should suit your users and their context — depending on your target demographic, the Android/iOS split could be significant, potentially alienating a large portion of potential users.

**Answer (Mark Wheelhouse):** It would be worth aiming to support both Android and iOS by the end of the project if possible, since limiting to one platform likely excludes around 50% of target users. That said, this can be noted as future work. The priority is solving the problem well on one platform rather than solving it less effectively across both.
