"use client";

import PageHeader from "@/components/shared/PageHeader";
import Button from "@mui/material/Button";
import Link from "next/link";

export default function ExportsPage() {
  return (
    <div>
      <PageHeader
        title="Exports"
        subtitle="The Catalogue Manager grid ships CSV and Excel export built in."
      />
      <div className="border border-border rounded-lg bg-surface p-7">
        <h2 className="font-display text-lg text-text-strong mb-2">CSV &amp; Excel export are live today</h2>
        <p className="text-[13px] text-text-muted mb-4 leading-relaxed">
          In Catalogue Manager, right-click any cell for the context menu, or use the grid&apos;s built-in toolbar,
          to export the current view (respecting active filters, sort order and column visibility) to CSV or Excel.
          Selected-rows-only export works the same way once rows are selected.
        </p>
        <Button component={Link} href="/catalogue" variant="contained">
          Go to Catalogue Manager
        </Button>
      </div>
      <p className="text-[11.5px] text-text-muted mt-4">
        PDF export of reports and PNG/JPEG export of individual charts return once the Report Builder and Analysis
        modules are ported.
      </p>
    </div>
  );
}
