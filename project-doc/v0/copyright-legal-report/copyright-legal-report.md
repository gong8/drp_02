# BeThere - Copyright and Legal Issues Report

This report places BeThere (Expo React Native client, Fastify/tRPC/Postgres backend, Vercel web target) in the wider legal space: the licences of the third-party code we actively included, what publishing would require, who owns the content, and the data-protection and content duties a launch would create. It is scoped to the app's own codebase and content, not presentation or documentation assets. Licences are the `license` field declared by each package, grouped by type; transitive sub-dependencies are not listed.

## Third-party resources and their licences

| Resource (libraries we actively included) | Licence type | Ships in product? |
|---|---|---|
| React, React Native, React Native Web, Expo SDK and expo-* modules, React Navigation, tRPC (client and server), Fastify and @fastify/* , Zod, pg, Pino, @clerk SDKs, @react-native-community/datetimepicker, react-native-screens, safe-area-context | MIT | Yes |
| drizzle-orm | Apache-2.0 | Yes |
| dotenv | BSD-2-Clause | Yes (config) |
| @vercel/og (OpenGraph share-card image generation, `api/og.ts`) | MPL-2.0 (weak copyleft) | Yes (web) |
| PostgreSQL database engine | PostgreSQL Licence (BSD-style permissive) | Yes (server) |
| Fonts: Archivo, Inter (Space Mono bundled via its npm wrapper but no longer rendered) | MIT AND OFL-1.1 (wrapper code MIT; font files SIL OFL 1.1) | Yes (app) |
| TypeScript (Apache-2.0); drizzle-kit, Biome, tsx, Jest, jest-expo, Vitest, Babel, pnpm, types packages (MIT) | Apache-2.0 / MIT | No (build/dev only) |
| Hosted services: Clerk (Google OAuth), AWS App Runner + RDS, Vercel, Expo/EAS build, GitHub Actions | Commercial terms of service, not software licences | n/a (services) |

Headline. The stack is permissive-dominant: MIT for the large majority, with Apache-2.0 (drizzle-orm), BSD-2-Clause (dotenv), the PostgreSQL Licence, and SIL OFL 1.1 fonts. There is no strong copyleft anywhere (no GPL, AGPL or LGPL), so no source-disclosure or "viral" relicensing risk. The one weak-copyleft component is @vercel/og (MPL-2.0), used to render share-link preview images on the web target; MPL applies at the level of individual files, not the whole codebase.

## Compliance if BeThere were published

Treating a real GitHub release as the test, the standing obligation is modest. The MIT, BSD-2-Clause and PostgreSQL components only require retaining their copyright and licence notices (an in-app "Licences" screen plus a NOTICE file satisfies this). Apache-2.0 (drizzle-orm) adds an express patent grant in our favour and a duty to reproduce any upstream NOTICE on redistribution. @vercel/og (MPL-2.0) is used unmodified, so the duty is to keep its notice and make its MPL-covered files' source available; because MPL is file-level it does not reach our own code. The OFL fonts may be bundled provided the OFL text and copyright lines are retained and the fonts are not sold on their own. At release the team should confirm the exact licence text shipped in `node_modules`.

## Copyright of content on the service

The code, the BeThere wordmark and the neobrutalist visual system are the team's own work; the only bundled third-party creative assets are the fonts above (licensed, not owned), and the app ships no stock photography or icon packs. The substantive content is user-generated: plan and activity names, group names, notes, profile names and RSVP data. Users retain copyright in what they write, so a release would need terms of service granting BeThere a licence to store and display that content to the group, while making clear the team claims no ownership of it. The seeded demo data is fictional and team-authored.

## Wider legal implications

Data protection (UK GDPR). BeThere stores personal data: identities via Clerk and Google OAuth, group membership, and RSVP behaviour, including the conditional "I'll go if [people]" data and the "brought-by" attribution on plus-one links. A record of who someone wants to socialise with is behaviourally sensitive even if not a special category. A public release would need a privacy policy, a lawful basis (consent or legitimate interests), access and deletion rights, a retention stance for cleared and fizzled plans, and a data-residency safeguard for UK users (the database runs on AWS RDS in us-east-1). Clerk and AWS act as processors and would need data-processing agreements. The always-on anonymity and trace-free fizzle aid data minimisation, but the current open CORS and dev auth-bypass are prototype shortcuts to close before launch.

Content and conduct. Because group names, activity names, notes and invite links are free text, a launched service must expect inappropriate, abusive or spam content and unbounded invite-link sharing. A real deployment would need reporting and moderation, the ability to remove content and users, and abuse controls; the product already has a per-IP rate limit and a joins-lock "door" that the creator can close to stop an invite link being re-shared without limit, which are first steps rather than a full moderation system.
