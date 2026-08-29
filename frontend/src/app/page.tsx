"use client";

import { api, ApiError } from "@/lib/api";
import type { LandingPageContent } from "@/types/api";
import { useForceLogoutOnPublicPage } from "@/hooks/useForceLogoutOnPublicPage";
import LoggedOutNotice from "@/components/auth/LoggedOutNotice";
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
import Button from "@mui/material/Button";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The public front door — lives at "/" (the (app) route group's old bare redirect-to-
 * /dashboard shim is gone; the authenticated shell is reached via /login → /dashboard or
 * /admin from here on, never via "/"). Built on the same tokens/components the authenticated
 * app uses (Topbar shell, MUI Button, `--liquor`/`--tea-ink` palette, TeaLoader) but composed
 * as ordinary full-width marketing sections — alternating background bands with generous
 * vertical rhythm — rather than the dashboard's own stacked-widget layout, which is a
 * different reading register (an operator's tool, not a front door for a first-time visitor).
 *
 * Client-fetch-after-mount, same as every other page in this app — deliberately not
 * server-rendered ISR, since that would make `next build` depend on the backend being
 * reachable at build time, which nothing else in this app does.
 */
export default function LandingPage() {
  const [content, setContent] = useState<LandingPageContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reaching "/" with a session still live in this tab (almost always via the browser Back
  // button out of the authenticated app) ends that session — see the hook's own doc comment.
  const justLoggedOut = useForceLogoutOnPublicPage();

  useEffect(() => {
    api
      .getLandingContent()
      .then(setContent)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this page."));
  }, []);

  if (error) {
    return (
      <div style={{ background: "var(--surface-alt)" }}>
        <LandingNav />
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-[15px] font-medium m-0" style={{ color: "var(--text-strong)" }}>
            We couldn&rsquo;t load this page right now.
          </p>
          <p className="text-[13.5px] m-0 max-w-sm" style={{ color: "var(--text-muted)" }}>{error}</p>
          <Button component={Link} href="/login" variant="contained" color="primary">
            Sign In
          </Button>
        </div>
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
    <div style={{ background: "var(--surface-alt)" }}>
      <LandingNav hasTestimonials={content.testimonials.length > 0} />
      {justLoggedOut && (
        <div className="pt-5 px-4 sm:px-6">
          <LoggedOutNotice />
        </div>
      )}
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
