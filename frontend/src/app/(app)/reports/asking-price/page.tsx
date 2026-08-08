import ComingSoon from "@/components/shared/ComingSoon";

export default function AskingPricePage() {
  return (
    <ComingSoon
      title="Asking Price"
      description="The same fast worksheet as above, for pre-auction asking prices rather than post-auction valuations. A rough working copy — not saved back into sale data."
      features={[
        "Same bulk pricing table, sort and jump-to-lot as Worksheet",
        "Its own session, kept separate from Worksheet",
        "Export to Excel / PDF and Print",
      ]}
      backHref="/reports"
      backLabel="Reports"
    />
  );
}
