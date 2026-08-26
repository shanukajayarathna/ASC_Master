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
import FullScreenLoader from "@/components/shared/FullScreenLoader";
import { useEffect, useState } from "react";

/**
 * The public front door (spec: "/" was already claimed by the authenticated app shell's own
 * redirect-to-/dashboard, so this lives at /home instead — see plan discovery notes).
 *
 * Client-fetch-after-mount, same as every other page in this app (see the "every page here
 * is a client component" convention noted in lib/api.ts) — deliberately not server-rendered
 * ISR as the original spec sketch assumed, since that would make `next build` depend on the
 * backend being reachable at build time, which nothing else in this app does. The CMS content
 * still updates live: this page just polls it the same way every other page polls its data.
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
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--tea-ledger)" }}>
        <p className="text-[14px]" style={{ color: "var(--tea-ink)" }}>{error}</p>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="min-h-screen" style={{ background: "var(--tea-ink)" }}>
        <FullScreenLoader message="Loading ASC Intelligent Hub…" onDark />
      </div>
    );
  }

  return (
    <div style={{ background: "var(--tea-ledger)" }}>
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
