"use client";

import { formatCurrency, formatNumber } from "@/lib/format";
import type { AuctionReport, GradeBlock, ReportBlock } from "@/types/api";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { useState } from "react";

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border rounded-[var(--radius-lg)] bg-surface p-3">
      <div className="font-display text-lg font-bold text-text-strong">{formatNumber(value)}</div>
      <div className="text-[11px] text-text-muted">{label}</div>
    </div>
  );
}

function GradeTable({ grade, includeElevation }: { grade: GradeBlock; includeElevation: boolean }) {
  return (
    <div className="mb-4">
      <div className="font-mono text-[10.5px] tracking-widest uppercase text-text-muted mb-1.5">Grade: {grade.grade}</div>
      {grade.rows.length === 0 ? (
        <div className="text-[12.5px] text-text-muted italic px-1">No priced rows for this grade.</div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-[var(--radius-lg)]">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-surface-alt border-b border-border">
                <th className="text-right px-3 py-1.5 font-medium text-text-muted">Rank</th>
                <th className="text-left px-3 py-1.5 font-medium text-text-muted">Broker</th>
                <th className="text-left px-3 py-1.5 font-medium text-text-muted">Selling Mark</th>
                {includeElevation && <th className="text-left px-3 py-1.5 font-medium text-text-muted">Sub Elevation</th>}
                <th className="text-right px-3 py-1.5 font-medium text-text-muted">Price</th>
                <th className="text-left px-3 py-1.5 font-medium text-text-muted">Buyer</th>
                <th className="text-left px-3 py-1.5 font-medium text-text-muted">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {grade.rows.map((r, i) => (
                <tr
                  key={i}
                  className="border-b border-border last:border-0"
                  style={r.isOurs ? { background: "var(--sage-light)" } : undefined}
                >
                  <td className="px-3 py-1.5 text-right font-mono">{r.rank}</td>
                  <td className="px-3 py-1.5" style={r.isOurs ? { fontWeight: 600, color: "var(--sage-dark)" } : undefined}>
                    {r.broker}
                  </td>
                  <td className="px-3 py-1.5">{r.sellingMark}</td>
                  {includeElevation && <td className="px-3 py-1.5">{r.subElevation ?? "—"}</td>}
                  <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(r.price)}</td>
                  <td className="px-3 py-1.5">{r.buyerName ?? r.buyer ?? "—"}</td>
                  <td className="px-3 py-1.5">{r.remark ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BlockPanel({ block, includeElevation }: { block: ReportBlock; includeElevation: boolean }) {
  return (
    <div className="mb-6">
      <h4 className="font-display text-[15px] font-semibold text-text-strong mb-2.5">{block.title}</h4>
      {block.grades.length === 0 ? (
        <div className="text-[12.5px] text-text-muted italic">No matching data for this section.</div>
      ) : (
        block.grades.map((g) => <GradeTable key={g.grade} grade={g} includeElevation={includeElevation} />)
      )}
    </div>
  );
}

/** Renders one AuctionReportDto: stats tiles, then a tabbed set of sheets (Combined Report's
 *  four families each supply this — see reports/combined/page.tsx). */
export default function AuctionReportView({ report }: { report: AuctionReport }) {
  const [activeSheet, setActiveSheet] = useState(0);
  const sheet = report.sheets[activeSheet] ?? report.sheets[0];

  return (
    <div className="report-print-area">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5 mb-4 print:hidden">
        <StatTile label="ASC Top Price" value={report.stats.top} />
        <StatTile label="ASC Top 3" value={report.stats.top4} />
        <StatTile label="ASC Absent" value={report.stats.absent} />
        <StatTile label="Grades" value={report.stats.total} />
        <StatTile label="Rows" value={report.stats.rows} />
        <StatTile label="Outsold Excluded" value={report.stats.outsold} />
      </div>

      {report.sheets.length > 1 && (
        <Tabs
          value={activeSheet}
          onChange={(_, v) => setActiveSheet(v)}
          variant="scrollable"
          scrollButtons="auto"
          className="mb-3 print:hidden"
        >
          {report.sheets.map((s, i) => (
            <Tab key={s.title} value={i} label={s.title} sx={{ textTransform: "none", fontSize: 13 }} />
          ))}
        </Tabs>
      )}

      {sheet ? (
        sheet.blocks.map((b, i) => <BlockPanel key={i} block={b} includeElevation={sheet.includeElevation} />)
      ) : (
        <div className="text-text-muted text-sm py-8 text-center">No sheets in this report.</div>
      )}
    </div>
  );
}
