"use client";

import { api } from "@/lib/api";
import type { Conversation } from "@/types/api";
import CloseIcon from "@mui/icons-material/Close";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import { useEffect, useMemo, useState } from "react";
import { getUiStrings, type UiLang } from "@/lib/i18n";

export default function HistoryDrawer({ open, onClose, onOpenConversation, disabled, lang }: {
  open: boolean;
  onClose: () => void;
  onOpenConversation: (id: string) => Promise<boolean>;
  disabled?: boolean;
  lang: UiLang;
}) {
  const t = getUiStrings(lang);
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    api.listConversations().then((rows) => !cancelled && setItems(rows)).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load conversation history.");
    });
    return () => { cancelled = true; };
  }, [open]);

  const filtered = useMemo(() => (items ?? []).filter((x) => x.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [items, search]);
  const openItem = async (id: string) => {
    setOpening(id);
    const ok = await onOpenConversation(id);
    setOpening(null);
    if (ok) onClose();
  };

  return <Drawer anchor="right" open={open} onClose={onClose} sx={{ "& .MuiDrawer-paper": { width: "min(100vw, 440px)", maxWidth: "100vw" } }} slotProps={{ paper: { "aria-label": "Conversation history" } }}>
    <div className="ws-library workspace">
      <header className="ws-canvas-head">
        <div className="flex items-center gap-2"><HistoryOutlinedIcon fontSize="small" /><h2 className="ws-canvas-title">{t.hubHistoryTitle}</h2></div>
        <IconButton onClick={onClose} aria-label={t.hubCloseHistory} sx={{ width: 44, height: 44 }}><CloseIcon /></IconButton>
      </header>
      <div className="ws-library-body">
        <TextField size="small" fullWidth value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.hubSearchHistory} slotProps={{ htmlInput: { "aria-label": t.hubSearchHistory } }} />
        {error && <p role="alert" className="ws-lots-note ws-lots-error">{error}</p>}
        {items === null && !error ? <p role="status" className="ws-lots-note">{t.hubLoadingHistory}</p> : filtered.length === 0 ? <p className="ws-lots-note">{search ? t.hubNoHistoryMatches : t.hubNoHistory}</p> : (
          <ul className="ws-deck-list" aria-label={t.hubHistoryTitle}>
            {filtered.map((item) => <li key={item.id}>
              <span><strong>{item.title || "New conversation"}</strong><br /><em className="ws-lots-note">{new Date(item.createdAt).toLocaleString()}</em></span>
              <Button size="small" disabled={disabled || opening !== null} onClick={() => void openItem(item.id)} sx={{ minHeight: 40 }}>{opening === item.id ? t.hubOpeningConversation : t.hubOpenConversation}</Button>
            </li>)}
          </ul>
        )}
      </div>
    </div>
  </Drawer>;
}
