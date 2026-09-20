import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver; components that size themselves from their box (PageHeader's
// placeholder, charts) need one to mount at all. A no-op is enough — layout is not under test.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom does not implement scrollIntoView / scrollTo on elements.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
