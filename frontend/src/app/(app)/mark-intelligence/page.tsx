"use client";

import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { api, ApiError } from "@/lib/api";
import { brokerColorVar, brokerName, brokerPaletteCss } from "@/lib/brokers";
import type { AscActivityStatus, FactoryRecord, MarkActivityChange, MarkBrokerEra, MarkRecord, Plantation } from "@/types/api";
import ChevronRightOutlinedIcon from "@mui/icons-material/ChevronRightOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import { useEffect, useState } from "react";

type View =
  | { level: "plantations" }
  | { level: "factories"; plantation: Plantation }
  | { level: "marks"; plantation: Plantation; factory: FactoryRecord }
  | { level: "mark"; plantation: Plantation; factory: FactoryRecord; mark: MarkRecord };

type Tab = "browse" | "alerts";

const ASC_STATUS_COLOR: Record<AscActivityStatus, string> = {
  Active: "var(--sage-dark)",
  AtRisk: "var(--warn)",
  Lost: "var(--danger)",
};

const ASC_STATUS_LABEL: Record<AscActivityStatus, string> = {
  Active: "Active with ASC",
  AtRisk: "At risk — no ASC activity in 3 months",
  Lost: "Lost — no ASC activity in 6 months",
};

function AscActivityBadge({ status }: { status: AscActivityStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium"
      style={{ background: "var(--surface-sunken)", color: ASC_STATUS_COLOR[status] }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ASC_STATUS_COLOR[status] }} />
      {ASC_STATUS_LABEL[status]}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "never on record";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** A mark counts as "newly incoming" for badge purposes while it's within the 3-month
 *  early-warning window of first being seen — after that it's just a normal active mark.
 *  90 days must match MarkAscActivityCheckService.WarningWindow (backend/Asc.Api/Modules/
 *  MarkIntelligence/MarkAscActivityCheckService.cs) — there's no API exposing that constant
 *  today, so change both together if it's ever retuned. */
function isRecentlyIncoming(firstSeenWithAsc: string | null): boolean {
  if (!firstSeenWithAsc) return false;
  return Date.now() - new Date(firstSeenWithAsc).getTime() <= 90 * 24 * 60 * 60 * 1000;
}

function BrokerChip({ code }: { code: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium"
      style={{ background: "var(--surface-sunken)", color: "var(--text)" }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: brokerColorVar(code) }} />
      {brokerName(code) ?? code}
    </span>
  );
}

/** "Broker X (2019–2022) → Broker Y (2022–present)" — the plan's own example phrasing,
 *  not a raw table of every mined era field. Shared eras (2+ brokers active at once) show
 *  as "Broker X + Broker Y" within one arrow-segment rather than as two separate rows. */
function EraTimeline({ eras }: { eras: MarkBrokerEra[] }) {
  if (eras.length === 0) return <p className="text-[13px] text-text-muted m-0">No broker history recorded yet for this mark.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {eras.map((era, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <ChevronRightOutlinedIcon sx={{ fontSize: 16, color: "var(--text-muted)" }} />}
          <span
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border text-[12.5px]"
            style={{ background: era.isShared ? "var(--liquor-light)" : "var(--surface)" }}
          >
            <span className="font-medium">{era.brokers.map((b) => brokerName(b) ?? b).join(" + ")}</span>
            <span className="font-mono text-text-muted">
              {era.startYear}
              {era.startSaleNo ? `·S${era.startSaleNo}` : ""}–{era.endYear ? `${era.endYear}${era.endSaleNo ? `·S${era.endSaleNo}` : ""}` : "present"}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

export default function MarkIntelligencePage() {
  const [tab, setTab] = useState<Tab>("browse");
  const [view, setView] = useState<View>({ level: "plantations" });
  const [plantations, setPlantations] = useState<Plantation[] | null>(null);
  const [factories, setFactories] = useState<FactoryRecord[] | null>(null);
  const [marks, setMarks] = useState<MarkRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MarkRecord[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    api
      .listPlantations()
      .then(setPlantations)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load plantations"));
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults(null);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      api
        .searchMarkIntelligence(query.trim())
        .then(setSearchResults)
        .catch((e) => setError(e instanceof ApiError ? e.message : "Search failed"))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  const openPlantation = (p: Plantation) => {
    setView({ level: "factories", plantation: p });
    setFactories(null);
    api
      .listFactoriesForPlantation(p.id)
      .then(setFactories)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load factories"));
  };

  const openFactory = (f: FactoryRecord) => {
    if (view.level !== "factories") return;
    setView({ level: "marks", plantation: view.plantation, factory: f });
    setMarks(null);
    api
      .listMarksForFactory(f.id)
      .then(setMarks)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load marks"));
  };

  // Reached via search or an Activity Alert, with no drill-down context yet — synthesize
  // just enough of a trail from the mark's own denormalized factory/plantation fields.
  // plantationId/plantation.id can be "" here (a mark with no known plantation group) —
  // goToFactories below treats that as "nothing to fetch" rather than dead-ending.
  const viewForMark = (m: MarkRecord): View => ({
    level: "mark",
    plantation: { id: m.plantationId ?? "", name: m.plantationName ?? "—", isActive: true, factoryCount: 0 },
    factory: { id: m.factoryId, plantationId: m.plantationId, code: m.factoryCode, name: m.factoryName, isActive: true, markCount: 0 },
    mark: m,
  });

  const openMark = (m: MarkRecord) => {
    if (view.level === "marks") setView({ level: "mark", plantation: view.plantation, factory: view.factory, mark: m });
    else setView(viewForMark(m));
  };

  const openMarkById = (markId: string) => {
    api
      .getMark(markId)
      .then((m) => {
        setTab("browse");
        setView(viewForMark(m));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load mark"));
  };

  const goToPlantations = () => setView({ level: "plantations" });

  // Reachable from a mark opened via search/an alert, where factories/marks were never
  // fetched for this plantation/factory (unlike the normal drill-down path) — fetch here
  // too so the breadcrumb never dead-ends on a stuck loading state.
  const goToFactories = () => {
    if (view.level === "plantations") return;
    setView({ level: "factories", plantation: view.plantation });
    if (!view.plantation.id) {
      setFactories([]); // synthetic "no known plantation" trail — nothing to fetch
      return;
    }
    setFactories(null);
    api
      .listFactoriesForPlantation(view.plantation.id)
      .then(setFactories)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load factories"));
  };

  const goToMarks = () => {
    if (view.level !== "mark") return;
    setView({ level: "marks", plantation: view.plantation, factory: view.factory });
    setMarks(null);
    api
      .listMarksForFactory(view.factory.id)
      .then(setMarks)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load marks"));
  };

  return (
    <div>
      <style>{brokerPaletteCss()}</style>
      <PageHeader
        title="Mark Intelligence"
        subtitle="Plantations, factories and the marks they sell under — current broker(s), ASC activity, and how both have changed over time."
      />

      <div className="flex items-center gap-1 p-1 rounded-[var(--radius-lg)] mb-5 w-fit" style={{ background: "var(--surface-sunken)" }}>
        {(["browse", "alerts"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="px-3.5 py-1.5 rounded-[calc(var(--radius-lg)-4px)] text-[13px] font-medium transition-colors"
            style={tab === t ? { background: "var(--surface)", color: "var(--text-strong)" } : { color: "var(--text-muted)" }}
          >
            {t === "browse" ? "Browse" : "Activity Alerts"}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 p-3 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}

      {tab === "alerts" ? (
        <ActivityAlertsView onOpenMark={openMarkById} onError={(msg) => setError(msg)} />
      ) : (
      <>
      <TextField
        fullWidth
        size="small"
        placeholder="Search by mark or factory code/name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-5"
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchOutlinedIcon fontSize="small" /></InputAdornment> } }}
      />

      {query.trim() ? (
        <div>
          {searching ? (
            <div className="flex justify-center py-10">
              <TeaLoader size={36} />
            </div>
          ) : searchResults && searchResults.length > 0 ? (
            <div className="flex flex-col gap-2">
              {searchResults.map((m) => (
                <MarkRow key={m.id} mark={m} onClick={() => openMark(m)} />
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-text-muted text-center py-10">No marks or factories match &ldquo;{query}&rdquo;.</p>
          )}
        </div>
      ) : (
        <div>
          <Breadcrumbs view={view} onPlantations={goToPlantations} onFactories={goToFactories} onMarks={goToMarks} />

          {view.level === "plantations" &&
            (plantations === null ? (
              <div className="flex justify-center py-10">
                <TeaLoader size={36} />
              </div>
            ) : (
              <CardGrid>
                {plantations.map((p) => (
                  <Card key={p.id} title={p.name} subtitle={`${p.factoryCount} factor${p.factoryCount === 1 ? "y" : "ies"}`} onClick={() => openPlantation(p)} />
                ))}
              </CardGrid>
            ))}

          {view.level === "factories" &&
            (factories === null ? (
              <div className="flex justify-center py-10">
                <TeaLoader size={36} />
              </div>
            ) : factories.length === 0 ? (
              <p className="text-[13px] text-text-muted py-10 text-center">No factories recorded under this plantation yet.</p>
            ) : (
              <CardGrid>
                {factories.map((f) => (
                  <Card key={f.id} title={f.name} subtitle={`${f.code} · ${f.markCount} mark${f.markCount === 1 ? "" : "s"}`} onClick={() => openFactory(f)} />
                ))}
              </CardGrid>
            ))}

          {view.level === "marks" &&
            (marks === null ? (
              <div className="flex justify-center py-10">
                <TeaLoader size={36} />
              </div>
            ) : marks.length === 0 ? (
              <p className="text-[13px] text-text-muted py-10 text-center">No marks recorded under this factory yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {marks.map((m) => (
                  <MarkRow key={m.id} mark={m} onClick={() => openMark(m)} />
                ))}
              </div>
            ))}

          {view.level === "mark" && <MarkDetail mark={view.mark} factory={view.factory} />}
        </div>
      )}
      </>
      )}
    </div>
  );
}

function Breadcrumbs({
  view,
  onPlantations,
  onFactories,
  onMarks,
}: {
  view: View;
  onPlantations: () => void;
  onFactories: () => void;
  onMarks: () => void;
}) {
  if (view.level === "plantations") return null;
  return (
    <div className="flex items-center flex-wrap gap-1 text-[13px] mb-4" style={{ color: "var(--text-muted)" }}>
      <button type="button" onClick={onPlantations} className="underline-offset-2 hover:underline" style={{ color: "var(--liquor)" }}>
        Plantations
      </button>
      <ChevronRightOutlinedIcon sx={{ fontSize: 15 }} />
      {view.level === "factories" ? (
        <span className="font-medium" style={{ color: "var(--text-strong)" }}>{view.plantation.name}</span>
      ) : (
        <button type="button" onClick={onFactories} className="underline-offset-2 hover:underline" style={{ color: "var(--liquor)" }}>
          {view.plantation.name}
        </button>
      )}
      {(view.level === "marks" || view.level === "mark") && (
        <>
          <ChevronRightOutlinedIcon sx={{ fontSize: 15 }} />
          {view.level === "marks" ? (
            <span className="font-medium" style={{ color: "var(--text-strong)" }}>{view.factory.name}</span>
          ) : (
            <button type="button" onClick={onMarks} className="underline-offset-2 hover:underline" style={{ color: "var(--liquor)" }}>
              {view.factory.name}
            </button>
          )}
        </>
      )}
      {view.level === "mark" && (
        <>
          <ChevronRightOutlinedIcon sx={{ fontSize: 15 }} />
          <span className="font-medium" style={{ color: "var(--text-strong)" }}>{view.mark.name}</span>
        </>
      )}
    </div>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>{children}</div>;
}

function Card({ title, subtitle, onClick }: { title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left p-4 rounded-[var(--radius-lg)] border border-border transition-colors hover:border-[var(--liquor)]"
      style={{ background: "var(--surface)" }}
    >
      <p className="font-display font-semibold text-[14.5px] m-0 mb-1" style={{ color: "var(--text-strong)" }}>{title}</p>
      <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>{subtitle}</p>
    </button>
  );
}

function MarkRow({ mark, onClick }: { mark: MarkRecord; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between gap-3 text-left p-3.5 rounded-[var(--radius-lg)] border border-border transition-colors hover:border-[var(--liquor)]"
      style={{ background: "var(--surface)" }}
    >
      <div className="min-w-0">
        <p className="font-mono text-[13.5px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
          {mark.code}
          {mark.status === "Discontinued" && (
            <span className="ml-2 font-sans text-[11px] font-normal px-2 py-0.5 rounded-full" style={{ background: "var(--danger-light)", color: "var(--danger)" }}>
              Discontinued
            </span>
          )}
        </p>
        <p className="text-[12px] m-0 mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
          {mark.factoryCode} — {mark.factoryName}
          {mark.plantationName ? ` · ${mark.plantationName}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {mark.currentBrokers.length === 0 ? (
          <span className="text-[12px] text-text-muted">No current broker</span>
        ) : (
          mark.currentBrokers.map((b) => <BrokerChip key={b} code={b} />)
        )}
      </div>
    </button>
  );
}

function MarkDetail({ mark, factory }: { mark: MarkRecord; factory: FactoryRecord }) {
  return (
    <div className="p-5 rounded-[var(--radius-lg)] border border-border" style={{ background: "var(--surface)" }}>
      <p className="font-mono text-[11px] tracking-[0.15em] uppercase mb-2" style={{ color: "var(--liquor)" }}>
        {factory.code} — {factory.name}
      </p>
      <h2 className="font-display font-bold text-[22px] m-0 mb-3" style={{ color: "var(--text-strong)" }}>
        {mark.name}
      </h2>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <AscActivityBadge status={mark.ascActivityStatus} />
        {isRecentlyIncoming(mark.firstSeenWithAsc) && (
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-medium"
            style={{ background: "var(--liquor-light)", color: "var(--liquor)" }}
          >
            Newly incoming for ASC
          </span>
        )}
        <span className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
          Last ASC activity: {formatDate(mark.lastAscActivityAt)}
        </span>
      </div>

      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-wide font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
          Current Broker{mark.isCurrentlyShared ? "s" : ""}
        </p>
        {mark.currentBrokers.length === 0 ? (
          <p className="text-[13px] text-text-muted m-0">No current broker on record.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {mark.currentBrokers.map((b) => <BrokerChip key={b} code={b} />)}
          </div>
        )}
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
          Broker History
        </p>
        <EraTimeline eras={mark.timeline} />
      </div>
    </div>
  );
}

type AlertKind = "All" | "AtRisk" | "Lost" | "NewlyIncoming" | "NewlyShared";

const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  All: "All",
  AtRisk: "At Risk",
  Lost: "Lost",
  NewlyIncoming: "Newly Incoming",
  NewlyShared: "Newly Shared",
};

/** The durable "what changed" view — backed entirely by MarkActivitySnapshot via
 *  GET activity/changes (see docs/29_Mark_Intelligence.md), never re-derived live. */
function ActivityAlertsView({ onOpenMark, onError }: { onOpenMark: (markId: string) => void; onError: (message: string) => void }) {
  const [kind, setKind] = useState<AlertKind>("All");
  const [changes, setChanges] = useState<MarkActivityChange[] | null>(null);

  useEffect(() => {
    setChanges(null);
    api
      .listActivityChanges({ window: "6mo", kind: kind === "All" ? undefined : kind })
      .then(setChanges)
      .catch((e) => onError(e instanceof ApiError ? e.message : "Couldn't load activity alerts"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {(Object.keys(ALERT_KIND_LABEL) as AlertKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className="px-3 py-1.5 rounded-full text-[12.5px] font-medium border transition-colors"
            style={
              kind === k
                ? { background: "var(--liquor)", borderColor: "var(--liquor)", color: "var(--surface)" }
                : { background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-muted)" }
            }
          >
            {ALERT_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {changes === null ? (
        <div className="flex justify-center py-10">
          <TeaLoader size={36} />
        </div>
      ) : changes.length === 0 ? (
        <p className="text-[13px] text-text-muted text-center py-10">Nothing to show for this filter over the last 6 months.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {changes.map((c) => (
            <button
              key={c.markId}
              type="button"
              onClick={() => onOpenMark(c.markId)}
              className="flex items-center justify-between gap-3 text-left p-3.5 rounded-[var(--radius-lg)] border border-border transition-colors hover:border-[var(--liquor)]"
              style={{ background: "var(--surface)" }}
            >
              <div className="min-w-0">
                <p className="font-mono text-[13.5px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>{c.markCode}</p>
                <p className="text-[12px] m-0 mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                  {c.factoryCode} — {c.factoryName}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {c.newlyIncomingForAsc && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: "var(--liquor-light)", color: "var(--liquor)" }}>
                    Newly incoming
                  </span>
                )}
                {c.newlySharedDetected && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: "var(--liquor-light)", color: "var(--liquor)" }}>
                    Newly shared
                  </span>
                )}
                <AscActivityBadge status={c.status} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
