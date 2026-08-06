// Central brand tokens shared between Tailwind (via CSS vars in globals.css) and the MUI theme.
// MUI's palette needs literal values (its alpha()/darken()/lighten() helpers can't parse a
// CSS custom property), so this can't be a single source — it's a hand-kept mirror of
// globals.css's `:root` block. Keep it in sync: any brand-color edit there must land here too.
export const lightTokens = {
  ink900: "#111827", ink800: "#1F2937", ink700: "#374151", inkMuted: "#667085",
  paper0: "#FFFFFF", paper50: "#F9FAFB", paper100: "#F1F3F5", paper200: "#E4E7EB", line: "#E2E5EA",
  liquor: "#8A3A16", liquorDark: "#672A0E",
  brass: "#C1920C", brassLight: "#E3B93F",
  sage: "#717C21", sageLight: "#EFF2DC",
  danger: "#A62F23",
};

// Mirrors globals.css's `:root[data-theme="dark"]` block — see note above.
export const darkTokens = {
  ink900: "#F3F4F6", ink800: "#E2E4E9", ink700: "#C7CAD1", inkMuted: "#8B90A0",
  paper0: "#16181D", paper50: "#1B1E24", paper100: "#23262E", paper200: "#2C303A", line: "#383C46",
  liquor: "#DE8B62", liquorDark: "#C87249",
  brass: "#E0B23C", brassLight: "#EFCE74",
  sage: "#A8B45E", sageLight: "#262C15",
  danger: "#E28874",
};
