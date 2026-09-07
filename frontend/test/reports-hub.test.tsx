import { render, screen } from "@testing-library/react";
import ReportsLaunchpadPage from "@/app/(app)/reports/page";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ fill: _fill, ...props }: React.ComponentProps<"img"> & { fill?: boolean }) => <img {...props} />,
}));

describe("Reports hub", () => {
  it("exposes the core report destinations as navigable links", () => {
    render(<ReportsLaunchpadPage />);

    expect(screen.getByRole("heading", { name: "Reports" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Executive & Summary Reports/ })).toHaveAttribute("href", "/reports/summary");
    expect(screen.getByRole("link", { name: /Weekly Market Grade Classification/ })).toHaveAttribute("href", "/reports/market-bulletin");
    expect(screen.getByRole("link", { name: /Broker Comparison Rankings/ })).toHaveAttribute("href", "/broker");
    expect(screen.getByRole("link", { name: /Saved Reports Every report/ })).toHaveAttribute("href", "/saved-reports");
  });
});
