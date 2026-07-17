import Image from "next/image";

/**
 * The official Asia Siyaka wordmark — the actual artwork (downloaded from asiasiyaka.com,
 * same mark the company uses everywhere), served from /public/brand/asia-siyaka.png.
 *
 * The artwork is olive/gold on a transparent background, drawn for light surfaces. On dark
 * surfaces (`onDark`) it keeps its brand hues but is lifted with a brightness/saturation
 * boost so the dark-olive lettering stays legible — no tile behind it (a light rectangle
 * jars badly in dark mode), no recolored silhouette.
 */
// Trimmed artwork dimensions — the canvas is cropped tight to the visible mark
// (no transparent padding), so centering the image centers the wordmark itself.
const LOGO_W = 166;
const LOGO_H = 86;

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
  return (
    <span className={`inline-flex ${className ?? ""}`}>
      <Image
        src="/brand/asia-siyaka.png"
        alt="Asia Siyaka Commodities PLC"
        width={Math.round((height * LOGO_W) / LOGO_H)}
        height={height}
        priority
        style={{
          display: "block",
          width: "auto",
          height,
          ...(onDark && { filter: "brightness(1.65) saturate(1.1)" }),
        }}
      />
    </span>
  );
}
