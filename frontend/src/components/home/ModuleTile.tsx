"use client";

import type { NavItem } from "@/components/shell/nav";
import ArrowOutwardIcon from "@mui/icons-material/ArrowOutward";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

const GRADIENT_VAR: Record<NavItem["gradient"], string> = {
  1: "var(--tile-gradient-1)",
  2: "var(--tile-gradient-2)",
  3: "var(--tile-gradient-3)",
  4: "var(--tile-gradient-4)",
  5: "var(--tile-gradient-5)",
  6: "var(--tile-gradient-6)",
  7: "var(--tile-gradient-7)",
  8: "var(--tile-gradient-8)",
};

interface ModuleTileProps {
  item: NavItem;
  pinned?: boolean;
  /** Omit to hide the pin control entirely (e.g. nowhere to persist it). */
  onTogglePin?: () => void;
}

/**
 * One launchpad tile — the primary way to get to a module now that there's no sidebar.
 * Artwork is a real photo (verified individually against Unsplash — see nav.ts) with a
 * brand-gradient wash over it, so the grid reads as one cohesive app rather than stock
 * photography glued on. A tile with no `image` (or one whose photo fails to load) falls
 * back cleanly to the plain gradient + icon treatment — never a broken-image glyph.
 *
 * The pin button is a sibling of the `Link`, not nested inside it (a <button> inside an
 * <a> is invalid HTML and fights the browser over the click) — it's layered on top via
 * position+z-index instead, so tapping it toggles the pin without also navigating.
 */
export default function ModuleTile({ item, pinned, onTogglePin }: ModuleTileProps) {
  const Icon = item.icon;
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = !!item.image && !imageFailed;

  return (
    <div className="group relative lift-on-hover rounded-[var(--radius-xl)]">
      {onTogglePin && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onTogglePin();
          }}
          aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
          aria-pressed={!!pinned}
          title={pinned ? "Unpin from top" : "Pin to top"}
          className="absolute top-2.5 right-2.5 z-20 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer border-0"
          style={{
            background: pinned ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.28)",
            opacity: pinned ? 1 : undefined,
          }}
        >
          {pinned ? (
            <PushPinIcon sx={{ fontSize: 15, color: "var(--liquor)" }} />
          ) : (
            <PushPinOutlinedIcon
              sx={{ fontSize: 15, color: "#fff" }}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            />
          )}
        </button>
      )}
      <Link
        href={item.href}
        className="flex flex-col rounded-[var(--radius-xl)] border border-border overflow-hidden outline-none focus-visible:ring-2 h-full"
        style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
      >
        <div className="h-[130px] flex items-end shrink-0 relative overflow-hidden" style={{ background: GRADIENT_VAR[item.gradient] }}>
          {showImage && (
            <Image
              src={`${item.image}?w=800&q=75&fit=crop&auto=format`}
              alt=""
              fill
              sizes="(min-width: 1024px) 260px, (min-width: 640px) 45vw, 90vw"
              className="object-cover"
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          )}
          {/* Brand-gradient wash — ties the real photo to this app's palette and keeps the
              icon badge legible, without a blur/filter (cheap on a weak GPU either way). */}
          <div
            className="absolute inset-0"
            style={{ background: GRADIENT_VAR[item.gradient], opacity: showImage ? 0.45 : 1 }}
          />
          {!showImage && (
            <div
              className="absolute inset-0"
              style={{ background: "radial-gradient(120% 140% at 15% 15%, rgba(255,255,255,0.22), transparent 55%)" }}
            />
          )}
          <div className="relative z-10 p-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.28)" }}
            >
              <Icon sx={{ fontSize: 20, color: "#fff" }} />
            </div>
          </div>
        </div>
        <div className="p-4 flex-1 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <h3 className="font-display text-[15px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
              {item.label}
            </h3>
            <ArrowOutwardIcon
              sx={{ fontSize: 15, color: "var(--text-muted)" }}
              className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </div>
          <p className="text-[12.5px] leading-snug m-0" style={{ color: "var(--text-muted)" }}>
            {item.description}
          </p>
        </div>
      </Link>
    </div>
  );
}
