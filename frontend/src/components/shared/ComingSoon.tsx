"use client";

import Button from "@mui/material/Button";
import Link from "next/link";

export default function ComingSoon({
  title,
  description,
  features,
}: {
  title: string;
  description: string;
  features: string[];
}) {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-bold text-text-strong mb-1">{title}</h1>
      <div className="border border-border rounded-lg bg-surface p-9 text-center shadow-sm my-5">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-brass-dim text-brass flex items-center justify-center font-display text-xl">
          →
        </div>
        <h2 className="font-display text-xl text-text-strong mb-2">{title} — not yet ported to the new stack</h2>
        <p className="text-[13.5px] text-text-muted max-w-lg mx-auto leading-relaxed">{description}</p>
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        {features.map((f) => (
          <div key={f} className="border border-border rounded-md bg-surface px-3.5 py-3 text-[12.5px] text-text flex gap-2.5 items-start">
            <span className="w-1.5 h-1.5 rounded-full bg-brass mt-1.5 shrink-0" />
            {f}
          </div>
        ))}
      </div>
      <div className="mt-5">
        <Button component={Link} href="/dashboard" variant="outlined" size="small">
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}
