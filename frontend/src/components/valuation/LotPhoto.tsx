"use client";

import { api } from "@/lib/api";
import PhotoCropper from "@/components/valuation/PhotoCropper";
import CameraCapture from "@/components/valuation/CameraCapture";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";
import PhotoLibraryOutlinedIcon from "@mui/icons-material/PhotoLibraryOutlined";
import CropIcon from "@mui/icons-material/Crop";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import CloseIcon from "@mui/icons-material/Close";
import CachedIcon from "@mui/icons-material/Cached";
import { useEffect, useRef, useState } from "react";

interface LotPhotoProps {
  lotId: string;
  /** Whether the lot currently has a stored photo (from the media manifest). */
  has: boolean;
  /** Cache-buster bumped by the parent whenever this lot's media changes. */
  version: number;
  onChanged: () => void;
}

/**
 * The per-lot photo control for focus mode: add a photo (camera or gallery), crop it before
 * saving, then view / re-crop / retake / delete it later. Handy while comparing sharings —
 * snap the sample you're valuing. Binaries live on the API behind a DB-swappable seam.
 */
export default function LotPhoto({ lotId, has, version, onChanged }: LotPhotoProps) {
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [addAnchor, setAddAnchor] = useState<null | HTMLElement>(null);
  const objectUrl = useRef<string | null>(null);

  // Revoke the current object URL, then optionally adopt a new one.
  const setSource = (url: string | null) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = url;
    setCropSrc(url);
  };
  useEffect(() => () => setSource(null), []);

  // Add/Retake both open a small menu: take a fresh photo with the camera, or pick a file.
  const openAddMenu = (e: React.MouseEvent<HTMLElement>) => {
    setErr(null);
    setAddAnchor(e.currentTarget);
  };
  const closeAddMenu = () => setAddAnchor(null);
  const takeFrom = (source: "camera" | "gallery") => {
    closeAddMenu();
    if (source === "camera") setCameraOpen(true); // live in-app camera, not the OS file picker
    else galleryRef.current?.click();
  };

  // A frame captured by the in-app camera goes straight into the cropper.
  const onCameraCapture = (blob: Blob) => {
    setCameraOpen(false);
    setViewOpen(false);
    setSource(URL.createObjectURL(blob));
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again next time
    if (!file) return;
    setViewOpen(false);
    setSource(URL.createObjectURL(file));
  };

  // Re-crop the photo already on file (loaded as a blob → same-origin, canvas-safe).
  const recrop = async () => {
    setErr(null);
    setBusy(true);
    try {
      const blob = await api.fetchPhotoBlob(lotId);
      setViewOpen(false);
      setSource(URL.createObjectURL(blob));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the photo.");
    } finally {
      setBusy(false);
    }
  };

  const handleCropSave = async (blob: Blob) => {
    setBusy(true);
    setErr(null);
    try {
      await api.uploadPhoto(lotId, blob);
      setSource(null);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Photo upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.deletePhoto(lotId);
      setViewOpen(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete the photo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input ref={galleryRef} type="file" accept="image/*" onChange={onFileChange} className="hidden" />

      {cameraOpen && (
        <CameraCapture
          onCapture={onCameraCapture}
          onCancel={() => setCameraOpen(false)}
          onUseGallery={() => {
            setCameraOpen(false);
            galleryRef.current?.click();
          }}
        />
      )}

      <Menu anchorEl={addAnchor} open={Boolean(addAnchor)} onClose={closeAddMenu}>
        <MenuItem onClick={() => takeFrom("camera")}>
          <PhotoCameraOutlinedIcon fontSize="small" style={{ marginRight: 8 }} />
          Take photo
        </MenuItem>
        <MenuItem onClick={() => takeFrom("gallery")}>
          <PhotoLibraryOutlinedIcon fontSize="small" style={{ marginRight: 8 }} />
          Choose from gallery
        </MenuItem>
      </Menu>

      {has ? (
        <button
          type="button"
          onClick={() => setViewOpen(true)}
          title="View / re-crop / retake / delete this lot's photo"
          className="flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-1 cursor-pointer touch-manipulation"
          style={{ borderColor: "var(--brass)", background: "transparent" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={api.photoUrl(lotId, version)}
            alt="Lot"
            className="w-6 h-6 rounded-full object-cover"
            style={{ background: "var(--surface-sunken)" }}
          />
          <span className="text-[11.5px] font-semibold" style={{ color: "var(--text-strong)" }}>
            Photo
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={openAddMenu}
          title="Add a photo of this lot's sample"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11.5px] font-semibold cursor-pointer touch-manipulation"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)", background: "transparent" }}
        >
          <PhotoCameraOutlinedIcon sx={{ fontSize: 16 }} />
          Add photo
        </button>
      )}

      {/* view + manage modal */}
      {viewOpen && has && (
        <div
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.72)" }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setViewOpen(false);
            }
          }}
        >
          <div className="rounded-2xl p-4 w-full max-w-[520px]" style={{ background: "var(--surface)" }}>
            <div className="flex items-center mb-2">
              <h3 className="font-display text-lg font-bold text-text-strong m-0">Lot photo</h3>
              <IconButton size="small" onClick={() => setViewOpen(false)} sx={{ ml: "auto" }} aria-label="Close">
                <CloseIcon fontSize="small" />
              </IconButton>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={api.photoUrl(lotId, version)}
              alt="Lot"
              className="w-full rounded-xl object-contain max-h-[55vh]"
              style={{ background: "var(--surface-sunken)" }}
            />
            {err && <p className="text-[12px] text-danger mt-2 mb-0">{err}</p>}
            <div className="flex flex-wrap gap-2 justify-end mt-3">
              <Button size="small" startIcon={<CachedIcon />} onClick={openAddMenu} disabled={busy}>
                Retake
              </Button>
              <Button size="small" startIcon={<CropIcon />} onClick={recrop} disabled={busy}>
                Re-crop
              </Button>
              <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={handleDelete} disabled={busy}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* cropper (new capture or re-crop) */}
      {cropSrc && (
        <PhotoCropper src={cropSrc} busy={busy} onCancel={() => setSource(null)} onSave={handleCropSave} />
      )}

      {err && !viewOpen && <span className="text-[10.5px] text-danger ml-1">{err}</span>}
    </>
  );
}
