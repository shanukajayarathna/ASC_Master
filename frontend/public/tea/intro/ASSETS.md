# Tea Cinematic — asset manifest

The login page's "Ceylon Tea Journey" intro (`src/components/auth/TeaCinematic.tsx`) is
driven by the scene manifest in `src/components/auth/teaIntroScenes.ts`. All photographic
scenes are **real, verified-license Ceylon imagery** — sources, authors, and licenses in
[ATTRIBUTION.md](./ATTRIBUTION.md). Each photo ships as a 2560px desktop WebP plus a
1280px `-sm` mobile WebP; narrow viewports get the small variant and a shorter sequence.

## Current scene assets

| Scene id        | Files                                   | Subject                                        |
| --------------- | --------------------------------------- | ---------------------------------------------- |
| `leaf`          | `tea-leaves-nuwara-eliya(-sm).webp`     | Ceylon tea bushes, Nuwara Eliya (opens close)  |
| `estateMist`    | `estate-mist-hatton(-sm).webp`          | Hatton tea fields under morning mist           |
| `estateTerraces`| `estate-terraces-nuwara-eliya(-sm).webp`| Terraced Nuwara Eliya estate (mobile beat)     |
| `plucking`      | `plucking-nuwara-eliya(-sm).webp`       | Tea plucker at work, documentary style         |
| `withering`     | `withering-troughs-damro(-sm).webp`     | Withering troughs, Damro factory               |
| `grading`       | `ceylon-tea-grading-macro(-sm).webp`    | Graded Ceylon black tea macro (+ data overlay) |
| `teaCup`        | `tea-cup-glass(-sm).webp`               | Brewed black tea in glassware, low-key grade   |

## Replacing / upgrading an asset

1. Drop the new file(s) here with a descriptive name (add a `-sm` 1280px variant).
2. Update the matching `src` / `srcSmall` (or `video`) in `teaIntroScenes.ts`.
3. Record source, author, license, URL, and access date in `ATTRIBUTION.md`.

Nothing else changes — durations, motion, steam, data overlay, and sequencing all live in
the manifest.

## Outstanding

- Every scene now uses verified-license, high-resolution material (≥2560px sources). The
  only remaining upgrade would be commissioned ASC photography — in particular a Colombo
  tasting-room shot for `grading`, a subject no open repository currently covers well.
- Optional upgrade path: short 4–6s WebM/MP4 loops per scene via the manifest's `video`
  field (WebM + MP4 fallback, muted; the still doubles as poster). Keep desktop clips
  ≤2560px/~2–4 Mbps and provide 1080p versions for mobile if used.

## Specifications for new assets

- Stills: 2560px wide desktop (WebP q≈72, target ≤500 KB), 1280px mobile, dark low-key
  grading — scenes crossfade over a `#0C0F07` ground, so bright edges flash.
- Only properly licensed, company-owned, public-domain, or CC material — and record it in
  ATTRIBUTION.md before shipping.
