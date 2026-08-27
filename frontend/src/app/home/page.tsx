"use client";

import { api, ApiError } from "@/lib/api";
import type { LandingPageContent } from "@/types/api";
import LandingNav from "@/components/landing/LandingNav";
import Hero from "@/components/landing/Hero";
import ProblemSection from "@/components/landing/ProblemSection";
import FiveIntelligences from "@/components/landing/FiveIntelligences";
import HeritageSection from "@/components/landing/HeritageSection";
import AboutSection from "@/components/landing/AboutSection";
import HowItWorks from "@/components/landing/HowItWorks";
import MetricsStrip from "@/components/landing/MetricsStrip";
import Testimonials from "@/components/landing/Testimonials";
import FinalCta from "@/components/landing/FinalCta";
import LandingFooter from "@/components/landing/LandingFooter";
import TeaLoader from "@/components/shared/TeaLoader";
import { useEffect, useState } from "react";

/**
 * The public front door (spec: "/" was already claimed by the authenticated app shell's own
 * redirect-to-/dashboard, so this lives at /home instead — see plan discovery notes).
 *
 * Built entirely on the same components/tokens the authenticated app already uses (Topbar
 * shell, `--surface`/`--radius-lg`/`--shadow-sm` bordered cards, MUI Button, ModuleTile's tile
 * pattern, the dashboard's KPI-strip pattern, TeaLoader) — this page is a front door to that
 * app, not a separate visual product.
 *
 * Client-fetch-after-mount, same as every other page in this app (see the "every page here
 * is a client component" convention noted in lib/api.ts) — deliberately not server-rendered
 * ISR, since that would make `next build` depend on the backend being reachable at build
 * time, which nothing else in this app does.
 */
export default function LandingPage() {
  const [content, setContent] = useState<LandingPageContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLandingContent()
      .then(setContent)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this page."));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--surface-alt)" }}>
        <p className="text-[14px]" style={{ color: "var(--text)" }}>{error}</p>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--surface-alt)" }}>
        <TeaLoader size={56} />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-6" style={{ background: "var(--surface-alt)" }}>
      <LandingNav />
      <Hero hero={content.hero} />
      <ProblemSection />
      <FiveIntelligences items={content.fiveIntelligences} />
      <HeritageSection heritage={content.heritage} />
      <AboutSection stats={content.companyStats} />
      <HowItWorks />
      <MetricsStrip stats={content.platformStats} />
      <Testimonials testimonials={content.testimonials} />
      <FinalCta ctaLabel={content.hero.ctaPrimaryLabel} />
      <LandingFooter />
    </div>
  );
}
