# Hero carousel — asset attribution & licensing

Five photographs powering the landing page Hero's auto-rotating right-side image
(`src/components/landing/HeroImageCarousel.tsx`), sourced from Wikimedia Commons with
license metadata verified via the Commons file pages on **6 September 2026**. Downloaded
via Commons' `Special:FilePath` thumbnail endpoint (server-side resized, not the full
multi-megapixel original). On **21 September 2026** the JPEGs were re-encoded with `sharp`
to WebP (max 2400px wide, quality 72), cutting the set from ~10.4 MB to ~2.6 MB, matching
`public/tea/intro/`. The photographs themselves are unchanged; the headings below name the
current `.webp` files.

Deliberately distinct subjects/regions from every image already in `public/tea/intro/`
(Nuwara Eliya estates/leaves/plucking, Hatton mist, Damro factory) — this set adds
Haputale, Wewalthalawa, a tea-workers group shot, a dried-leaf macro, and the historic
Loolkandura estate, for visual variety across the rotation.

> CC BY-SA requires attribution and requires derivatives to be shared under the same
> license (the server-side resize via Special:FilePath is a mechanical thumbnail, not a
> creative derivative, but is listed here regardless per the same policy `intro/`
> follows). If ASC publishes a public credits page, list the entries below there too.

## Photographic assets

### haputale-estate.jpg
- Source: Wikimedia Commons — https://commons.wikimedia.org/wiki/File:Tea_plantation_Haputale.jpg
- Author: Adbar
- License: CC BY-SA 3.0 — https://creativecommons.org/licenses/by-sa/3.0/
- Original: 3,872×2,592 · Subject: tea plantation, Haputale, Sri Lanka

### wewalthalawa-mist.jpg
- Source: Wikimedia Commons — https://commons.wikimedia.org/wiki/File:Misty_tea_estates_in_Sri_Lanka,_Wewalthalawa.jpg
- Author: Eranjene Sandun Abeysinghe
- License: CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/
- Original: 4,160×3,120 · Subject: misty tea estate, Wewalthalawa, Sri Lanka

### ceylon-black-tea-macro-2.jpg
- Source: Wikimedia Commons — https://commons.wikimedia.org/wiki/File:Ceylon_black_tea_leaves.jpg
- Author: Patrick Kolencherry
- License: CC BY-SA 3.0 — https://creativecommons.org/licenses/by-sa/3.0/ (also GFDL 1.2+)
- Original: 3,872×2,592 · Subject: dried Ceylon black tea leaves, macro
- Named with a `-2` suffix: `public/tea/intro/ceylon-tea-grading-macro.webp` already uses
  the plain name for a different photo — kept distinct rather than overloading one filename
  across two asset folders.

### tea-estate-workers.jpg
- Source: Wikimedia Commons — https://commons.wikimedia.org/wiki/File:Tea_estate_workers.jpg
- Author: DennissylvesterHurd
- License: CC BY-SA 2.0 — https://creativecommons.org/licenses/by-sa/2.0/
- Original: 3,264×2,448 · Subject: tea estate workers, Sri Lanka

### loolkandura-first-estate.jpg
- Source: Wikimedia Commons — https://commons.wikimedia.org/wiki/File:First_Tea_Estate_in_Sri_Lanka.jpg
- Author: Naushadnaznin
- License: CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/
- Original: 3,968×2,976 · Subject: Loolkandura estate, Deltota — where Ceylon tea was first
  planted (James Taylor, 1867)
