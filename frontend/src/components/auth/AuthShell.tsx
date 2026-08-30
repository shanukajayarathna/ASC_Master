"use client";

import BrandLogo from "@/components/shell/BrandLogo";
import ThemeMenu from "@/components/shell/ThemeMenu";
import { useThemeMode } from "@/context/ThemeModeContext";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import Link from "next/link";

/**
 * Shared shell for /login and /request-access — a standard split-screen auth layout (real
 * estate photography left, a plain ivory form panel right) rather than a small card floating
 * over a blurred full-viewport backdrop. Replaces the earlier `position: fixed` back-to-
 * landing button (which sat inside `.login-bg`'s centered flex container and rendered
 * mis-positioned — a `fixed` element ignores its flex parent, but the layout that produced it
 * made that easy to miss) with a link that's simply part of each panel's normal document
 * flow, so it can't drift out of place regardless of viewport or panel content height.
 *
 * The left photo panel is `hidden` below `lg`; the back link reappears in-flow above the form
 * on narrow viewports instead.
 */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  const { mode } = useThemeMode();
  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <div className="relative hidden lg:flex lg:w-[44%] xl:w-1/2 shrink-0 flex-col justify-between p-10 xl:p-14 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url(/tea/intro/estate-mist-hatton.webp)" }}
          role="img"
          aria-label="Misty tea estate in the Central Highlands of Sri Lanka"
        />
        <div
          className="absolute inset-0"
          aria-hidden="true"
          style={{ background: "linear-gradient(190deg, rgba(15,20,16,0.22) 0%, rgba(15,20,16,0.12) 35%, rgba(15,20,16,0.82) 100%)" }}
        />

        <Link
          href="/"
          className="relative z-10 inline-flex items-center gap-2 self-start no-underline text-[13px] font-semibold px-3.5 py-2 rounded-full"
          style={{ color: "#fff", background: "rgba(15,20,16,0.35)", border: "1px solid rgba(255,255,255,0.22)" }}
        >
          <ArrowBackOutlinedIcon sx={{ fontSize: 16 }} />
          ASC Intelligent Hub
        </Link>

        <div className="relative z-10">
          <p
            className="font-display italic leading-snug m-0 mb-4"
            style={{ color: "#fff", fontSize: "clamp(22px, 2.2vw, 28px)", textShadow: "0 2px 16px rgba(0,0,0,0.35)" }}
          >
            &ldquo;Where Ceylon Tea Meets Intelligence.&rdquo;
          </p>
          <p className="font-mono text-[11px] tracking-[0.18em] uppercase m-0" style={{ color: "rgba(244,241,230,0.75)" }}>
            Asia Siyaka Commodities · Colombo Tea Auction
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-5 py-10 sm:py-14" style={{ background: "var(--surface-alt)" }}>
        <div className="w-full max-w-[380px]">
          <div className="flex items-center mb-7">
            <Link
              href="/"
              className="lg:hidden inline-flex items-center gap-1.5 no-underline text-[13px] font-semibold"
              style={{ color: "var(--liquor)" }}
            >
              <ArrowBackOutlinedIcon sx={{ fontSize: 16 }} />
              Back to ASC Intelligent Hub
            </Link>
            <div className="ml-auto">
              <ThemeMenu />
            </div>
          </div>

          <div className="flex flex-col items-center gap-1.5 mb-8">
            {/* BrandLogo's artwork is drawn for light surfaces — boosted for legibility
                whenever the app's theme (not this panel, which stays --surface-alt either
                way) is dark. Same fix LandingNav/Sidebar already apply to this same logo. */}
            <BrandLogo height={40} onDark={mode === "dark"} />
            <p className="font-mono text-[10px] tracking-widest uppercase m-0" style={{ color: "var(--text-muted)" }}>
              Intelligence Hub
            </p>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
