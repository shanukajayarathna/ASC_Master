import AgentWorkspaceStub, { classicChatHref } from "@/components/agent-hub/AgentWorkspaceStub";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

describe("agent workspace route (until real workspaces exist)", () => {
  beforeEach(() => nav.replace.mockClear());

  it("never dead-ends: it forwards to the chat with that agent selected", () => {
    render(<AgentWorkspaceStub agent="analytics" />);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/assistant/classic?agent=analytics");
  });

  it("uses replace, not push, so Back returns to the hub instead of bouncing", () => {
    render(<AgentWorkspaceStub agent="reports" />);
    expect(nav.replace).toHaveBeenCalled();
  });

  it("tells assistive tech what is happening", () => {
    render(<AgentWorkspaceStub agent="auction" />);
    expect(screen.getByRole("status")).toHaveTextContent("Opening the Auction agent…");
  });

  it("builds the chat link for every agent", () => {
    expect(classicChatHref("general")).toBe("/assistant/classic?agent=general");
  });
});
