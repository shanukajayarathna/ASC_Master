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
      q: "How does Focus mode work (tablet valuation)?",
      a: "In the Valuation Centre, press \"Focus mode\" (or the expand button on any row) to work one lot at a time, full screen with no other distractions. The bar at the very top has a universal search (it matches any column of the catalogue, so you can jump to any row), a valuation-progress filter, and a Filters button that opens the same per-column filter panel as Catalogue Manager (ticket status, classification, and every column of the sheet); matching rows appear as a tappable strip underneath, and they decide which lots Focus mode steps through. Below that, a details box shows the lot's full data — lot number, selling mark, mark code, grade, chests, weight per chest, standard, remarks, liquor remarks, current valuation, asking price and minimum limit — then the four classification tiers, and a row of equal-size entry containers: Standard, Adjectives, Remarks and Liquor Remarks, with the valuation calculator keypad on the far right — its two lines take a single value on the first, or a range across both (the keypad's \"Range\" key jumps to the second line). Everything you've typed is saved together when you tap Save & Next (or press Enter) or move between lots; classification is still required before moving on, but tapping a tier keeps you on the lot — advance with Save & Next or the arrows. Esc or \"All lots\" returns to the list.",
    },
    {
      q: "Can I hide the sidebar?",
      a: "Yes — the hamburger button at the top-left collapses the sidebar to give the workspace the full width (handy on tablets); press it again to bring the sidebar back. On phones the same button opens the navigation as an overlay drawer. Your choice is remembered.",
    },
    {
      q: "What counts as a valid valuation?",
      a: "A valuation is always a whole value in LKR of at most four digits, from 50 to 9999 — e.g. 1250. You can also give a range; the first number must be lower than the second. In the Valuation Centre list you type a range with a dash (1200-1350); in Focus mode the calculator has two lines instead — fill the first alone for a single value, or both for a range. Anything else is rejected with a message telling you what to fix.",
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
