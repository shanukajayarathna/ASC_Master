/** A titled, bordered content card — the same shell Settings and the Admin Panel both build
 *  their sections out of (users table, API keys table, file manager, …). */
export default function SectionCard({
  id,
  title,
  subtitle,
  actions,
  children,
}: {
  /** Anchor id (e.g. "users") so other pages can deep-link straight to this section with
   *  `/admin#users` — offset by scroll-margin-top so the fixed Topbar doesn't cover it. */
  id?: string;
  title: string;
  subtitle?: string;
  /** Right-aligned slot next to the title (e.g. a status chip). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-8" style={id ? { scrollMarginTop: "80px" } : undefined}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="font-display text-[15px] font-semibold text-text-strong m-0">{title}</h2>
        {actions}
      </div>
      {subtitle && <p className="text-[12.5px] text-text-muted m-0 mb-3">{subtitle}</p>}
      <div className="border border-border rounded-[var(--radius-lg)] bg-surface p-4">{children}</div>
    </section>
  );
}
