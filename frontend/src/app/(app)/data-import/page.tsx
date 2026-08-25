"use client";

import PageHeader from "@/components/shared/PageHeader";
import Button from "@mui/material/Button";
import Link from "next/link";

export default function DataImportPage() {
  return (
    <div>
      <PageHeader
        title="Data Import"
        subtitle="Bring lot catalogues into ASC. Files are uploaded to the API, parsed server-side and stored."
      />
      <div className="border border-border rounded-[var(--radius-lg)] bg-surface p-7">
        <p className="text-[13px] text-text-muted mb-4 leading-relaxed">
          <strong className="text-text-strong">Single-file import is live.</strong> Go to Catalogue Manager and drop
          a .xls, .xlsx or .csv file, or click &quot;Choose file&quot;. Column headers, types (numeric/categorical)
          and typed fields (lot number, broker, grade, garden, etc.) are detected automatically, mirroring the
          heuristics from the original browser-only version — now run once, server-side, at import time.
        </p>
        <Button component={Link} href="/catalogue" variant="contained">
          Go to Catalogue Manager
        </Button>
      </div>
      <p className="text-[12px] text-text-muted mt-4">
        Multi-file batch import, duplicate detection across files, and catalogue merge/compare are on the roadmap.
      </p>
    </div>
  );
}
