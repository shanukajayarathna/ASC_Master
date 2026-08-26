"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The landing page's one scroll-entry treatment: a section fades/rises into place the first
 * time it crosses into view, then stays put — never re-triggers on scroll back up, never
 * loops. `prefers-reduced-motion` is handled purely in CSS (see `.landing-reveal` in
 * globals.css), so this component doesn't need to branch on it itself.
 */
export default function ScrollReveal({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`landing-reveal ${visible ? "landing-reveal-visible" : ""} ${className}`}>
      {children}
    </div>
  );
}
