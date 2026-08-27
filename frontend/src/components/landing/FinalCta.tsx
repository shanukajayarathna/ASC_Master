import Button from "@mui/material/Button";
import Link from "next/link";

/** Same brand-gradient CTA banner pattern the dashboard uses for "Continue Valuing"
 *  (`rounded-[var(--radius-lg)]`, `--rule-brand` gradient, white text on top). */
export default function FinalCta({ ctaLabel }: { ctaLabel: string }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-6">
      <div
        className="rounded-[var(--radius-lg)] p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-4"
        style={{ background: "var(--rule-brand)" }}
      >
        <p className="font-display text-[18px] sm:text-[20px] font-bold m-0 text-center sm:text-left" style={{ color: "#fff" }}>
          Bring intelligence to your next sale week.
        </p>
        <Button
          component={Link}
          href="/login"
          variant="contained"
          sx={{ background: "rgba(255,255,255,0.95)", color: "var(--liquor-dark)", "&:hover": { background: "#fff" }, whiteSpace: "nowrap" }}
        >
          {ctaLabel}
        </Button>
      </div>
    </div>
  );
}
