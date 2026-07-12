import Paper from "@mui/material/Paper";

export default function KpiTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "liquor" | "sage" | "info";
}) {
  const accentColor =
    accent === "liquor" ? "var(--liquor)" : accent === "sage" ? "var(--sage)" : accent === "info" ? "var(--info)" : "var(--brass)";

  return (
    <Paper
      variant="outlined"
      className="p-4 transition-transform hover:-translate-y-0.5"
      sx={{ borderColor: "var(--border)", bgcolor: "var(--surface)" }}
    >
      <div
        className="w-2 h-2 rounded-full mb-2"
        style={{ background: accentColor }}
      />
      <div className="font-mono text-[21px] font-semibold text-text-strong leading-tight break-words">
        {value}
      </div>
      <div className="text-[11.5px] text-text-muted mt-1.5">{label}</div>
    </Paper>
  );
}
