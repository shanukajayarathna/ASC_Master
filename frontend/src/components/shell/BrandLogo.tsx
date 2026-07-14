import Image from "next/image";

/**
 * The official Asia Siyaka wordmark — the actual artwork (downloaded from asiasiyaka.com,
 * same mark the company uses everywhere), served from /public/brand/asia-siyaka.png.
 *
 * The artwork is olive/gold on a transparent background, drawn for light surfaces. On dark
 * surfaces (`onDark`) it sits on a soft ivory tile — the standard way to keep a logo's exact
 * colors untouched on a dark background — rather than recoloring or brightening the image.
 */
const LOGO_W = 310;
const LOGO_H = 90;

export default function BrandLogo({
  height = 40,
  onDark = false,
  className,
}: {
  /** Rendered logo height in px — width follows the artwork's aspect ratio. */
  height?: number;
  onDark?: boolean;
  className?: string;
}) {
  const img = (
    <Image
      src="/brand/asia-siyaka.png"
      alt="Asia Siyaka Commodities PLC"
      width={Math.round((height * LOGO_W) / LOGO_H)}
      height={height}
      priority
      style={{ display: "block", width: "auto", height }}
    />
  );

  if (!onDark) return <span className={`inline-flex ${className ?? ""}`}>{img}</span>;

  return (
    <span
      className={`inline-flex ${className ?? ""}`}
      style={{ background: "#F7F3E8", borderRadius: 8, padding: `${Math.round(height * 0.16)}px ${Math.round(height * 0.24)}px` }}
    >
      {img}
    </span>
  );
}
