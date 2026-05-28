// Sage palette - the BeThere visual identity. Flat, one accent, hairline borders.
export const colors = {
  bg: "#F7F8F3",
  surface: "#FFFFFF",
  ink: "#1F2823",
  muted: "#8B948B",
  accent: "#5F9472",
  accentInk: "#3F7355",
  accentSoft: "#E9F1EB",
  line: "#E9ECE5",
} as const;

// Status accents (mockups colour-code RSVP state). Going reuses the sage accent.
export const status = {
  going: "#5F9472",
  goingSoft: "#E9F1EB",
  pending: "#C98A2B",
  pendingSoft: "#F6ECD9",
  declined: "#C0573F",
  declinedSoft: "#F4E3DE",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { md: 12, lg: 15, xl: 18, sheet: 28 } as const;

// Fonts (Lora/Inter) are deferred in this skeleton - system font + weights for now.
