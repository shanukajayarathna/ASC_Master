# 28 — Loading & Interaction States

## Purpose
Record why the app's loading/busy UI is shaped the way it is, so a future change (a new async action, a new page) follows the same decision rules instead of reinventing them per-component.

## Scope
Frontend-only: full-screen boot/route-transition loading, page-level skeletons, button/dialog busy states, and the accessibility/reduced-motion rules attached to all of them. Not backend request handling, not the file-backed catalogue store's own warm/cache behaviour (see [19_Performance.md](19_Performance.md)).

## Responsibilities
- Define which of full-screen / skeleton / button / inline loading applies to a given situation.
- Own the one branded loading animation (`TeaLoader`), its full-screen composition (`FullScreenLoader`), and the one global navigation overlay (`NavigationLoader`).
- Set the house convention for new async actions (`useAsyncAction`) so double-submits stay prevented without every component re-deriving the same guard.

## Architecture
No global `LoadingProvider`/context. This was a deliberate choice, not an oversight: every async flow already in the app (`ValuationDrawer`'s save, every Settings create/delete dialog, `ExportShareMenu`'s export/share, `CatalogueContext`'s import/select) already scopes its own busy state locally with correct `try/finally` cleanup. A global provider layered on top would be redundant indirection fighting a convention that already works everywhere it's been checked — so instead there's a small shared *hook*, not a shared *store*:

- **`frontend/src/hooks/useAsyncAction.ts`** — wraps "busy boolean + synchronous re-entry guard + cleanup" for new call sites. A `useRef` guard backs the `busy` state because React batches state updates: a fast double-click or double-Enter can call the handler twice before a `useState`-only flag would have re-rendered to reflect the first call already being in flight.
- **`frontend/src/components/shared/TeaLoader.tsx`** — the one branded loading animation: a refined tea-leaf outline (inline SVG, stroke-based, not a flat cartoon fill) settling into a slow continuous float, with a thin dashed line beneath it animated to read as data flowing along a path. Deliberately *not* a cup/steam/pouring illustration — see "Visual identity" below. Reusable bare, at any size, for small inline "this list is loading" spots (Knowledge Base, Settings tabs, Saved Reports, Saved Filters, Reports generation) where a plain spinner used to sit.
- **`frontend/src/components/shared/FullScreenLoader.tsx`** — composes the real brand mark (`BrandLogo`) above `TeaLoader` above a status line, each settling in slightly after the last. This is the app's actual "loading identity" for the handful of moments that warrant one; `TeaLoader` alone (no logo) is for the smaller inline spots above.
- **`frontend/src/components/shell/NavigationLoader.tsx`** — one global overlay for client-side route transitions, mounted once in the root layout, rendering `FullScreenLoader`. Built on the standards-based Navigation API (`window.navigation`'s `navigate`/`navigatesuccess`/`navigateerror` events), not a `history.pushState` patch — Next's own App Router already patches `pushState`/`replaceState` internally for its routing, so a second patch on top either gets silently overwritten or double-fires (confirmed by inspecting the live-patched `history.pushState` in a running dev session). Debounced (150ms show-delay so a fast/prefetched transition never flashes it) with a 350ms minimum-visible time (so a transition that finishes just after the delay doesn't pop in and instantly vanish). The full-screen dark scrim blocks clicks for the duration (so a slow navigation can't be turned into three by someone re-clicking the tile) and pulls keyboard focus onto itself while visible (`tabIndex={-1}` + a focus effect), so Tab can't reach a control on the page underneath that a click couldn't either.
- **`frontend/src/components/shared/SkeletonBlock.tsx`** — `SkeletonRows`/`SkeletonCard`, both bare MUI `Skeleton` composition (no custom shimmer CSS — matches the dashboard's own pre-existing skeleton). Not pixel-matched per page; good enough to prevent a blank-content flash on first load.

Explicitly not built: Next.js `loading.tsx` route files. Every page in this app is a `"use client"` component that fetches its own data via `useEffect` after mount, not a server component streamed behind a Suspense boundary — `loading.tsx` only intercepts the latter. This was confirmed empirically while building `NavigationLoader`: `navigatesuccess` fires almost immediately once a client route's component tree commits, regardless of how long that page's own data fetch subsequently takes — so a `loading.tsx` file here would never trigger for the thing it looks like it should cover.

### Visual identity — why not a teacup
`TeaLoader`'s first version was literally a cup with rising steam and a falling leaf. It got rebuilt into the current leaf-and-data-flow design because "cup + steam" reads as a tea *shop's* mark — a hospitality visual — not an enterprise auction-intelligence platform's. The tea reference still needed to be immediately recognisable (this is ASC, not a generic dashboard), but conveyed the way a premium tea brand's own identity would use it: a refined leaf silhouette, not a beverage illustration. The thin animated data-flow line underneath is what turns "tea" into "tea auction intelligence" — it's the same visual idea as `NavigationLoader`'s own reasoning for existing at all, made explicit in the mark itself: **tea → data → intelligence**, not tea → cup → pouring.

## UI behaviour
Decision rules, in order:

1. **Full-screen (`FullScreenLoader`, standalone or inside `NavigationLoader`'s overlay)** — only for application boot/auth-state restoration and route transitions. Never for a single API request inside an already-rendered page.
2. **Page skeleton (`SkeletonRows`/`SkeletonCard`, or a page's own bespoke `Skeleton` composition like the dashboard's KPI strip)** — for a page's primary data on first load, so the layout never sits blank while data streams in.
3. **Button/dialog busy state** — disable the triggering control(s), swap the label to a present-participle string ("Saving…", "Importing…"), add `aria-busy`. This is the existing, correct pattern almost everywhere already (`ValuationDrawer`, every Settings dialog, `ExportShareMenu`); `useAsyncAction` is there for *new* call sites so they don't have to re-derive the re-entry guard by hand.
4. **Inline** — small, in-place indicators for things that don't block the rest of the page: the AI Assistant's three-dot "thinking" indicator, the command palette's debounced Knowledge Base search.

No fabricated progress. Catalogue import shows a clear busy state (dropzone/button disabled, `TeaLoader` + "Importing sale file…") but not a fake percentage or fake stage list ("Reading catalogue… Processing lots…") — the backend has no in-flight progress signal for this (`ImportStatus`/`ImportActualsResult` are final-result-only types; `lib/api.ts`'s `importCatalogue` is a plain `fetch`, no `XMLHttpRequest`/`onprogress`), and inventing stage text that doesn't correspond to a real checkpoint would be actively misleading. Same reasoning for the AI Assistant: `ChatResponse` is a single non-streaming JSON response, so there is no real "which tool is running" signal to surface — the thinking indicator says "ASC AI is thinking…", not a fabricated "Searching catalogues…".

## Business rules
Not applicable — this document is technical/UX, not business logic.

## Dependencies
[02_UI_UX_Design_System.md](02_UI_UX_Design_System.md) (visual language the loading states must match), [03_Dashboard_Experience.md](03_Dashboard_Experience.md) (the dashboard's KPI-strip skeleton, the first instance of this pattern), [22_Frontend_Architecture.md](22_Frontend_Architecture.md) (where these files sit in the tree), [25_Coding_Standards.md](25_Coding_Standards.md) (the `useAsyncAction` convention for new async actions).

## Future expansion
- Real catalogue-import progress, if the backend ever grows a streaming/polling status endpoint — the frontend pieces (busy state, `TeaLoader`) already exist and would just need real stage data plumbed in instead of the current single "Importing…" message.
- Real AI tool-stage progress, if `Modules/Assistant`'s chat endpoint ever streams instead of returning one JSON response.

## Implementation notes
`prefers-reduced-motion: reduce` disables `TeaLoader`'s leaf/data-flow animation, `FullScreenLoader`'s staggered fade-in, and the AI Assistant's typing-dot pulse (one shared media-query block in `globals.css`, extended rather than duplicated each time a new animation is added). `aria-busy` is set alongside every `disabled={busy}` on the buttons this pass touched or retrofitted (ValuationDrawer's save, all Settings create/delete dialogs, ExportShareMenu's export/share, the AI Assistant's send button, login's submit, catalogue's import controls).

## Open questions
- Whether a formal automated check should enforce that every new `disabled={busyFlag}` button also gets a matching `aria-busy` — today this is a reviewed convention, not a lint rule.

## Best practices
- Reach for `useAsyncAction` on a new save/create/delete/import action instead of hand-rolling a `useState` busy flag — it's the same amount of code and gets the re-entry guard for free.
- Never invent progress text (percentages or stage labels) that doesn't correspond to a real backend checkpoint.
- A page's first-load state should never be a blank `<div>` or a bare line of text — at minimum wrap it in `SkeletonRows`/`SkeletonCard`.
