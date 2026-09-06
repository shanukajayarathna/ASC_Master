import PageHeader from "@/components/shared/PageHeader";
import { HELP_FAQS } from "@/lib/helpFaqs";

/** Content lives in lib/helpFaqs.ts, shared with the Knowledge Base hub's own Help section
 *  (folded in per the ASIS overhaul — see knowledge/page.tsx) so the two never drift apart.
 *  This page itself is unchanged and stays directly reachable; it's just off the primary
 *  dashboard grid now that its content also lives in Knowledge Base (nav.ts hiddenFromGrid). */
export default function HelpPage() {
  return (
    <div>
      <PageHeader title="Help" subtitle="Quick answers for common tasks in the ASC platform." />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        {HELP_FAQS.map((f) => (
          <div key={f.q} className="border border-border rounded-[var(--radius-lg)] bg-surface p-4">
            <h3 className="font-display text-[15px] text-text-strong mb-1.5">{f.q}</h3>
            <p className="text-[13px] text-text-muted leading-relaxed m-0">{f.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
