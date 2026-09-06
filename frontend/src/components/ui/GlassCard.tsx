import type { CSSProperties, ElementType, ReactNode } from "react";

/**
 * Shared glassmorphism surface for the futuristic-UI phases (Landing, Dashboard KPI
 * cards, Knowledge Base, AI Assistant). Uses --glass-surface/--glass-border (globals.css)
 * — translucent versions of the theme's own surface color, not a new hue — so it reads
 * correctly in both light and dark mode without any extra work at the call site.
 * Plain div by default; pass `as="li"` etc. where the surrounding markup needs it.
 */
export default function GlassCard({
  children,
  as: Component = "div",
  className,
  style,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Component
      className={className}
      style={{
        background: "var(--glass-surface)",
        backdropFilter: "blur(16px) saturate(1.15)",
        WebkitBackdropFilter: "blur(16px) saturate(1.15)",
        border: "1px solid var(--glass-border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
        ...style,
      }}
    >
      {children}
    </Component>
  );
}
