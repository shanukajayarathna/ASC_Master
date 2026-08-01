import ComingSoon from "@/components/shared/ComingSoon";

export default function ReportsPage() {
  return (
    <ComingSoon
      title="Reports"
      description="The Report Builder (Executive/Broker/Grade/Category/Garden/Classification/Valuation summaries with print-to-PDF and Excel export) shipped in the previous vanilla-JS build. It needs report-generation endpoints on the API before it can be re-wired here."
      features={[
        "Executive, Broker, Grade, Category, Garden and Classification summaries",
        "Print / Save as PDF",
        "Export underlying data to Excel",
        "Save generated reports for later",
      ]}
    />
  );
}
