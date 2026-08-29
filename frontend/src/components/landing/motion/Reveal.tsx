"use client";

import { motion, useReducedMotion, type Transition } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

type Direction = "up" | "left" | "right" | "none";

const OFFSET: Record<Direction, { x?: number; y?: number }> = {
  up: { y: 16 },
  left: { x: -16 },
  right: { x: 16 },
  none: {},
};

const EASE: Transition["ease"] = [0.16, 1, 0.3, 1];

/**
 * Scroll-triggered fade + slight slide entrance, used across the landing page sections.
 * Plays once per element (never re-triggers on scroll-back) and is fully inert under
 * prefers-reduced-motion, matching the transform/opacity-only + reduced-motion convention
 * already established in globals.css.
 */
export default function Reveal({
  children,
  delay = 0,
  direction = "up",
  duration = 0.5,
  className,
  style,
}: {
  children: ReactNode;
  delay?: number;
  direction?: Direction;
  duration?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, ...OFFSET[direction] }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
