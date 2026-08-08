# 02 — UI/UX Design System

## Purpose
Define the visual and interaction language of the platform so every new screen looks and behaves like it belongs to the same product, without contributors re-deriving colour, spacing, or motion choices per feature.

## Scope
Cross-cutting design principles and rules. Concrete token values live in [21_Design_Tokens.md](21_Design_Tokens.md); reusable components live in [20_Component_Library.md](20_Component_Library.md). This document is the "why" and "when"; those two are the "what" and "how".

## Responsibilities
- State the design philosophy and the principles that resolve ambiguous UI decisions.
- Define typography, spacing/grid, and core primitives (cards, buttons, inputs) at a rules level.
- Set accessibility, responsiveness, and motion expectations that apply everywhere.

## Architecture
Implemented as a two-layer token system: CSS custom properties in `frontend/src/app/globals.css` (`:root` for light, `:root[data-theme="dark"]` for dark) are the canonical source, mirrored by hand into `frontend/src/theme/tokens.ts` because MUI's palette helpers (`alpha()`, `darken()`, `lighten()`) need literal values and can't parse CSS custom properties. Both must be updated together — see [21_Design_Tokens.md](21_Design_Tokens.md).

## UI behaviour

### Design philosophy
Warm and editorial, not generic SaaS-blue. The palette is drawn from tea itself — a burnt-orange/brown "liquor" accent, a gold "brass" accent, an olive "sage" accent — over warm ink/paper neutrals, rather than a cool corporate blue-and-grey system. Module tiles on the dashboard launchpad use full-bleed photography (verified Unsplash sources) plus a brand-gradient overlay, giving the home screen a product-catalogue feel rather than an admin-panel feel.

### Typography
System-first font stack via MUI/Tailwind defaults (no custom webfont currently loaded — verify in `frontend/src/theme/theme.ts` before assuming otherwise). Hierarchy follows MUI's `Typography` variant scale; use it rather than ad hoc `font-size` values so type stays consistent across MUI and Tailwind-styled areas.

### Spacing & grid
MUI's 8px spacing unit is the baseline grid for all component spacing. Page layouts are content-width, not edge-to-edge — recent history (`43d8080 Remove fixed max-width caps instead of just widening them`) shows a deliberate move away from artificially narrow fixed-width containers toward layouts that use available width without hard caps; new pages should follow that precedent rather than reintroducing a fixed `max-width`.

### Cards
The primary content container across dashboard KPIs, module tiles, and list rows. Use consistent corner radius and elevation from the token set (see [21_Design_Tokens.md](21_Design_Tokens.md)) rather than one-off shadow values.

### Buttons
Use MUI `Button` variants (contained/outlined/text) mapped to the brand palette — `liquor` for primary actions, neutral ink for secondary, `danger` reserved for destructive actions only (delete lot, delete user, revoke API key). Never introduce a new accent colour for a single button.

### Inputs
MUI form controls throughout, styled via the shared theme rather than per-form overrides. The Valuation Centre's drawer/focus-mode inputs (value range, classification, remarks) are the reference implementation for form density on data-entry-heavy screens — see [10_Valuation_Centre.md](10_Valuation_Centre.md).

### Animations & micro-interactions
Motion should be purposeful and brief: hover/press feedback on tiles and buttons, panel open/close transitions, and the command palette's open animation. Avoid decorative animation that delays task completion — this is a working tool used on a sale floor, not a marketing site. The one branded loading animation (`TeaLoader` — a refined tea-leaf silhouette over a thin data-flow line, deliberately not a literal cup/steam illustration; composed with the brand mark as `FullScreenLoader` for boot/route-transition moments) and the rules for when it — versus a skeleton, versus a plain button busy-state — applies are documented in [28_Loading_And_Interaction_States.md](28_Loading_And_Interaction_States.md); all of it respects `prefers-reduced-motion`.

### Icons
Material Icons (`@mui/icons-material`, "Outlined" variants) throughout, as seen in `frontend/src/components/shell/nav.ts`. Use the outlined family consistently; don't mix filled and outlined icon styles in the same view.

### Dark mode / light mode
Both are first-class, not an afterthought — every token in `globals.css` has a light and a dark value, and AG Grid's v36 Theming API reads the same CSS custom properties so the grid follows the toggle automatically. Any new colour must be added to both `:root` and `:root[data-theme="dark"]` blocks, and mirrored in `theme/tokens.ts`.

### Accessibility
Baseline expectation: sufficient colour contrast in both themes, keyboard operability for the command palette and all form controls, and semantic MUI components used as intended (not divs styled to look like buttons). Every busy/disabled control (save, create, delete, import, export) pairs `disabled` with `aria-busy` — see [28_Loading_And_Interaction_States.md](28_Loading_And_Interaction_States.md). No formal accessibility audit exists yet in the codebase — see [26_Testing_Strategy.md](26_Testing_Strategy.md) for where this should be added.

### Responsive design
The platform must remain usable on tablet — the Valuation Centre explicitly ships a "tablet-friendly focus mode" for sale-floor use (per its nav description). Test any new data-entry screen at tablet width, not just desktop. Phone-width support is not a stated requirement today; tablet is the documented minimum secondary breakpoint. See [19_Performance.md](19_Performance.md) for related on-device performance concerns.

### Illustration & photography
Module tiles use real photography (Unsplash), individually verified (HTTP 200 + visual check) before being wired in — not stock illustration or icon-only tiles. If a tile has no photo, it falls back to the plain gradient + icon treatment rather than a broken image.

### Dashboard-first experience
See [03_Dashboard_Experience.md](03_Dashboard_Experience.md).

### Navigation philosophy
See [04_Navigation_Architecture.md](04_Navigation_Architecture.md).

## Business rules
Not applicable — this document is design guidance, not business logic.

## Dependencies
[21_Design_Tokens.md](21_Design_Tokens.md), [20_Component_Library.md](20_Component_Library.md), [03_Dashboard_Experience.md](03_Dashboard_Experience.md), [04_Navigation_Architecture.md](04_Navigation_Architecture.md), [28_Loading_And_Interaction_States.md](28_Loading_And_Interaction_States.md).

## Future expansion
Formal accessibility audit and a documented phone-width breakpoint strategy, if/when mobile app or phone-web support is prioritised (see [27_Future_Roadmap.md](27_Future_Roadmap.md)).

## Implementation notes
Source of truth for actual values: `frontend/src/app/globals.css` and `frontend/src/theme/tokens.ts` (light/dark mirrors — keep in sync), `frontend/src/theme/theme.ts` (MUI theme wiring).

## Open questions
- No documented webfont/typography choice beyond system defaults — confirm intentional before changing.
- No formal breakpoint list is documented yet beyond "desktop + tablet supported, phone unconfirmed" — should be made explicit in [21_Design_Tokens.md](21_Design_Tokens.md).

## Best practices
- Always add new colours to both theme blocks (light + dark) and both files (CSS vars + `tokens.ts`) in the same change.
- Reuse existing MUI variants and token values before inventing a new one-off style.
- Test data-entry-heavy screens at tablet width before calling them done.
