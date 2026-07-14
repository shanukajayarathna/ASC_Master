"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import BrandLogo from "./BrandLogo";
import { NAV_ITEMS, NAV_SECTIONS } from "./nav";

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="hidden md:flex w-[248px] shrink-0 flex-col h-screen sticky top-0 text-white/80 border-r border-brass/20"
      style={{ background: "linear-gradient(180deg, var(--ink-900), var(--ink-800))" }}
    >
      <div className="flex flex-col gap-1.5 px-4 py-4 border-b border-brass/20">
        <BrandLogo height={44} onDark />
        <div className="font-mono text-[9px] tracking-widest uppercase text-brass-light">
          Commodities · Tea Auctions
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-2.5">
        {NAV_SECTIONS.map((section) => (
          <div key={section} className="mb-1">
            <div className="font-mono text-[9.5px] tracking-widest uppercase text-white/35 px-2.5 pt-3.5 pb-1.5">
              {section}
            </div>
            {NAV_ITEMS.filter((n) => n.section === section).map((item) => {
              const active = pathname === item.href || pathname?.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative flex items-center gap-2.5 px-2.5 py-2 rounded text-[13px] font-medium mb-0.5 border transition-colors ${
                    active
                      ? "bg-brass/15 text-white border-brass/30"
                      : "text-white/75 border-transparent hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {active && (
                    <span className="absolute -left-2.5 top-2 bottom-2 w-[3px] rounded bg-brass-light" />
                  )}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.status === "soon" && (
                    <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-full bg-brass/15 text-brass-light">
                      Soon
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
