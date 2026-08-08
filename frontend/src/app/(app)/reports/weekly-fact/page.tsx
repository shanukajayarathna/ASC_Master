import ComingSoon from "@/components/shared/ComingSoon";

export default function WeeklyFactReportsPage() {
  return (
    <ComingSoon
      title="Weekly FACT Reports"
      description="UVA/WESTERN High & Medium ranking workbooks, rebuilt from the Colombo Brokers' Association elevation-average release and the factory-wise sale workbook. Both are external documents your sale catalogues don't carry, so this stays a small manual upload even once built."
      features={[
        "Upload the CBAS elevation-average text release + factory-wise workbook",
        "Rebuilds the four FACT ranking workbooks from a verified template",
        "A fifth combined workbook, downloadable individually or zipped",
      ]}
      backHref="/reports"
      backLabel="Reports"
    />
  );
}
