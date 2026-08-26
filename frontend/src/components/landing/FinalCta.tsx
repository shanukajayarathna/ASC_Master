export default function FinalCta({ ctaLabel }: { ctaLabel: string }) {
  return (
    <section className="py-20 sm:py-24" style={{ background: "var(--tea-liquor)" }}>
      <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
        <p
          className="font-display font-bold leading-tight m-0 mb-8"
          style={{ color: "var(--tea-ink)", fontSize: "clamp(26px, 3.6vw, 40px)" }}
        >
          Bring intelligence to your next sale week.
        </p>
        <a
          href="/login"
          className="no-underline inline-flex items-center px-8 py-4 rounded-full text-[14px] font-semibold transition-transform hover:-translate-y-0.5"
          style={{ background: "var(--tea-ink)", color: "var(--tea-ledger)" }}
        >
          {ctaLabel}
        </a>
      </div>
    </section>
  );
}
