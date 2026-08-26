import BrandLogo from "@/components/shell/BrandLogo";

const LINKS = [
  { href: "#platform", label: "Platform" },
  { href: "#intelligence", label: "Intelligence" },
  { href: "#about", label: "About" },
  { href: "/request-access", label: "Request Access" },
  { href: "/login", label: "Sign In" },
];

/**
 * Photography credit line is required by two of the six licensed images this page reuses
 * from the login page's TeaCinematic asset set (CC BY / CC BY-SA require attribution — see
 * public/tea/intro/ATTRIBUTION.md); listing it here satisfies that for this, the first
 * genuinely public page those assets appear on.
 */
export default function LandingFooter() {
  return (
    <footer style={{ background: "var(--warm-black)" }}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-14 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 mb-12">
          <div>
            <BrandLogo height={30} onDark />
            <p className="text-[13px] leading-relaxed mt-4 m-0 max-w-xs" style={{ color: "rgba(244,241,230,0.6)" }}>
              Asia Siyaka Commodities PLC · No. 100, Vinayalankara Mawatha, Colombo 10, Sri Lanka
            </p>
          </div>

          <div>
            <p className="font-mono text-[10.5px] tracking-[0.14em] uppercase mb-4 m-0" style={{ color: "rgba(244,241,230,0.45)" }}>
              Quick Links
            </p>
            <div className="flex flex-col gap-2.5">
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="no-underline text-[13px] transition-opacity hover:opacity-70"
                  style={{ color: "rgba(244,241,230,0.78)" }}
                >
                  {l.label}
                </a>
              ))}
            </div>
          </div>

          <div>
            <p className="font-mono text-[10.5px] tracking-[0.14em] uppercase mb-4 m-0" style={{ color: "rgba(244,241,230,0.45)" }}>
              Contact
            </p>
            <p className="text-[13px] m-0 mb-2" style={{ color: "rgba(244,241,230,0.78)" }}>
              info@asiasiyaka.com
            </p>
            <p className="text-[13px] m-0" style={{ color: "rgba(244,241,230,0.78)" }}>
              +94 11 230 0000
            </p>
          </div>
        </div>

        <div
          className="pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
          style={{ borderTop: "1px solid rgba(244,241,230,0.12)" }}
        >
          <p className="font-mono text-[10.5px] m-0" style={{ color: "rgba(244,241,230,0.4)" }}>
            © {new Date().getFullYear()} Asia Siyaka Commodities PLC · Powered by ASC Intelligent Hub
          </p>
          <p className="font-mono text-[10px] m-0" style={{ color: "rgba(244,241,230,0.3)" }}>
            Estate photography via Wikimedia Commons (CC BY / CC BY-SA / CC0)
          </p>
        </div>
      </div>
    </footer>
  );
}
