import ComingSoon from "@/components/shared/ComingSoon";

export default function ReportStudioPage() {
  return (
    <ComingSoon
      title="Report Studio"
      description="The editable executive bulletin built on top of Combined Report — themes, editable text and sections, image upload, saved templates, and a print-perfect export. The largest piece of this project, built last."
      features={[
        "Edit any text; add, reorder, hide or lock sections",
        "Upload and crop images; switch among built-in themes plus light/dark",
        "Save/load templates and snapshots; undo/redo",
        "Print-perfect PDF export",
      ]}
      backHref="/reports"
      backLabel="Reports"
    />
  );
}
