import AssistantHubPage from "@/app/(app)/assistant/page";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: nav.redirect, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/context/CatalogueContext", () => ({ useCatalogue: () => ({ activeCatalogue: null }) }));

const render = (q?: string | string[]) => AssistantHubPage({ searchParams: Promise.resolve({ q }) });

describe("/assistant server page", () => {
  beforeEach(() => {
    nav.redirect.mockReset();
    // Next's redirect() never returns: it throws a control-flow error. Mimic that.
    nav.redirect.mockImplementation((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });
  });

  it("redirects a prefilled question to the classic chat before rendering the hub", async () => {
    await expect(render("top prices")).rejects.toThrow("NEXT_REDIRECT:/assistant/classic?q=top%20prices");
    expect(nav.redirect).toHaveBeenCalledTimes(1);
  });

  it("encodes the prefill safely", async () => {
    await expect(render("a&b=c #x")).rejects.toThrow("NEXT_REDIRECT:/assistant/classic?q=a%26b%3Dc%20%23x");
  });

  it("uses the first value when ?q= is repeated", async () => {
    await expect(render(["first", "second"])).rejects.toThrow("q=first");
  });

  it("renders the hub when there is no prefill, and ignores an empty one", async () => {
    expect(await render()).toBeTruthy();
    expect(await render("")).toBeTruthy();
    expect(nav.redirect).not.toHaveBeenCalled();
  });
});
