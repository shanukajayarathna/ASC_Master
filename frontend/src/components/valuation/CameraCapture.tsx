"use client";

import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import CameraswitchIcon from "@mui/icons-material/Cameraswitch";
import { useEffect, useRef, useState } from "react";

interface CameraCaptureProps {
  onCapture: (blob: Blob) => void;
  onCancel: () => void;
  /** Fallback when the camera can't be used (permission/insecure context). */
  onUseGallery?: () => void;
}

/**
 * A real in-app camera (getUserMedia) — a live preview plus a shutter — so "Take photo"
 * actually opens the camera on desktop and tablet, instead of the OS file picker that the
 * <input capture> attribute falls back to. Captures the current frame as a JPEG for the
 * cropper. Needs a secure context: works on localhost, needs HTTPS on a networked tablet.
 */
export default function CameraCapture({ onCapture, onCancel, onUseGallery }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Acquire (or re-acquire on flip) the camera stream.
  useEffect(() => {
    let cancelled = false;
    let local: MediaStream | null = null;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        local = stream;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch {
        if (!cancelled) setErr("Camera unavailable — allow camera access (needs HTTPS on a networked tablet).");
      }
    })();
    return () => {
      cancelled = true;
      local?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  const shoot = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    canvas.toBlob((b) => b && onCapture(b), "image/jpeg", 0.92);
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex flex-col items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.88)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      {err ? (
        <div className="rounded-2xl p-5 max-w-[420px] text-center" style={{ background: "var(--surface)" }}>
          <p className="text-[13px] text-text mb-4">{err}</p>
          <div className="flex gap-2 justify-center">
            {onUseGallery && (
              <Button variant="contained" onClick={onUseGallery}>
                Choose from gallery
              </Button>
            )}
            <Button onClick={onCancel}>Close</Button>
          </div>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="max-w-full max-h-[68vh] rounded-xl"
            style={{ background: "#000" }}
          />
          <div className="flex items-center gap-5 mt-4">
            <Button onClick={onCancel} sx={{ color: "#fff" }}>
              Cancel
            </Button>
            <button
              type="button"
              onClick={shoot}
              disabled={!ready}
              aria-label="Capture photo"
              className="w-16 h-16 rounded-full border-4 cursor-pointer touch-manipulation active:scale-95 disabled:opacity-40 flex items-center justify-center"
              style={{ borderColor: "#fff", background: "var(--liquor)" }}
            >
              <PhotoCameraIcon sx={{ color: "#fff", fontSize: 28 }} />
            </button>
            <IconButton onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))} aria-label="Switch camera" sx={{ color: "#fff" }}>
              <CameraswitchIcon />
            </IconButton>
          </div>
        </>
      )}
    </div>
  );
}
