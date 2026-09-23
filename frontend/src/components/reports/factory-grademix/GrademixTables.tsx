"use client";

import type { GrademixGradeRow, GrademixGroupRow, GrademixTable } from "@/types/api";
import { pct, rs2, signed } from "./charts";

// The company's own grademix sheet layout: MAIN GRADE and OFF GRADE tables on the left
// (Grade | Qty | Avg | Qty %), the leafy summary with contribution values on the right.

const th = "px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide border border-border text-right first:text-left";
const td = "px-2 py-[3px] border border-border text-right tabular-nums first:text-left";

function GradeRows({ rows, expected }: { rows: GrademixGradeRow[]; expected: boolean }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.grade}>
          <td className={`${td} uppercase`}>{r.grade}</td>
          <td className={`${td} font-mono`}>{Math.round(r.qty).toLocaleString("en-US")}</td>
          <td className={`${td} font-mono`}>
            {r.avgRs == null ? (
              <span className="text-danger italic font-sans text-[11px]">no price</span>
            ) : (
              <>
                {rs2(r.avgRs)}
                {r.priceBasis === "elevation" && (
                  <span title="No sales history for this factory — priced from the elevation's average for this grade" className="ml-1 text-warn font-sans text-[10px]">
                    elev.
                  </span>
                )}
              </>
            )}
          </td>
          <td className={`${td} font-mono`}>{pct(r.qtyPct)}</td>
          {expected && <td className={`${td} font-mono text-text-muted`}>{pct(r.prevQtyPct)}</td>}
        </tr>
      ))}
    </>
  );
}

function SumRow({ g, expected, strong }: { g: GrademixGroupRow; expected: boolean; strong?: boolean }) {
  return (
    <tr className={strong ? "font-semibold" : "font-medium"} style={{ background: "var(--surface-sunken)" }}>
      <td className={td}>{g.name}</td>
      <td className={`${td} font-mono`}>{Math.round(g.qty).toLocaleString("en-US")}</td>
      <td className={`${td} font-mono`}>{rs2(g.avgRs)}</td>
      <td className={`${td} font-mono`}>{pct(g.qtyPct)}</td>
      {expected && <td className={td} />}
    </tr>
  );
}

export function GrademixLeft({ table, expected = false, qtyHead = "Qty kg", avgHead = "Avg Rs", prevHead = "Last sale %" }: {
  table: GrademixTable;
  expected?: boolean;
  qtyHead?: string;
  avgHead?: string;
  prevHead?: string;
}) {
  const cols = expected ? 5 : 4;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr style={{ background: "var(--surface-alt)" }}>
            <th className={th}>Grade</th>
            <th className={th}>{qtyHead}</th>
            <th className={th}>{avgHead}</th>
            <th className={th}>Qty %</th>
            {expected && <th className={th}>{prevHead}</th>}
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: "var(--surface-sunken)" }}>
            <td colSpan={cols} className={`${td} font-semibold tracking-wide`}>MAIN GRADE</td>
          </tr>
          <GradeRows rows={table.main} expected={expected} />
          <SumRow g={table.totalMain} expected={expected} />
          <tr style={{ background: "var(--surface-sunken)" }}>
            <td colSpan={cols} className={`${td} font-semibold tracking-wide`}>OFF GRADE</td>
          </tr>
          <GradeRows rows={table.off} expected={expected} />
          <SumRow g={table.totalOff} expected={expected} />
          <SumRow g={table.all} expected={expected} strong />
        </tbody>
      </table>
      {table.unpricedKg > 0 && (
        <p className="m-0 mt-1.5 text-[11.5px] text-text-muted">
          {Math.round(table.unpricedKg).toLocaleString("en-US")} kg has no price basis, so it is left out of every share and average.
        </p>
      )}
    </div>
  );
}

export function GrademixRight({ table, nationalLabel, avgLabel = "Factory avg" }: { table: GrademixTable; nationalLabel: string; avgLabel?: string }) {
  const line = (g: GrademixGroupRow, key?: string, strong = false) => (
    <tr key={key ?? g.name} className={strong ? "font-semibold" : ""} style={strong ? { background: "var(--surface-sunken)" } : undefined}>
      <td className={td}>{g.name}</td>
      <td className={`${td} font-mono`}>{Math.round(g.qty).toLocaleString("en-US")}</td>
      <td className={`${td} font-mono`}>{pct(g.qtyPct)}</td>
      <td className={`${td} font-mono`}>{rs2(g.avgRs)}</td>
      <td className={`${td} font-mono ${g.contriValue >= 0 ? "" : "text-danger"}`}>{signed(g.contriValue)}</td>
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr style={{ background: "var(--surface-alt)" }}>
            <th className={th}>Group</th>
            <th className={th}>Qty</th>
            <th className={th}>Qty %</th>
            <th className={th}>Avg</th>
            <th className={th}>Contri. value</th>
          </tr>
        </thead>
        <tbody>
          {table.leafy.map((g) => line(g))}
          {line(table.totalLeafy, undefined, true)}
          {line(table.smallLeafy)}
          {line(table.offGrade)}
          <tr className="font-semibold" style={{ background: "var(--surface-sunken)" }}>
            <td colSpan={4} className={td}>Total contribution</td>
            <td className={`${td} font-mono`}>{signed(table.totalContri)}</td>
          </tr>
        </tbody>
      </table>
      <div className="grid grid-cols-2 border border-border border-t-0 text-[12px]">
        <div className="px-3 py-2">
          <div className="text-[10.5px] uppercase tracking-wide text-text-muted">National avg</div>
          <div className="font-mono text-[18px] text-text-strong tabular-nums">{rs2(table.nationalAvgRs)}</div>
          <div className="text-[10.5px] text-text-muted leading-tight">{nationalLabel}</div>
        </div>
        <div className="px-3 py-2 border-l border-border" style={{ background: "var(--surface-sunken)" }}>
          <div className="text-[10.5px] uppercase tracking-wide text-text-muted">{avgLabel}</div>
          <div className="font-mono text-[18px] text-text-strong tabular-nums">{rs2(table.factoryAvgRs)}</div>
          <div className="text-[10.5px] text-text-muted leading-tight">
            = national {rs2(table.nationalAvgRs)} {table.totalContri < 0 ? "−" : "+"} {rs2(Math.abs(table.totalContri))}
          </div>
        </div>
      </div>
      <p className="m-0 mt-1.5 text-[11px] text-text-muted">
        Contri. value = (group avg − national avg) × group qty %. The groups add up to factory avg − national avg.
      </p>
    </div>
  );
}
