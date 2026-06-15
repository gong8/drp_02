# #65 — CD Deployment

`source: edstem thread #65`

**Question:** Can a CSG VM be used for the CD deployment requirement, and can opening port 80 for TCP make it publicly accessible?

**Answer (Jamie Willis):** A CSG VM will work technically, but users outside Imperial will not be able to reach it because it sits behind the college firewall, limiting user testing to people inside Imperial.

**Answer (Mark Wheelhouse):** Deploying to a CSG VM does satisfy the CI/CD criteria for the milestone. However, obtaining a firewall exception to make it publicly accessible is impossible — ICT will not approve such exceptions for student projects. Teams will almost certainly face issues with external user testing as a result.
