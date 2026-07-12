export default function HelpPage() {
  const faqs = [
    {
      q: "How do I import a catalogue?",
      a: "Go to Catalogue Manager and drop an .xls, .xlsx or .csv file, or click Choose file. It's uploaded to the API, parsed and stored in PostgreSQL.",
    },
    {
      q: "How do I value a lot?",
      a: "Click \"Open ticket\" on any row in Catalogue Manager to open the Valuation drawer. Enter a From/To range or a single value, pick a classification, add remarks, then Save Ticket.",
    },
    {
      q: "Can I select and update multiple lots at once?",
      a: "Yes — select rows with the checkboxes in Catalogue Manager and use the bulk toolbar that appears to classify, or clear notes, for all selected lots at once.",
    },
    {
      q: "Where do exports happen?",
      a: "The Catalogue Manager grid (AG Grid Enterprise) has built-in CSV/Excel export via its context menu and toolbar.",
    },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-bold text-text-strong mb-1">Help</h1>
      <p className="text-[13px] text-text-muted mb-5">Quick answers for common tasks in the ASC platform.</p>
      <div className="flex flex-col gap-3">
        {faqs.map((f) => (
          <div key={f.q} className="border border-border rounded-md bg-surface p-4">
            <h3 className="font-display text-[15px] text-text-strong mb-1.5">{f.q}</h3>
            <p className="text-[13px] text-text-muted leading-relaxed m-0">{f.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
