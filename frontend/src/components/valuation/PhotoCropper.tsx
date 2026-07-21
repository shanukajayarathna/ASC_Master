"use client";

import Button from "@mui/material/Button";
import Slider from "@mui/material/Slider";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import { useEffect, useRef, useState } from "react";

interface PhotoCropperProps {
  /** Object URL of the image being cropped (a freshly captured file, or a re-loaded photo). */
  src: string;
  busy?: boolean;
  onCancel: () => void;
  /** Receives the cropped square as a JPEG blob. */
  onSave: (blob: Blob) => void | Promise<void>;
}

const MAX_ZOOM = 5;

/**
 * A dependency-free square cropper built for touch: drag the photo to reposition, use the
 * zoom slider (or wheel) to scale, then export the framed square as a JPEG. The maths maps
 * the fixed viewport back to the image's natural pixels so what you frame is what you save.
 */
export default function PhotoCropper({ src, busy, onCancel, onSave }: PhotoCropperProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [side, setSide] = useState(360); // viewport square, in CSS px
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // Size the square to the device once — big enough to frame comfortably on a tablet.
  useEffect(() => {
    const s = Math.round(Math.min(window.innerWidth * 0.86, window.innerHeight * 0.55, 460));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSide(s);
  }, []);

  // "Cover" scale so the image always fills the viewport at zoom 1 (no empty gaps).
  const baseScale = nat ? Math.max(side / nat.w, side / nat.h) : 1;
  const dispW = nat ? nat.w * baseScale * zoom : side;
  const dispH = nat ? nat.h * baseScale * zoom : side;

  const clamp = (x: number, y: number) => ({
    x: Math.min(0, Math.max(side - dispW, x)),
    y: Math.min(0, Math.max(side - dispH, y)),
  });

  // Center the image once its natural size is known.
  const onImgLoad = () => {
    const el = imgRef.current;
    if (!el) return;
    const w = el.naturalWidth;
    const h = el.naturalHeight;
    const bs = Math.max(side / w, side / h);
    setNat({ w, h });
    setZoom(1);
    setOffset({ x: (side - w * bs) / 2, y: (side - h * bs) / 2 });
  };

  // Zoom around the viewport center so the middle of the frame stays put.
  const applyZoom = (next: number) => {
    const z1 = Math.min(MAX_ZOOM, Math.max(1, next));
    setZoom((z0) => {
      setOffset((o) => {
        const ratio = z1 / z0;
        const nx = side / 2 - (side / 2 - o.x) * ratio;
        const ny = side / 2 - (side / 2 - o.y) * ratio;
        // dispW/dispH here still use z0; recompute clamp bounds against z1.
        const w = nat ? nat.w * baseScale * z1 : side;
        const h = nat ? nat.h * baseScale * z1 : side;
        return { x: Math.min(0, Math.max(side - w, nx)), y: Math.min(0, Math.max(side - h, ny)) };
      });
      return z1;
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const nx = drag.current.ox + (e.clientX - drag.current.px);
    const ny = drag.current.oy + (e.clientY - drag.current.py);
    setOffset(clamp(nx, ny));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    applyZoom(zoom * (1 - e.deltaY * 0.0015));
  };

  const save = async () => {
    const el = imgRef.current;
    if (!el || !nat) return;
    const scale = baseScale * zoom;
    const sSize = side / scale; // source square in natural px
    const sx = -offset.x / scale;
    const sy = -offset.y / scale;
    const out = Math.max(200, Math.min(Math.round(sSize), 1400));
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(el, sx, sy, sSize, sSize, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9));
    if (blob) await onSave(blob);
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onKeyDown={(e) => {
        // Keep Escape from bubbling out to the focus view (which would exit focus mode).
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="rounded-2xl p-4 w-full max-w-[520px]" style={{ background: "var(--surface)" }}>
        <h3 className="font-display text-lg font-bold text-text-strong mb-1">Crop photo</h3>
        <p className="text-[12px] text-text-muted mb-3">Drag to reposition · slider or wheel to zoom.</p>

        <div className="flex justify-center">
          <div
            className="relative overflow-hidden rounded-xl select-none"
            style={{ width: side, height: side, background: "var(--surface-sunken)", touchAction: "none", cursor: "grab" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={src}
              alt="Crop preview"
              draggable={false}
              onLoad={onImgLoad}
              style={{
                position: "absolute",
                left: offset.x,
                top: offset.y,
                width: dispW,
                height: dispH,
                maxWidth: "none",
                pointerEvents: "none",
              }}
            />
            {/* framing guides */}
            <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.35)" }} />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3 px-1">
          <ZoomOutIcon sx={{ fontSize: 18, color: "var(--text-muted)" }} />
          <Slider
            value={zoom}
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            onChange={(_, v) => applyZoom(Array.isArray(v) ? v[0] : v)}
            aria-label="Zoom"
            sx={{ color: "var(--liquor)" }}
          />
          <ZoomInIcon sx={{ fontSize: 18, color: "var(--text-muted)" }} />
        </div>

        <div className="flex gap-2 justify-end mt-3">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={busy || !nat}>
            {busy ? "Saving…" : "Save photo"}
          </Button>
        </div>
      </div>
    </div>
  );
}
