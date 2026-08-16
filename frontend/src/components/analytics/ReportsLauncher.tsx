"use client";

import type { MslAnalyticsFilter } from "@/types/api";
import Tooltip from "@mui/material/Tooltip";
import dynamic from "next/dynamic";
import { useState } from "react";

const ReportDialog = dynamic(() => import("./ReportDialog"), { ssr: false });

/* =====================================================================
   SELECT YOUR REPORT — the portal's report launcher, rebuilt. Every
   button generates its report instantly from the CURRENT filter slice
   (year/sale/broker/… all apply). Buttons marked "pending" need their
   reference screenshot to be activated 1:1.
   ===================================================================== */

export interface ReportDef {
  id: string;
  title: string;
  pending?: boolean;
}

interface Section {
  title: string;
  accent: string;
  reports: ReportDef[];
}

const SECTIONS: Section[] = [
  {
    title: "Grade Mix",
    accent: "#1F3C6E",
    reports: [
      { id: "factory-grade-mix", title: "Factory Grade Mix" },
      { id: "broker-grade-mix", title: "Broker Wise Grade Mix" },
      { id: "month-grade-mix", title: "Month Wise Grade Mix" },
      { id: "quarter-grade-mix", title: "Quarter Wise Grade Mix" },
      { id: "customize-grade-mix", title: "Customize Grade Mix (Broker Wise)", pending: true },
    ],
  },
  {
    title: "Factory & Buyer",
    accent: "#5B3E8E",
    reports: [
      { id: "factory-wise", title: "Factory Wise" },
      { id: "buyer-wise", title: "Buyer Wise" },
      { id: "factory-profile", title: "Factory Profile", pending: true },
      { id: "buyer-profile", title: "Buyer Profile", pending: true },
    ],
  },
  {
    title: "Catalogue & Sales",
    accent: "#1E6E45",
    reports: [
      { id: "catalogue-qty", title: "Catalogue Qty" },
      { id: "invoice-lines", title: "Invoice Line Details" },
      { id: "sold-unsold", title: "Sold & Unsold Wise" },
      { id: "sharing-marks", title: "Sharing Mark Details", pending: true },
    ],
  },
  {
    title: "Comparison",
    accent: "#8E3557",
    reports: [
      { id: "broker-comparison", title: "Broker Comparison" },
      { id: "factory-comparison", title: "Factory Comparison", pending: true },
      { id: "mark-comparison", title: "Selling Mark Comparison", pending: true },
      { id: "group-comparison", title: "Plantations / Group Comparison", pending: true },
      { id: "yearwise-factory", title: "Year Wise Factory Comparison", pending: true },
    ],
  },
  {
    title: "Other",
    accent: "#A04000",
    reports: [
      { id: "elevation-wise", title: "Elevation Wise" },
      { id: "category-wise", title: "Category Wise Report" },
      { id: "price-range", title: "Price Range" },
      { id: "elevation-factory", title: "Elevation Factory Data", pending: true },
    ],
  },
];

export default function ReportsLauncher({ filter }: { filter: MslAnalyticsFilter }) {
  const [open, setOpen] = useState<ReportDef | null>(null);

  return (
    <section className="border border-border rounded-md bg-surface-sunken/30 p-3">
      <div className="text-center text-[13px] font-semibold text-white rounded px-3 py-1.5 mb-3"
        style={{ background: "#1F3C6E" }}>
        Select Your Report
      </div>
      <div className="flex flex-col gap-3">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="inline-block text-[11.5px] font-semibold text-white rounded px-2.5 py-1 mb-1.5"
              style={{ background: section.accent }}>
              {section.title}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {section.reports.map((r) =>
                r.pending ? (
                  <Tooltip key={r.id} title="Send me this report's screenshot and I'll activate it to match 1:1." placement="top" arrow>
                    <button className="px-3 py-1.5 rounded border border-dashed border-border text-[12px] text-text-muted cursor-help bg-surface/50">
                      {r.title}
                    </button>
                  </Tooltip>
                ) : (
                  <button
                    key={r.id}
                    onClick={() => setOpen(r)}
                    className="px-3 py-1.5 rounded border border-border text-[12px] text-text-strong bg-surface hover:border-brass hover:text-brass transition-colors"
                  >
                    {r.title}
                  </button>
                )
              )}
            </div>
          </div>
        ))}
      </div>
      {open && <ReportDialog report={open} filter={filter} onClose={() => setOpen(null)} />}
    </section>
  );
}
