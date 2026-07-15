export default function HelpPage() {
  const faqs = [
    {
      q: "How do I import a catalogue?",
      a: "Go to Catalogue Manager and drop an .xls, .xlsx or .csv file, or click Choose file. It's uploaded to the API, parsed and stored in MongoDB.",
    },
    {
      q: "How do I value lots?",
      a: "The fast way: in Catalogue Manager, tick the lots you want and choose \"Valuation\" — they open in the Valuation Centre as one list. On each row, type the value and press Enter to save, then classify: classification is required, so you can't move to the next lot until you pick a tier — use the arrow keys to highlight one and Enter to confirm, press 1-4, or click a chip — once you do, focus jumps on automatically. The arrow keys also move freely around the whole grid (up/down between lots, left/right across a row's fields), saving anything you've typed as you go. Use the \"Also fill\" toggles to add extra columns like Taster's Remarks and work them in the same pass. For a single lot with full remarks, click \"Open ticket\" on its row instead to use the Valuation drawer.",
    },
    {
      q: "What counts as a valid valuation?",
      a: "A valuation is always a whole 4-digit value in LKR, from 1000 to 9999 — e.g. 1250. You can also give a range by typing both numbers with a dash, e.g. 1200-1350; the first number must be lower than the second. Anything else is rejected with a message telling you what to fix.",
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
