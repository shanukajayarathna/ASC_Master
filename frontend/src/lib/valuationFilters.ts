// Filter vocabulary shared by the Valuation Centre list and its full-screen focus view.

export type StatusFilter = "all" | "pending" | "unvalued" | "needs-classification" | "complete";

export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending (anything left to do)" },
  { value: "unvalued", label: "Not valued yet" },
  { value: "needs-classification", label: "Needs classification" },
  { value: "complete", label: "Complete" },
];
