"use client";

import Button from "@mui/material/Button";
import Link from "next/link";

export default function DataImportPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-bold text-text-strong mb-1">Data Import</h1>
      <p className="text-[13px] text-text-muted mb-5">
        Bring lot catalogues into ASC. Files are uploaded to the ASP.NET Core API, parsed server-side (ClosedXML for
        Excel, a built-in CSV parser for .csv) and stored in MongoDB.
      </p>
      <div className="border border-border rounded-lg bg-surface p-7">
        <h2 className="font-display text-lg text-text-strong mb-2">Single-file import is live</h2>
        <p className="text-[13px] text-text-muted mb-4 leading-relaxed">
          Go to Catalogue Manager and drop a .xls, .xlsx or .csv file, or click &quot;Choose file&quot;. Column
          headers, types (numeric/categorical) and typed fields (lot number, broker, grade, garden, etc.) are
          detected automatically, mirroring the heuristics from the original browser-only version — now run once,
          server-side, at import time.
        </p>
        <Button component={Link} href="/catalogue" variant="contained">
          Go to Catalogue Manager
        </Button>
      </div>
      <p className="text-[11.5px] text-text-muted mt-4">
        Multi-file batch import, duplicate detection across files, and catalogue merge/compare are on the roadmap.
      </p>
    </div>
  );
}
