// Build-time step (run after `expo export` in the Vercel buildCommand): inject a generic, branded
// OpenGraph card into the exported SPA's index.html so EVERY route (the bare domain, the dashboard,
// etc.) unfurls as a clean BeThere card - not the raw "<title>drp-02</title>". The per-meetup and
// per-group Functions (api/m, api/join) override this with their own card for /m and /join links.
//
// The og:image points at the dynamic /api/og endpoint; it must be ABSOLUTE for scrapers, so we build
// it from VERCEL_URL (set at build on Vercel) and fall back to a relative path locally (where it is
// never scraped anyway).

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Copy the app's brand TTFs into dist/fonts so the OG image Function (api/og.ts) can fetch them
// same-origin and render the card in Archivo/Inter (matching the app). Best-effort: the Function
// falls back to its default font if a file is missing, so a copy failure never breaks the build.
const FONTS = [
  "@expo-google-fonts/archivo/800ExtraBold/Archivo_800ExtraBold.ttf",
  "@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf",
];
const fontsDir = new URL("../dist/fonts/", import.meta.url);
try {
  mkdirSync(fontsDir, { recursive: true });
  for (const rel of FONTS) {
    const src = new URL(`../../../node_modules/${rel}`, import.meta.url);
    const dest = new URL(rel.split("/").pop(), fontsDir);
    if (existsSync(src)) copyFileSync(src, dest);
    else console.warn(`inject-og: brand font missing, OG card will use the default font: ${rel}`);
  }
  console.log("inject-og: copied brand fonts to dist/fonts");
} catch (err) {
  console.warn("inject-og: font copy failed (OG card will use the default font):", err?.message);
}

const file = new URL("../dist/index.html", import.meta.url);
const TITLE = "BeThere";
const DESCRIPTION =
  "Turn 'we should hang out' into a firm plan - no organiser, no public maybe. No app to download.";
const SUBTITLE = "Plan real meetups with your groups";

const origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
const image = `${origin}/api/og?title=${encodeURIComponent(TITLE)}&subtitle=${encodeURIComponent(SUBTITLE)}`;

const tags = [
  `<meta name="description" content="${DESCRIPTION}"/>`,
  `<meta property="og:type" content="website"/>`,
  `<meta property="og:title" content="${TITLE}"/>`,
  `<meta property="og:description" content="${DESCRIPTION}"/>`,
  `<meta property="og:image" content="${image}"/>`,
  `<meta property="og:image:width" content="1200"/>`,
  `<meta property="og:image:height" content="630"/>`,
  `<meta name="twitter:card" content="summary_large_image"/>`,
  `<meta name="twitter:title" content="${TITLE}"/>`,
  `<meta name="twitter:description" content="${DESCRIPTION}"/>`,
  `<meta name="twitter:image" content="${image}"/>`,
].join("");

let html = readFileSync(file, "utf8");

if (html.includes('property="og:title"')) {
  console.log("inject-og: OG meta already present, skipping");
} else {
  // Replace the default Expo title (else keep an existing one), then splice the meta into <head>.
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${TITLE}</title>`);
  if (html.includes("</head>")) {
    html = html.replace("</head>", `${tags}</head>`);
    writeFileSync(file, html);
    console.log(`inject-og: injected baseline OG meta (image origin: ${origin || "relative"})`);
  } else {
    console.warn("inject-og: no </head> found in dist/index.html; skipped");
  }
}
