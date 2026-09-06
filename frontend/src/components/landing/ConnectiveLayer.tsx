"use client";

import GlassCard from "@/components/ui/GlassCard";
import TiltCard from "@/components/ui/TiltCard";
import Reveal from "@/components/landing/motion/Reveal";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import type { SvgIconComponent } from "@mui/icons-material";

const LAYERS: { icon: SvgIconComponent; title: string; body: string }[] = [
  {
    icon: GroupsOutlinedIcon,
    title: "Brokers",
    body: "Catalogues, valuations and reports for every sale live in one workspace instead of scattered spreadsheets per desk.",
  },
  {
    icon: AccountTreeOutlinedIcon,
    title: "Plantations & Factories",
    body: "Every mark's selling history and current broker relationship tracked in one place, not re-assembled from memory each season.",
  },
  {
    icon: GavelOutlinedIcon,
    title: "The Auction Floor",
    body: "Market movement, grade classification and buyer activity read the same way across every desk watching the same sale.",
  },
];

/**
 * Explicitly states ASIS's connecting role — the one narrative beat the rest of the page
 * doesn't otherwise carry (ProblemSection is the "before", FiveIntelligences is "what it can
 * do", but nothing says *why one platform* rather than three separate tools). Worded as
 * "connects the auction ecosystem's data" deliberately — ASIS is an internal, broker-side
 * intelligence tool, not a buyer/seller marketplace, so this never claims to connect the
 * *parties* directly, only the data each of them generates around a shared sale.
 *
 * First real use of the glassmorphism primitives (components/ui/): three GlassCards, each in
 * a TiltCard, over a full-bleed photo — glass only reads as "glass" with something visible
 * moving behind it, which a flat --surface background can't provide.
 */
export default function ConnectiveLayer() {
  return (
    <section className="relative overflow-hidden py-16 sm:py-20">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/tea/intro/tea-leaves-nuwara-eliya.webp)" }}
        role="img"
        aria-label="Tea leaves photograph"
      />
      <div className="absolute inset-0" aria-hidden="true" style={{ background: "rgba(12,15,10,0.55)" }} />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <Reveal className="max-w-2xl mx-auto text-center mb-10 sm:mb-12">
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3" style={{ color: "rgba(255,255,255,0.85)" }}>
            One Intelligence Layer
          </p>
          <h2 className="font-display font-bold m-0 mb-3" style={{ color: "#fff", fontSize: "clamp(24px, 3vw, 34px)" }}>
            Connecting the auction ecosystem&rsquo;s data
          </h2>
          <p className="text-[14px] leading-relaxed m-0" style={{ color: "rgba(255,255,255,0.82)" }}>
            ASIS sits on top of Asia Siyaka&rsquo;s own auction operations and brings what brokers,
            plantations and factories each already know about a sale into a single, current picture
            — instead of three versions of the truth reconciled by hand after the fact.
          </p>
        </Reveal>

        <div className="grid gap-5 sm:grid-cols-3">
          {LAYERS.map((layer, i) => (
            <Reveal key={layer.title} delay={i * 0.08} className="h-full">
              <TiltCard className="h-full" maxTiltDeg={6}>
                {/* This band's backdrop is a fixed dark photo regardless of the site's own
                    light/dark theme, so the glass tint is pinned dark here too — GlassCard's
                    default --glass-surface follows the theme and would go light-tinted in
                    light mode, which is illegible under white text on a dark image. */}
                <GlassCard
                  className="h-full p-5 flex flex-col gap-3"
                  style={{ color: "#fff", background: "rgba(20,22,18,0.35)", borderColor: "rgba(255,255,255,0.22)" }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "rgba(255,255,255,0.16)" }}
                  >
                    <layer.icon sx={{ fontSize: 20, color: "#fff" }} />
                  </div>
                  <h3 className="font-display text-[15px] font-semibold m-0">{layer.title}</h3>
                  <p className="text-[13px] leading-snug m-0" style={{ color: "rgba(255,255,255,0.82)" }}>
                    {layer.body}
                  </p>
                </GlassCard>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
