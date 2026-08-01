import ComingSoon from "@/components/shared/ComingSoon";

export default function SavedReportsPage() {
  return (
    <ComingSoon
      title="Saved Reports"
      description="Arrives together with the Report Builder — a SavedReport table already exists in the database, ready for a listing endpoint once reports can be generated again."
      features={["Archive of generated reports", "Reopen, re-export or delete a saved report"]}
    />
  );
}
