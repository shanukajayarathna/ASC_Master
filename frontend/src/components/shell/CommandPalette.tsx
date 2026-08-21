"use client";

import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { DocumentSearchResult } from "@/types/api";
import { NAV_ITEMS, type NavItem } from "./nav";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import SearchIcon from "@mui/icons-material/Search";
import Modal from "@mui/material/Modal";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

type Entry =
  | { kind: "nav"; item: NavItem }
  | { kind: "doc"; result: DocumentSearchResult };

/**
 * Ctrl/Cmd+K launcher. Searches modules instantly (client-side, from nav.ts — the same
 * list the launchpad tiles render) and, once the query looks intentional, also queries the
 * Knowledge Base's real search endpoint. This does NOT search lots/brokers/gardens/users —
 * there is no such cross-entity endpoint in the API, and this redesign doesn't add one
 * (frontend-only per the brief). Claiming to search everything when it can't would be worse
 * than just searching what's actually searchable.
 */
export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("Admin") ?? false;
  const visibleNavItems = useMemo(() => NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin), [isAdmin]);
  const [query, setQuery] = useState("");
  const [docResults, setDocResults] = useState<DocumentSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setDocResults([]);
      setActiveIndex(0);
      // Modal already moves focus in; this grabs the actual text field a tick later.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const navMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visibleNavItems;
    return visibleNavItems.filter(
      (item) => item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
    );
  }, [query, visibleNavItems]);

  // Knowledge Base search — only once the query looks like a real search, not on every
  // keystroke of a 1-character query, and only while the palette is open.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDocResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .searchDocuments(q)
        .then((results) => {
          if (!cancelled) setDocResults(results.slice(0, 5));
        })
        .catch(() => {
          if (!cancelled) setDocResults([]);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  const entries: Entry[] = useMemo(
    () => [
      ...navMatches.map((item): Entry => ({ kind: "nav", item })),
      ...docResults.map((result): Entry => ({ kind: "doc", result })),
    ],
    [navMatches, docResults]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex((i) => Math.min(i, Math.max(entries.length - 1, 0)));
  }, [entries.length]);

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    router.push(entry.kind === "nav" ? entry.item.href : "/knowledge");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} aria-label="Command palette" className="flex items-start justify-center pt-[12vh] px-4">
      <div
        role="dialog"
        aria-modal
        className="w-full max-w-[560px] rounded-[var(--radius-lg)] border border-border overflow-hidden outline-none"
        style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, entries.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            go(entries[activeIndex]);
          }
        }}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
          <SearchIcon fontSize="small" sx={{ color: "var(--text-muted)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search modules, or the Knowledge Base…"
            className="flex-1 bg-transparent border-0 outline-none text-[14px]"
            style={{ color: "var(--text-strong)" }}
            aria-label="Search"
            role="combobox"
            aria-expanded
            aria-controls="command-palette-list"
            aria-activedescendant={entries[activeIndex] ? `cmd-${activeIndex}` : undefined}
          />
          <kbd
            className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-border"
            style={{ color: "var(--text-muted)" }}
          >
            Esc
          </kbd>
        </div>

        <div id="command-palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto py-1.5">
          {entries.length === 0 && (
            <p className="px-4 py-6 text-[13px] text-center" style={{ color: "var(--text-muted)" }}>
              Nothing matches “{query}”.
            </p>
          )}

          {navMatches.length > 0 && (
            <div className="px-3 pt-1.5 pb-1 font-mono text-[10px] tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
              Modules
            </div>
          )}
          {navMatches.map((item, i) => {
            const Icon = item.icon;
            const active = i === activeIndex;
            return (
              <button
                key={item.href}
                id={`cmd-${i}`}
                role="option"
                aria-selected={active}
                type="button"
                onClick={() => go({ kind: "nav", item })}
                onMouseEnter={() => setActiveIndex(i)}
                className="w-full flex items-center gap-3 px-4 py-2 text-left cursor-pointer"
                style={{ background: active ? "var(--surface-sunken)" : "transparent" }}
              >
                <Icon fontSize="small" sx={{ color: "var(--liquor)" }} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium truncate" style={{ color: "var(--text-strong)" }}>
                    {item.label}
                  </span>
                  <span className="block text-[11.5px] truncate" style={{ color: "var(--text-muted)" }}>
                    {item.description}
                  </span>
                </span>
              </button>
            );
          })}

          {docResults.length > 0 && (
            <div className="px-3 pt-2.5 pb-1 font-mono text-[10px] tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
              Knowledge Base
            </div>
          )}
          {docResults.map((result, di) => {
            const i = navMatches.length + di;
            const active = i === activeIndex;
            return (
              <button
                key={`${result.documentId}-${di}`}
                id={`cmd-${i}`}
                role="option"
                aria-selected={active}
                type="button"
                onClick={() => go({ kind: "doc", result })}
                onMouseEnter={() => setActiveIndex(i)}
                className="w-full flex items-center gap-3 px-4 py-2 text-left cursor-pointer"
                style={{ background: active ? "var(--surface-sunken)" : "transparent" }}
              >
                <MenuBookOutlinedIcon fontSize="small" sx={{ color: "var(--sage)" }} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium truncate" style={{ color: "var(--text-strong)" }}>
                    {result.documentFileName}
                  </span>
                  <span className="block text-[11.5px] truncate" style={{ color: "var(--text-muted)" }}>
                    {result.chunkText}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
