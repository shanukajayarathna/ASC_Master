"use client";

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

/**
 * 3D-tilt-on-hover wrapper for the futuristic-UI phases — rotates its children toward the
 * cursor within a card, spring-damped back to flat on mouse-leave. Wrap a GlassCard (or
 * anything else) in this rather than baking tilt into GlassCard itself, since not every
 * glass surface should tilt (e.g. the Landing page's full-width panels).
 * Inert under prefers-reduced-motion, same convention as landing/motion/Reveal.tsx.
 */
export default function TiltCard({
  children,
  className,
  style,
  maxTiltDeg = 8,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  maxTiltDeg?: number;
}) {
  const reduceMotion = useReducedMotion();
  // 0..1 across the card; 0.5 is centered/flat.
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(py, [0, 1], [maxTiltDeg, -maxTiltDeg]), { stiffness: 300, damping: 28 });
  const rotateY = useSpring(useTransform(px, [0, 1], [-maxTiltDeg, maxTiltDeg]), { stiffness: 300, damping: 28 });

  if (reduceMotion) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width);
    py.set((e.clientY - rect.top) / rect.height);
  };
  const onMouseLeave = () => {
    px.set(0.5);
    py.set(0.5);
  };

  return (
    <motion.div
      className={className}
      style={{ ...style, rotateX, rotateY, transformPerspective: 800 }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </motion.div>
  );
}
