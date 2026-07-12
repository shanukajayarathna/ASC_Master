import ComingSoon from "@/components/shared/ComingSoon";

export default function AnalysisPage() {
  return (
    <ComingSoon
      title="Analysis"
      description="Mean/median/mode, standard deviation, quartiles, distribution by classification/grade/broker, Top-N/Bottom-N and data-quality checks — all live in the previous vanilla-JS build. Porting this to server-side aggregation queries against MongoDB is next."
      features={[
        "Mean / median / mode / std. dev / quartiles",
        "Distribution by classification, grade, broker, category",
        "Top-N / Bottom-N valued lots",
        "Outlier, duplicate and missing-valuation detection",
      ]}
    />
  );
}
