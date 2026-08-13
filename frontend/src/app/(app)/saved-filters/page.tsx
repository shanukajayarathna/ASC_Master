"use client";

import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { isColumnFilterActive, type StoredFilterState } from "@/lib/lotFilters";
import type { FilterPreset } from "@/types/api";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import PlayArrowOutlinedIcon from "@mui/icons-material/PlayArrowOutlined";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Link from "next/link";
import { useEffect, useState } from "react";

function summarize(filtersJson: string): string {
  try {
    const f = JSON.parse(filtersJson) as StoredFilterState;
    let count = Object.values(f.columnFilters ?? {}).filter(isColumnFilterActive).length;
    if (f.search) count++;
    if (f.status) count++;
    if (f.classification) count++;
    if (f.year) count++;
    return `${count} filter${count === 1 ? "" : "s"}`;
  } catch {
    return "—";
  }
}

export default function SavedFiltersPage() {
  const { catalogues } = useCatalogue();
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [loading, setLoading] = useState(true);
  // Preset whose delete is in flight — its button locks so a double-click can't fire twice.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    api
      .listFilterPresets()
      .then(setPresets)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, []);

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      await api.deleteFilterPreset(id);
      setPresets((p) => p.filter((x) => x.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Saved Filters"
        subtitle="Filter combinations you've saved from Catalogue Manager — apply one to jump straight back to it."
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <TeaLoader size={44} />
        </div>
      ) : presets.length === 0 ? (
        <div className="text-center py-12 text-text-muted border border-dashed border-border rounded-lg">
          <p className="m-0">No saved filters yet — set some filters in Catalogue Manager and click &quot;Save as Preset&quot;.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {presets.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border border-border rounded-lg bg-surface px-3.5 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-text-strong truncate">{p.name}</div>
                <div className="text-[11px] text-text-muted font-mono">
                  {catalogues.find((c) => c.id === p.catalogueId)?.sourceName ?? "Unknown sale"} · {summarize(p.filtersJson)} ·{" "}
                  {new Date(p.createdAt).toLocaleString()}
                </div>
              </div>
              <Tooltip title="Apply">
                <IconButton size="small" component={Link} href={`/catalogue?presetId=${p.id}`} aria-label={`Apply ${p.name}`}>
                  <PlayArrowOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => remove(p.id)}
                    disabled={deletingId === p.id}
                    aria-busy={deletingId === p.id}
                    aria-label={`Delete ${p.name}`}
                  >
                    {deletingId === p.id ? <CircularProgress size={16} /> : <DeleteOutlineIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
