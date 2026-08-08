# 21 — Design Tokens

## Purpose
Provide the canonical, concrete values behind [02_UI_UX_Design_System.md](02_UI_UX_Design_System.md)'s principles, so "use the brass accent" or "use radius-md" has one unambiguous answer.

## Scope
Token values only — colors, radius, shadow, transitions, breakpoints. Not the reasoning behind them (see [02_UI_UX_Design_System.md](02_UI_UX_Design_System.md)) or reusable components built from them (see [20_Component_Library.md](20_Component_Library.md)).

## Responsibilities
- Be the single canonical value source for every design token.
- Flag the two-file duplication (CSS vars + `tokens.ts`) that must stay in sync.

## Architecture
Canonical source: `frontend/src/app/globals.css`, `:root` (light) and `:root[data-theme="dark"]` (dark). Mirrored by hand into `frontend/src/theme/tokens.ts` (`lightTokens`/`darkTokens`) because MUI's palette helpers (`alpha()`, `darken()`, `lighten()`) require literal values, not CSS custom properties. **Any token change must be made in both files.**

## UI behaviour
AG Grid's v36 Theming API reads the same CSS custom properties as the rest of the app, so the grid follows the light/dark toggle automatically without separate grid-specific tokens.

## Business rules

### Colors
| Token | Light | Dark |
|---|---|---|
| `ink900` (primary text) | `#111827` | `#F3F4F6` |
| `ink800` | `#1F2937` | `#E2E4E9` |
| `ink700` | `#374151` | `#C7CAD1` |
| `inkMuted` | `#667085` | `#8B90A0` |
| `paper0` (background) | `#FFFFFF` | `#16181D` |
| `paper50` | `#F9FAFB` | `#1B1E24` |
| `paper100` | `#F1F3F5` | `#23262E` |
| `paper200` | `#E4E7EB` | `#2C303A` |
| `line` (borders) | `#E2E5EA` | `#383C46` |
| `liquor` (primary brand accent) | `#8A3A16` | `#DE8B62` |
| `liquorDark` | `#672A0E` | `#C87249` |
| `brass` (secondary accent) | `#C1920C` | `#E0B23C` |
| `brassLight` | `#E3B93F` | `#EFCE74` |
| `sage` (tertiary accent) | `#717C21` | `#A8B45E` |
| `sageLight` | `#EFF2DC` | `#262C15` |
| `danger` | `#A62F23` | `#E28874` |

### Typography
No custom webfont — system font stack via MUI/Tailwind defaults, MUI `Typography` variant scale for hierarchy. See [02_UI_UX_Design_System.md](02_UI_UX_Design_System.md).

### Spacing
MUI's 8px base unit.

### Grid
Content-width layouts, no artificial `max-width` caps (see [02_UI_UX_Design_System.md](02_UI_UX_Design_System.md), referencing commit `43d8080`).

### Radius
`--radius-sm: 10px; --radius-md: 16px; --radius-lg: 22px; --radius-xl: 28px;` — a "soft-premium" scale used consistently across tiles, cards, and inputs (`globals.css`).

### Elevation / Shadows
Light theme: `--shadow-sm: 0 1px 2px rgba(17,24,39,.06), 0 1px 3px rgba(17,24,39,.04)`; `--shadow-md: 0 2px 6px rgba(17,24,39,.08), 0 6px 16px rgba(17,24,39,.06)`; `--shadow-lg: 0 8px 28px rgba(17,24,39,.14), 0 2px 8px rgba(17,24,39,.08)`.
Dark theme: `--shadow-sm: 0 1px 2px rgba(0,0,0,.4)`; `--shadow-md: 0 2px 8px rgba(0,0,0,.45), 0 8px 20px rgba(0,0,0,.35)`; `--shadow-lg: 0 10px 32px rgba(0,0,0,.55), 0 2px 10px rgba(0,0,0,.4)`. Dark-theme shadows are deliberately heavier/more opaque than light-theme equivalents to read correctly on dark surfaces.

### Transitions / Animation durations
Card/tile hover lift uses `transform + box-shadow` only (never layout-affecting properties), `160ms ease` — chosen to feel immediate without being abrupt, and disabled entirely under `prefers-reduced-motion` (`globals.css` sets `transition: none` in that media query).

### Breakpoints
No formal named breakpoint scale is documented in the token files today — responsive behaviour follows MUI's default breakpoint system. Tablet width is the confirmed minimum secondary target (Valuation Centre focus mode); phone width is unconfirmed. See [02_UI_UX_Design_System.md](02_UI_UX_Design_System.md)'s open question.

### Z-index
No dedicated z-index token scale documented — relies on MUI component defaults (drawers, dialogs, app bar) rather than custom stacking values. Flag for consolidation if a real z-index conflict is ever hit.

### Icons
Material Icons, "Outlined" variant family, via `@mui/icons-material`.

### Illustrations / Branding
Full-bleed verified Unsplash photography on module tiles, overlaid with one of eight brand gradients:
`--tile-gradient-1` through `--tile-gradient-8`, each a `135deg` linear-gradient built from the palette above (e.g. gradient-2 is `liquorDark → liquor`, gradient-3 is a gold pairing, gradient-5 is `ink900 → info`). See `frontend/src/components/shell/nav.ts` for which module uses which gradient.

## Dependencies
[02_UI_UX_Design_System.md](02_UI_UX_Design_System.md) (rationale), [20_Component_Library.md](20_Component_Library.md) (consumers), `frontend/src/app/globals.css` and `frontend/src/theme/tokens.ts` (actual source).

## Future expansion
A formal named breakpoint scale; a documented z-index scale if/when stacking conflicts arise.

## Implementation notes
When adding or changing a token: edit `globals.css`'s `:root` and `:root[data-theme="dark"]` blocks **and** the matching entries in `theme/tokens.ts` in the same change — the file header comment in `tokens.ts` exists specifically to warn against forgetting this.

## Open questions
- No automated check (lint rule, test) currently enforces that `tokens.ts` stays in sync with `globals.css` — worth adding given it's a hand-kept mirror by explicit admission in the code comment.

## Best practices
Never introduce a new one-off color, radius, or shadow value inline in a component — extend the token set (in both files) if the existing scale genuinely doesn't cover the need.
