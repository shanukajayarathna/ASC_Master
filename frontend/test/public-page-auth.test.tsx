import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  value: {
    user: { id: "1" },
    loading: false,
    logout: vi.fn(),
  },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => auth.value,
}));

import { useForceLogoutOnPublicPage } from "@/hooks/useForceLogoutOnPublicPage";

describe("useForceLogoutOnPublicPage", () => {
  beforeEach(() => {
    auth.value = { user: { id: "1" }, loading: false, logout: vi.fn() };
  });

  it("logs out an authenticated visitor once and reports the notice state", async () => {
    const { result } = renderHook(() => useForceLogoutOnPublicPage());

    await waitFor(() => expect(auth.value.logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current).toBe(true));

    expect(auth.value.logout).toHaveBeenCalledTimes(1);
  });

  it("does not log out a visitor who initially resolved unauthenticated", async () => {
    auth.value = { user: null, loading: false, logout: vi.fn() };
    const { result } = renderHook(() => useForceLogoutOnPublicPage());

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(auth.value.logout).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });
});
