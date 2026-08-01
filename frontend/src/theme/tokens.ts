// Central brand tokens shared between Tailwind (via CSS vars in globals.css) and the MUI theme.
// MUI's palette needs literal values (its alpha()/darken()/lighten() helpers can't parse a
// CSS custom property), so this can't be a single source — it's a hand-kept mirror of
// globals.css's `:root` block. Keep it in sync: any brand-color edit there must land here too.
export const lightTokens = {
  ink900: "#14180B", ink800: "#272D18", ink700: "#40472C", inkMuted: "#7B8066",
  paper0: "#FFFFFF", paper50: "#FAF9EF", paper100: "#F2F0DE", paper200: "#E6E3C9", line: "#D7D3B4",
  liquor: "#8A3A16", liquorDark: "#672A0E",
  brass: "#C1920C", brassLight: "#E3B93F",
  sage: "#717C21", sageLight: "#EFF2DC",
  danger: "#A62F23",
};

// Mirrors globals.css's `:root[data-theme="dark"]` block — see note above.
export const darkTokens = {
  ink900: "#F2F1E2", ink800: "#E4E3CD", ink700: "#C4C4A6", inkMuted: "#8B8E70",
  paper0: "#15180D", paper50: "#1B1F11", paper100: "#242817", paper200: "#2F3420", line: "#454A2F",
  liquor: "#DE8B62", liquorDark: "#C87249",
  brass: "#E0B23C", brassLight: "#EFCE74",
  sage: "#A8B45E", sageLight: "#262C15",
  danger: "#E28874",
};
