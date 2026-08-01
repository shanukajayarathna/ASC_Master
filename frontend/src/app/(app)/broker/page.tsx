import ComingSoon from "@/components/shared/ComingSoon";

export default function BrokerPage() {
  return (
    <ComingSoon
      title="Broker Comparison"
      description="Broker rankings, market share and average-valuation comparisons shipped in the previous vanilla-JS build. Needs a /api/catalogues/{id}/brokers aggregation endpoint before it's wired into the new stack."
      features={[
        "Ranking by lots, market share, average/highest/lowest valuation",
        "Market share bar chart",
        "Average valuation by broker",
      ]}
    />
  );
}
