export default function KpiSection({
  title,
  subtitle,
  children,
  compact,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <section className="mb-6">
      <div className="flex items-baseline gap-2.5 mb-2.5">
        <h4 className="font-display text-[14.5px] font-semibold text-text-strong m-0">{title}</h4>
        {subtitle && <span className="text-[11.5px] text-text-muted">{subtitle}</span>}
      </div>
      <div
        className="grid gap-2.5"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? "165px" : "190px"}, 1fr))`,
        }}
      >
        {children}
      </div>
    </section>
  );
}
