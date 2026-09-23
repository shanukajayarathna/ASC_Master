"use client";

import type { FactoryGrademixReport, GrademixGradeRow, GrademixSaleRef } from "@/types/api";
import { DivergingBars, GroupedBarChart, Legend, VolumeValueBars, pct, rs, rs2, signed } from "./charts";
import { GrademixLeft, GrademixRight } from "./GrademixTables";

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
const saleName = (s: GrademixSaleRef) => `Sale ${s.saleNo}`;
const kg = (n: number) => `${Math.round(n).toLocaleString("en-US")} kg`;

function Section({ title, sub, tone, children }: { title: string; sub?: string; tone?: "next"; children: React.ReactNode }) {
  return (
    <section className="mb-7 break-inside-avoid-page">
      <div className="flex items-baseline gap-3 flex-wrap mb-3 pb-1.5 border-b-2" style={{ borderColor: tone === "next" ? "var(--info)" : "var(--brand-olive)" }}>
        <h2 className="font-display text-[18px] font-semibold text-text-strong m-0">{title}</h2>
        {sub && <span className="text-[12.5px] text-text-muted">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "good" | "bad" }) {
  return (
    <div className="border border-border rounded-[var(--radius-md)] px-3.5 py-2.5" style={{ background: "var(--surface)" }}>
      <div className="text-[10.5px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`font-mono text-[21px] tabular-nums ${tone === "good" ? "text-[var(--series-3)]" : tone === "bad" ? "text-danger" : "text-text-strong"}`}>{value}</div>
      {note && <div className="text-[11.5px] text-text-muted leading-snug">{note}</div>}
    </div>
  );
}

function valueShares(rows: GrademixGradeRow[]) {
  const priced = rows.filter((r) => r.avgRs != null && r.qtyPct != null);
  const totalValue = priced.reduce((s, r) => s + r.qty * (r.avgRs ?? 0), 0);
  return priced
    .map((r) => ({ label: r.grade, volumePct: r.qtyPct ?? 0, valuePct: totalValue > 0 ? ((r.qty * (r.avgRs ?? 0)) / totalValue) * 100 : 0 }))
    .sort((a, b) => b.valuePct - a.valuePct);
}

export default function FactorySheet({ report }: { report: FactoryGrademixReport }) {
  const { factory, national, present, monthly, upcoming } = report;
  const pt = present.table;
  const diff = pt.factoryAvgRs != null ? pt.factoryAvgRs - national.avgRs : null;
  const presentIdx = monthly.findIndex((m) => m.inProgress);
  const shares = valueShares([...pt.main, ...pt.off]);

  return (
    <div className="report-print-area">
      <div className="mb-5">
        <h1 className="font-display text-[26px] font-semibold text-text-strong m-0 leading-tight">{factory.name}</h1>
        <p className="m-0 mt-1 text-[13px] text-text-muted">
          {factory.code}
          {factory.elevationLabel ? ` · ${factory.elevationLabel}` : ""} · {factory.section.charAt(0) + factory.section.slice(1).toLowerCase()}
          {factory.marks.length > 0 ? ` · Marks: ${factory.marks.join(", ")}` : ""}
        </p>
      </div>

      {/* ---------------- last sale ---------------- */}
      <Section title={`${saleName(present.sale)} — last sale`} sub={`${fmtDate(present.sale.date)} · sold lots only · prices in Rs/kg`}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Kpi label="Sold" value={kg(present.soldKg)} note={`${pct((present.soldKg / Math.max(1, present.offeredKg)) * 100, 1)} of ${kg(present.offeredKg)} offered`} />
          <Kpi label="Factory average" value={`Rs ${rs2(pt.factoryAvgRs)}`} note="weighted by kg sold" />
          <Kpi label="National average" value={`Rs ${rs2(national.avgRs)}`} note={national.label} />
          <Kpi
            label="Above / below national"
            value={diff == null ? "–" : `${signed(diff)}`}
            tone={diff == null ? undefined : diff >= 0 ? "good" : "bad"}
            note={national.isStale ? "Tea Board hasn't published this month yet — latest month used" : "Rs/kg vs Tea Board elevation average"}
          />
        </div>

        <div className="grid lg:grid-cols-[1.05fr_1fr] gap-6 items-start">
          <GrademixLeft table={pt} />
          <div className="flex flex-col gap-5">
            <GrademixRight table={pt} nationalLabel={national.label} />
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 mt-5">
          <div className="border border-border rounded-[var(--radius-md)] p-4" style={{ background: "var(--surface)" }}>
            <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-0.5">How the grade groups moved the average</h3>
            <p className="m-0 mb-3 text-[12px] text-text-muted">Rs/kg each group adds to (green) or takes off (red) the factory average, against the national average.</p>
            <DivergingBars
              rows={[
                ...pt.leafy.map((g) => ({ label: g.name, value: g.contriValue })),
                { label: "Small leafy", value: pt.smallLeafy.contriValue },
                { label: "Off grade", value: pt.offGrade.contriValue },
              ]}
            />
          </div>
          <div className="border border-border rounded-[var(--radius-md)] p-4" style={{ background: "var(--surface)" }}>
            <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-0.5">Which grades earned the money</h3>
            <p className="m-0 mb-3 text-[12px] text-text-muted">Share of kg sold vs share of value, top grades. Longer value bar = pulls the average up.</p>
            <VolumeValueBars rows={shares.slice(0, 8)} />
          </div>
        </div>
      </Section>

      {/* ---------------- month by month ---------------- */}
      {monthly.length > 0 && (
      <Section title="Month by month" sub="Factory average per calendar month against the Tea Board elevation average">
        <div className="border border-border rounded-[var(--radius-md)] p-4" style={{ background: "var(--surface)" }}>
          <Legend
            items={[
              { name: `${factory.name} average`, color: "var(--series-1)" },
              { name: `Tea Board ${factory.elevationLabel ?? "elevation"} average`, color: "var(--series-4)" },
            ]}
          />
          <GroupedBarChart
            ariaLabel="Factory monthly average price against the Tea Board elevation average"
            labels={monthly.map((m) => (m.inProgress ? `${m.label} (to date)` : m.label))}
            highlight={presentIdx >= 0 ? presentIdx : undefined}
            series={[
              { name: "Factory", color: "var(--series-1)", values: monthly.map((m) => m.avgRs) },
              { name: "Tea Board", color: "var(--series-4)", values: monthly.map((m) => m.teaBoardAvgRs) },
            ]}
          />
          <div className="overflow-x-auto mt-3">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr style={{ background: "var(--surface-alt)" }}>
                  {["Month", "Sales", "Sold kg", "Avg Rs", "Tea Board Rs", "Difference"].map((h) => (
                    <th key={h} className="px-2 py-1 border border-border text-right first:text-left text-[10.5px] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => (
                  <tr key={m.label} className={m.inProgress ? "font-semibold" : ""}>
                    <td className="px-2 py-[3px] border border-border">{m.label}</td>
                    <td className="px-2 py-[3px] border border-border text-right font-mono">{m.sales || "–"}</td>
                    <td className="px-2 py-[3px] border border-border text-right font-mono">{m.soldKg > 0 ? rs(m.soldKg) : "–"}</td>
                    <td className="px-2 py-[3px] border border-border text-right font-mono">{rs2(m.avgRs)}</td>
                    <td className="px-2 py-[3px] border border-border text-right font-mono">{m.teaBoardAvgRs == null ? <span className="text-text-muted" title="Not yet published by the Tea Board">not yet</span> : rs2(m.teaBoardAvgRs)}</td>
                    <td className={`px-2 py-[3px] border border-border text-right font-mono ${m.avgRs != null && m.teaBoardAvgRs != null && m.avgRs < m.teaBoardAvgRs ? "text-danger" : ""}`}>
                      {m.avgRs != null && m.teaBoardAvgRs != null ? signed(m.avgRs - m.teaBoardAvgRs) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
      )}

      {/* ---------------- next sale ---------------- */}
      {upcoming ? (
        <Section
          tone="next"
          title={`${saleName(upcoming.sale)} — next sale`}
          sub={`Catalogue as listed today · expected prices from ${upcoming.priceBasisSales.map((s) => `Sale ${s.saleNo}`).reverse().join(", ")}`}
        >
          {upcoming.table ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <Kpi label="In the catalogue" value={kg(upcoming.catalogueKg)} note={`${pct(upcoming.wholeSale.factoryShareOfSalePct, 2)} of the whole sale`} />
                <Kpi label="Expected average" value={`Rs ${rs2(upcoming.table.factoryAvgRs)}`} note="trailing average, not a forecast of the market" />
                <Kpi
                  label={`vs ${saleName(present.sale)} result`}
                  value={upcoming.expectedVsPresentRs == null ? "–" : signed(upcoming.expectedVsPresentRs)}
                  tone={upcoming.expectedVsPresentRs == null ? undefined : upcoming.expectedVsPresentRs >= 0 ? "good" : "bad"}
                  note="Rs/kg change from the grade mix on offer"
                />
                <Kpi label="Offered last sale" value={kg(present.offeredKg)} note={`${kg(Math.abs(upcoming.catalogueKg - present.offeredKg))} ${upcoming.catalogueKg >= present.offeredKg ? "more" : "less"} this time`} />
              </div>

              <div className="grid lg:grid-cols-[1.05fr_1fr] gap-6 items-start">
                <GrademixLeft table={upcoming.table} expected qtyHead="Catalogue kg" avgHead="Exp. avg Rs" prevHead={`${saleName(present.sale)} offered %`} />
                <GrademixRight table={upcoming.table} nationalLabel={`${national.label} (held constant)`} avgLabel="Expected factory avg" />
              </div>

              <div className="grid lg:grid-cols-2 gap-6 mt-5">
                <div className="border border-border rounded-[var(--radius-md)] p-4" style={{ background: "var(--surface)" }}>
                  <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-2">Last sale vs expected</h3>
                  <GroupedBarChart
                    ariaLabel="Last sale average, expected next sale average and national average"
                    height={220}
                    labels={[`${saleName(present.sale)} result`, `${saleName(upcoming.sale)} expected`, "National avg"]}
                    colors={["var(--series-1)", "var(--series-3)", "var(--series-4)"]}
                    series={[{ name: "Rs/kg", color: "var(--series-1)", values: [pt.factoryAvgRs, upcoming.table.factoryAvgRs, national.avgRs] }]}
                  />
                </div>
                <div className="border border-border rounded-[var(--radius-md)] p-4" style={{ background: "var(--surface)" }}>
                  <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-0.5">How the grade groups will move the average</h3>
                  <p className="m-0 mb-3 text-[12px] text-text-muted">Same reading as last sale, on the expected mix.</p>
                  <DivergingBars
                    rows={[
                      ...upcoming.table.leafy.map((g) => ({ label: g.name, value: g.contriValue })),
                      { label: "Small leafy", value: upcoming.table.smallLeafy.contriValue },
                      { label: "Off grade", value: upcoming.table.offGrade.contriValue },
                    ]}
                  />
                </div>
              </div>
            </>
          ) : (
            <p className="text-[13px] text-text-muted m-0 mb-4">This factory has no lots in the {saleName(upcoming.sale)} catalogue yet.</p>
          )}

          <div className="border border-border rounded-[var(--radius-md)] p-4 mt-5" style={{ background: "var(--surface)" }}>
            <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-0.5">The whole {saleName(upcoming.sale)} catalogue</h3>
            <p className="m-0 mb-3 text-[12px] text-text-muted">
              {kg(upcoming.wholeSale.totalKg)} in {upcoming.wholeSale.lots.toLocaleString("en-US")} lots from {upcoming.wholeSale.factories.toLocaleString("en-US")} factories.
              Bars show how much is on offer in each elevation; the figures are the average that elevation fetched over the same price-basis sales.
            </p>
            <div className="flex flex-col gap-2">
              {upcoming.wholeSale.elevations.map((e) => (
                <div key={e.elevation} className="grid grid-cols-[110px_1fr_170px] max-sm:grid-cols-[90px_1fr] items-center gap-3 text-[12.5px]">
                  <span className={e.isFactoryElevation ? "font-semibold text-text-strong" : "text-text"}>
                    {e.label}
                    {e.isFactoryElevation ? " ★" : ""}
                  </span>
                  <span className="h-[18px] rounded-[3px] relative" style={{ background: "var(--surface-sunken)" }}>
                    <span
                      className="absolute inset-y-0 left-0 rounded-[3px]"
                      style={{ width: `${e.sharePct}%`, background: e.isFactoryElevation ? "var(--series-1)" : "var(--series-other)" }}
                    />
                    <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-semibold text-white mix-blend-normal" style={{ textShadow: "0 0 3px rgba(0,0,0,.45)" }}>
                      {Math.round(e.kg / 1000).toLocaleString("en-US")}k kg · {e.sharePct.toFixed(1)}%
                    </span>
                  </span>
                  <span className="font-mono tabular-nums text-text max-sm:col-span-2 text-right max-sm:text-left">
                    exp. {rs(e.expectedAvgRs)}
                    {e.teaBoardAvgRs != null && <span className="text-text-muted"> · Tea Board {rs(e.teaBoardAvgRs)}</span>}
                  </span>
                </div>
              ))}
            </div>
            <p className="m-0 mt-2 text-[11px] text-text-muted">★ this factory&apos;s elevation.</p>
          </div>
        </Section>
      ) : (
        <Section tone="next" title="Next sale">
          <p className="text-[13px] text-text-muted m-0">No upcoming catalogue is on file yet — it appears here as soon as the next sale&apos;s catalogue is added.</p>
        </Section>
      )}
    </div>
  );
}
