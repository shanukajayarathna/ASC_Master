/** Color pair (bg/fg) per classification tier — shared by CatalogueGrid, LotViewDialog and
 *  the Analytics distribution chart so a tier reads the same color everywhere it appears,
 *  instead of each consumer hardcoding its own copy (CatalogueGrid and LotViewDialog both
 *  did, verbatim, before this). Label text stays local to each component since that
 *  legitimately differs by context — the grid wants a compact "—" for Unclassified, the
 *  dialog and Analytics want the full word. */
export const CLASSIFICATION_COLOR: Record<string, { bg: string; fg: string }> = {
  SelectBest: { bg: "var(--brass-dim)", fg: "var(--brass)" },
  Best: { bg: "var(--sage-light)", fg: "var(--sage-dark)" },
  BelowBest: { bg: "var(--warn-light)", fg: "var(--warn)" },
  Poor: { bg: "var(--danger-light)", fg: "var(--danger)" },
  Unclassified: { bg: "var(--surface-sunken)", fg: "var(--text-muted)" },
};

export const CLASSIFICATION_LABEL: Record<string, string> = {
  SelectBest: "Select Best",
  Best: "Best",
  BelowBest: "Below Best",
  Poor: "Poor",
  Unclassified: "Unclassified",
};
