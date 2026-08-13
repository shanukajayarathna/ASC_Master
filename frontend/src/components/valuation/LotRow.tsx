"use client";

import { CLASSIFICATIONS } from "@/lib/classifications";
import { isReprintLot, markCodeOf, noOfChestsOf, hasValuation, sellingMarkOf, valuationToText, weightPerChestOf } from "@/lib/lotDisplay";
import { parseValuationInput, sanitizeValuationInput, valuationTypingFeedback } from "@/lib/valuationInput";
import { effectiveOfParsed, formatTierRange, suggestTier, tierStatsFor, tierSummary } from "@/lib/previousSale";
import type { ClassificationValue, GradeStats, Lot } from "@/types/api";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import IconButton from "@mui/material/IconButton";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import { memo, useEffect, useRef, useState } from "react";

export type ExtraField = "standardData" | "adjectiveData" | "liquorRemarks" | "musterReport" | "brokerNotes" | "privateNotes";
export type RowField = "valuation" | "classification" | ExtraField;

const isClassified = (lot: Lot) => (lot.valuation?.classification ?? "Unclassified") !== "Unclassified";

export interface LotRowProps {
  lot: Lot;
  index: number;
  saved: boolean;
  saving: boolean;
  clsNeeded: boolean;
  autoCls: boolean;
  noPrevData: boolean;
  active: boolean;
  gradeStats: GradeStats | null;
  enabledExtras: { value: ExtraField; label: string }[];
  /** The page-level map, keyed `${field}:${lotId}` — passed through as-is (not pre-sliced
   *  per row) so its reference only changes when some extra field's text actually changes,
   *  not on every render of this component. */
  extraValues: Record<string, string>;
  onExtraChange: (lotId: string, field: ExtraField, text: string) => void;
  onFocusValuation: (lotId: string) => void;
  onBlurValuation: (lotId: string) => void;
  /** Saves the typed text if it changed; returns the up-to-date lot, or null on invalid/failed input. */
  onSaveValuation: (lot: Lot, text: string, onError: (msg: string) => void) => Promise<Lot | null>;
  /** Save + advance-or-classify-gate, matching the Enter-key flow. When it auto-picks a
   *  classification tier, returns the tier's index so this row can preview/focus it locally. */
  onCommit: (
    lot: Lot,
    index: number,
    text: string,
    onError: (msg: string) => void
  ) => Promise<{ autoFocusClassificationAt: number } | void>;
  onCommitClassification: (
    lot: Lot,
    index: number,
    value: ClassificationValue,
    onError: (msg: string) => void
  ) => Promise<void>;
  onCommitExtra: (lot: Lot, index: number, field: ExtraField, onError: (msg: string) => void) => Promise<void>;
  onSaveExtra: (lot: Lot, field: ExtraField, onError: (msg: string) => void) => Promise<Lot | null>;
  onNavigate: (index: number, field: RowField) => void;
  onView: (lot: Lot) => void;
  onFocusMode: (lotId: string) => void;
  // Registration callbacks rather than raw ref objects — the parent owns inputRefs/clsRefs/
  // extraRefs and closes over them itself (see valuation/page.tsx), so this row never
  // mutates a ref object it merely received as a prop.
  registerValuationRef: (el: HTMLInputElement | null) => void;
  registerClassificationRef: (el: HTMLDivElement | null) => void;
  registerExtraRef: (field: ExtraField, el: HTMLInputElement | null) => void;
  rowFields: RowField[];
}

function LotRowImpl({
  lot,
  index,
  saved,
  saving,
  clsNeeded: clsNeededExternally,
  autoCls: wasAuto,
  noPrevData,
  active,
  gradeStats,
  enabledExtras,
  extraValues,
  onExtraChange,
  onFocusValuation,
  onBlurValuation,
  onSaveValuation,
  onCommit,
  onCommitClassification,
  onCommitExtra,
  onSaveExtra,
  onNavigate,
  onView,
  onFocusMode,
  registerValuationRef,
  registerClassificationRef,
  registerExtraRef,
  rowFields,
}: LotRowProps) {
  // Live-typing state owned by this row alone — typing here no longer touches the page's
  // state, so it can't trigger a re-render of every other mounted row. Only the row being
  // typed in re-renders per keystroke.
  const [text, setText] = useState(() => valuationToText(lot));
  const [error, setError] = useState<string | null>(null);
  const [clsCursorIndex, setClsCursorIndex] = useState<number | null>(null);
  const clsDivRef = useRef<HTMLDivElement | null>(null);

  // Re-sync from the lot only when local text hasn't diverged from what was last known
  // saved — covers e.g. returning from Focus mode having edited this same lot elsewhere,
  // without clobbering an in-progress edit made directly in this row. Runs as an effect
  // (not inline during render) since refs may only be read/written outside of render.
  const lastSeenSaved = useRef(valuationToText(lot));
  useEffect(() => {
    const currentSaved = valuationToText(lot);
    if (currentSaved !== lastSeenSaved.current) {
      if (text === lastSeenSaved.current) setText(currentSaved);
      lastSeenSaved.current = currentSaved;
    }
    // Only re-sync in response to the lot itself changing, not local text edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lot]);

  const valued = hasValuation(lot);
  const classified = isClassified(lot);
  const reprint = isReprintLot(lot);
  const complete = saved && classified;
  const clsNeeded = clsNeededExternally && !classified;
  const currentCls = lot.valuation?.classification ?? "Unclassified";
  const markCode = markCodeOf(lot) ?? lot.mark;
  const currentSaved = valuationToText(lot);

  const feedback = !error && text !== currentSaved ? valuationTypingFeedback(text) : null;
  const liveParsed = text !== currentSaved ? parseValuationInput(text) : null;
  const liveValue = liveParsed ? effectiveOfParsed(liveParsed) : null;
  const mayAuto = currentCls === "Unclassified" || wasAuto;
  const liveTier = mayAuto && liveValue !== null && gradeStats ? suggestTier(gradeStats, liveValue) : null;
  const displayCls = liveTier ?? currentCls;
  const previewTier: ClassificationValue | null =
    clsCursorIndex !== null
      ? (CLASSIFICATIONS[clsCursorIndex]?.value ?? null)
      : (liveTier ?? (wasAuto && currentCls !== "Unclassified" ? currentCls : null));

  let prevMsg: string | null = null;
  let prevMsgColor = "var(--text-muted)";
  if (previewTier) {
    const tierLabel = CLASSIFICATIONS.find((c) => c.value === previewTier)?.label ?? previewTier;
    prevMsg = gradeStats
      ? (tierSummary(lot.grade, gradeStats, previewTier) ?? `${gradeStats.saleName}: no ${lot.grade ?? ""} lots were ${tierLabel}`)
      : `No previous-sale data for ${lot.grade ?? "this grade"}`;
    if (liveTier && previewTier === liveTier) {
      prevMsg = `Auto-selects on save — ${prevMsg}`;
      prevMsgColor = "var(--sage-dark)";
    } else if (wasAuto && previewTier === currentCls) {
      prevMsg = `Auto-selected — ${prevMsg}`;
      prevMsgColor = "var(--sage-dark)";
    }
  } else if (mayAuto && liveValue !== null && !gradeStats) {
    prevMsg = `No previous-sale data for ${lot.grade ?? "this grade"} — pick a tier manually`;
  } else if (noPrevData && !classified) {
    prevMsg = `No previous-sale data for ${lot.grade ?? "this grade"} — pick a tier manually`;
  }

  const rowActive = active || clsCursorIndex !== null || clsNeededExternally || liveTier !== null;

  const doSaveValuation = () => onSaveValuation(lot, text, setError);

  const doCommit = async () => {
    const result = await onCommit(lot, index, text, setError);
    if (result && "autoFocusClassificationAt" in result) {
      clsDivRef.current?.focus();
      setClsCursorIndex(result.autoFocusClassificationAt);
    }
  };

  return (
    <TableRow
      hover
      sx={{
        bgcolor: reprint ? "var(--info-light)" : undefined,
        "&:nth-of-type(even)": { bgcolor: reprint ? "var(--info-light)" : "var(--surface-alt)" },
        ...(error && { outline: "1.5px solid var(--danger)", outlineOffset: "-1.5px" }),
        ...(complete && !error && { borderLeft: "3px solid var(--sage)" }),
      }}
    >
      <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}>
        {lot.lotNumber ?? "—"}
        {reprint && (
          <span
            title="Broker-flagged reprint lot"
            className="ml-1.5 px-1.5 py-0 rounded-full text-[9px] font-bold align-middle"
            style={{ background: "var(--info)", color: "var(--paper-0)" }}
          >
            RP
          </span>
        )}
      </TableCell>
      <TableCell sx={{ fontSize: 12.5 }}>{lot.grade || "—"}</TableCell>
      <TableCell sx={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{lot.broker || "—"}</TableCell>
      <TableCell sx={{ fontSize: 12.5 }}>
        {sellingMarkOf(lot) ?? "—"}
        {markCode && <span className="block text-[11px] text-text-muted font-mono">{markCode}</span>}
      </TableCell>
      <TableCell sx={{ fontSize: 12.5, fontFamily: "var(--font-mono)" }}>{noOfChestsOf(lot) ?? "—"}</TableCell>
      <TableCell sx={{ fontSize: 12.5, fontFamily: "var(--font-mono)" }}>{weightPerChestOf(lot) ?? "—"}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-text-muted font-mono shrink-0">Rs.</span>
          <input
            ref={registerValuationRef}
            type="text"
            inputMode="numeric"
            placeholder="1250 or 1200-1350"
            className="w-[160px] px-2.5 py-1.5 rounded border text-[13px] bg-transparent font-mono"
            style={{ borderColor: error ? "var(--danger)" : "var(--border)", color: "var(--text)" }}
            value={text}
            disabled={saving}
            onFocus={() => onFocusValuation(lot.id)}
            onBlur={() => onBlurValuation(lot.id)}
            onChange={(e) => {
              setError(null);
              setText(sanitizeValuationInput(e.target.value));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                doCommit();
                return;
              }
              const el = e.currentTarget;
              const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
              const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                const target = e.key === "ArrowUp" ? index - 1 : index + 1;
                doSaveValuation().then((ok) => {
                  if (ok) onNavigate(target, "valuation");
                });
              } else if (e.key === "ArrowRight" && atEnd) {
                e.preventDefault();
                doSaveValuation().then((ok) => {
                  if (ok) onNavigate(index, "classification");
                });
              } else if (e.key === "ArrowLeft" && atStart && index > 0) {
                e.preventDefault();
                doSaveValuation().then((ok) => {
                  if (ok) onNavigate(index - 1, rowFields[rowFields.length - 1]);
                });
              }
            }}
          />
        </div>
        {error && <span className="text-[10.5px] text-danger block mt-0.5">{error}</span>}
        {feedback && feedback.tone !== "none" && (
          <span className="text-[10.5px] block mt-0.5" style={{ color: feedback.tone === "ok" ? "var(--sage-dark)" : "var(--text-muted)" }}>
            {feedback.tone === "ok" ? "✓ " : ""}
            {feedback.message}
          </span>
        )}
      </TableCell>
      <TableCell>
        <div
          ref={(el) => {
            clsDivRef.current = el;
            registerClassificationRef(el);
          }}
          tabIndex={0}
          onFocus={() => {
            if (clsCursorIndex === null) {
              const at = CLASSIFICATIONS.findIndex((c) => c.value === currentCls);
              setClsCursorIndex(at === -1 ? 0 : at);
            }
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setClsCursorIndex(null);
          }}
          onKeyDown={(e) => {
            const match = CLASSIFICATIONS.find((c) => c.key === e.key);
            if (match) {
              e.preventDefault();
              onCommitClassification(lot, index, match.value, setError);
              return;
            }
            const cursor = clsCursorIndex ?? Math.max(0, CLASSIFICATIONS.findIndex((c) => c.value === currentCls));
            if (e.key === "ArrowRight") {
              e.preventDefault();
              if (cursor === CLASSIFICATIONS.length - 1) {
                const nextField = rowFields[rowFields.indexOf("classification") + 1];
                if (nextField) onNavigate(index, nextField);
                else onNavigate(index + 1, "valuation");
              } else setClsCursorIndex(cursor + 1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              if (cursor === 0) onNavigate(index, "valuation");
              else setClsCursorIndex(cursor - 1);
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              onNavigate(e.key === "ArrowUp" ? index - 1 : index + 1, "classification");
            } else if (e.key === "Enter") {
              e.preventDefault();
              const c = CLASSIFICATIONS[cursor];
              if (currentCls === c.value) onNavigate(index, "classification");
              else onCommitClassification(lot, index, c.value, setError);
            }
          }}
          className="flex gap-1 flex-wrap rounded-lg outline-none"
          style={clsNeeded ? { outline: "1.5px solid var(--warn)", outlineOffset: 2 } : undefined}
        >
          {CLASSIFICATIONS.map((c, ci) => {
            const highlighted = clsCursorIndex === ci;
            return (
              <button
                key={c.value}
                type="button"
                tabIndex={-1}
                disabled={saving || !valued}
                onClick={() => onCommitClassification(lot, index, c.value, setError)}
                title={
                  !valued
                    ? "Save a valuation first — a classification grades a value"
                    : currentCls === c.value
                      ? "Click again to unset"
                      : `Mark as ${c.label} (press ${c.key})`
                }
                className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold border-[1.5px] cursor-pointer whitespace-nowrap disabled:cursor-not-allowed"
                style={{
                  borderColor: displayCls === c.value ? c.color : "var(--border)",
                  background: displayCls === c.value ? c.color : "transparent",
                  color: displayCls === c.value ? "var(--paper-0)" : "var(--text-muted)",
                  opacity: valued || liveTier ? 1 : 0.45,
                  ...(highlighted && { boxShadow: `0 0 0 2px ${c.color}` }),
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        {rowActive && gradeStats && (
          <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-1">
            <span className="text-[10px] text-text-muted font-mono whitespace-nowrap">
              {gradeStats.saleName} · {lot.grade}:
            </span>
            {CLASSIFICATIONS.map((c) => {
              const t = tierStatsFor(gradeStats, c.value);
              if (!t) return null;
              return (
                <span key={c.value} className="text-[10px] font-mono font-semibold whitespace-nowrap" style={{ color: c.color }}>
                  {c.short} {formatTierRange(t, false)} ({Math.round(t.percent)}%)
                </span>
              );
            })}
          </div>
        )}
        {prevMsg && (
          <span className="text-[10.5px] block mt-1" style={{ color: prevMsgColor }}>
            {prevMsg}
          </span>
        )}
        {clsNeeded && (
          <span className="text-[10.5px] block mt-1" style={{ color: "var(--warn)" }}>
            Classification required — ←/→ then Enter, press 1–4, or click a tier to move on
          </span>
        )}
      </TableCell>
      {enabledExtras.map((f) => (
        <TableCell key={f.value}>
          <input
            ref={(el) => registerExtraRef(f.value, el)}
            type="text"
            placeholder={f.label}
            className="w-[200px] px-2.5 py-1.5 rounded border text-[13px] bg-transparent"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
            value={extraValues[`${f.value}:${lot.id}`] ?? ""}
            disabled={saving}
            onChange={(e) => onExtraChange(lot.id, f.value, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitExtra(lot, index, f.value, setError);
                return;
              }
              const el = e.currentTarget;
              const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
              const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
              const at = rowFields.indexOf(f.value);
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                const target = e.key === "ArrowUp" ? index - 1 : index + 1;
                onSaveExtra(lot, f.value, setError).then((ok) => {
                  if (ok) onNavigate(target, f.value);
                });
              } else if (e.key === "ArrowRight" && atEnd) {
                e.preventDefault();
                onSaveExtra(lot, f.value, setError).then((ok) => {
                  if (!ok) return;
                  const nextField = rowFields[at + 1];
                  if (nextField) onNavigate(index, nextField);
                  else onNavigate(index + 1, "valuation");
                });
              } else if (e.key === "ArrowLeft" && atStart) {
                e.preventDefault();
                onSaveExtra(lot, f.value, setError).then((ok) => {
                  if (ok) onNavigate(index, rowFields[at - 1]);
                });
              }
            }}
          />
        </TableCell>
      ))}
      <TableCell>
        {complete ? (
          <CheckCircleIcon sx={{ fontSize: 18, color: "var(--sage)" }} />
        ) : saved ? (
          <span title="Valued — classification still needed">
            <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: "var(--warn)" }} />
          </span>
        ) : (
          <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: "var(--text-muted)" }} />
        )}
      </TableCell>
      <TableCell sx={{ width: 72, p: 0.5, whiteSpace: "nowrap" }}>
        <Tooltip title="Full lot details (every catalogue column)">
          <IconButton size="small" onClick={() => onView(lot)} aria-label="Show full lot details">
            <VisibilityOutlinedIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Focus on this lot (full details + keypad)">
          <IconButton size="small" onClick={() => onFocusMode(lot.id)} aria-label="Focus on this lot">
            <OpenInFullIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

export default memo(LotRowImpl);
