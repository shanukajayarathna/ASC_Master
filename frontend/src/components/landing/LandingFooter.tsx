import BrandLogo from "@/components/shell/BrandLogo";

const LINKS = [
  { href: "#platform", label: "Platform" },
  { href: "#intelligence", label: "Intelligence" },
  { href: "#about", label: "About" },
  { href: "/request-access", label: "Request Access" },
  { href: "/login", label: "Sign In" },
];

/**
 * Photography credit line is required by the licensed images this page reuses from the login
 * page's TeaCinematic asset set (CC BY / CC BY-SA require attribution — see
 * public/tea/intro/ATTRIBUTION.md). Styled as a plain bordered `--surface` footer, matching
 * the dashboard's own `text-center pt-4 border-t border-border` sign-off rather than a
 * separate dark marketing footer.
 */
export default function LandingFooter() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-6 mb-8">
      <div className="rounded-[var(--radius-lg)] border border-border p-5 sm:p-6" style={{ background: "var(--surface)" }}>
        <div className="flex flex-wrap items-start justify-between gap-6 mb-5">
          <div>
            <BrandLogo height={26} />
            <p className="text-[12px] leading-relaxed mt-3 m-0 max-w-xs" style={{ color: "var(--text-muted)" }}>
              Asia Siyaka Commodities PLC · Deutsche House Building, 320 T. B. Jayah Mawatha, Colombo 010, Sri Lanka
            </p>
            <p className="text-[12px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
              asc@siyaka.lk · +94 (011)-4-600-700
            </p>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} className="text-[12.5px] no-underline" style={{ color: "var(--text)" }}>
                {l.label}
              </a>
            ))}
          </div>
        </div>

        <div className="text-center pt-4 border-t border-border">
          <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
            © {new Date().getFullYear()} Asia Siyaka Commodities PLC · Powered by ASC Intelligent Hub
          </p>
          <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
            Estate photography via Wikimedia Commons (CC BY / CC BY-SA / CC0)
          </p>
        </div>
      </div>
    </div>
  );
}
