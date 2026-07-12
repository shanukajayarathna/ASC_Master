import ComingSoon from "@/components/shared/ComingSoon";

export default function MarketPage() {
  return (
    <ComingSoon
      title="Market Intelligence"
      description="Importing actual post-sale auction prices and comparing them against valuations (accuracy %, RMSE, MAPE, plain-language insights) shipped in the previous vanilla-JS build. The ActualPrice table already exists in the database — it needs an import endpoint and comparison queries."
      features={[
        "Import actual auction results, matched by lot number",
        "Accuracy %, MAPE, RMSE overall and by broker/grade/elevation",
        "Plain-language over/under-valuation insights",
      ]}
    />
  );
}
