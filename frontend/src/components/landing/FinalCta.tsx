import Button from "@mui/material/Button";
import Link from "next/link";

/** Full-width brand-gradient band — the standard closing CTA beat on a landing page, using the
 *  same `--rule-brand` gradient the dashboard's own "Continue Valuing" banner uses. */
export default function FinalCta({ ctaLabel }: { ctaLabel: string }) {
  return (
    <section className="py-14 sm:py-16" style={{ background: "var(--rule-brand)" }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <p
          className="font-display font-bold m-0 mb-6"
          style={{ color: "#fff", fontSize: "clamp(22px, 3vw, 30px)" }}
        >
          Bring intelligence to your next sale week.
        </p>
        <Button
          component={Link}
          href="/login"
          variant="contained"
          size="large"
          sx={{ background: "rgba(255,255,255,0.95)", color: "var(--liquor-dark)", "&:hover": { background: "#fff" } }}
        >
          {ctaLabel}
        </Button>
      </div>
    </section>
  );
}
