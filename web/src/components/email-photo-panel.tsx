import { useState } from "react";
import { Check, ChevronDown, ImageOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatMegabytes,
  normalizePhotoUrl,
  selectAllPhotos,
  summarizePhotoSelection,
  togglePhotoSelection,
  type EmailPhoto,
  type EmailPhotoLimits
} from "@/lib/email-photos";

type EmailPhotoPanelProps = {
  /** Photos from the server (ids + real send sizes); null while loading. */
  photos: EmailPhoto[] | null;
  /** Photo links found in the job text, shown while the server list loads. */
  placeholderUrls: string[];
  loading: boolean;
  error: string | null;
  limits: EmailPhotoLimits;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  layout: "side" | "stacked";
};

type Tile = { key: string; url: string; photo: EmailPhoto | null; index: number };

function buildTiles(photos: EmailPhoto[] | null, placeholderUrls: string[]): Tile[] {
  if (photos) return photos.map((photo, index) => ({ key: photo.id, url: photo.url, photo, index }));
  return placeholderUrls.map((url, index) => ({ key: normalizePhotoUrl(url), url, photo: null, index }));
}

function SizeCounter({ photos, selectedIds, limits, loading }: Pick<EmailPhotoPanelProps, "photos" | "selectedIds" | "limits" | "loading">) {
  const summary = summarizePhotoSelection(photos, selectedIds, limits, loading);
  const atCap = summary.count >= limits.maxPhotos;
  return (
    <div aria-live="polite" className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className={cn("font-medium", summary.level === "over" && "text-destructive")}>{summary.label}</span>
        {loading && <Loader2 aria-label="Checking sizes" className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border/70" role="progressbar" aria-label="Email size used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(summary.ratio, 1) * 100)}>
        <div
          className={cn(
            "h-full rounded-full transition-all",
            summary.level === "ok" && "bg-primary",
            summary.level === "warn" && "bg-amber-500",
            summary.level === "over" && "bg-destructive"
          )}
          style={{ width: `${Math.min(summary.ratio, 1) * 100}%` }}
        />
      </div>
      {summary.blockedReason ? (
        <p className={cn("text-xs", loading ? "text-muted-foreground" : "text-destructive")}>{summary.blockedReason}</p>
      ) : summary.level === "warn" ? (
        <p className="text-xs text-amber-700">Close to the email size limit.</p>
      ) : atCap ? (
        <p className="text-xs text-muted-foreground">Up to {limits.maxPhotos} photos per email.</p>
      ) : (
        <p className="text-xs text-muted-foreground">Photos are shrunk for email. Sizes shown are what will be sent.</p>
      )}
    </div>
  );
}

function PhotoTile({
  tile,
  selected,
  disabled,
  onToggle,
  compact
}: {
  tile: Tile;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  compact: boolean;
}) {
  const photo = tile.photo;
  const unsupported = photo !== null && !photo.supported;
  const sizeText = photo === null ? null : unsupported ? "Can't attach" : formatMegabytes(photo.send_bytes);
  const label = `Photo ${tile.index + 1}${photo ? ` from ${photo.source}` : ""}${sizeText ? `, ${sizeText}` : ""}${selected ? ", selected" : ""}`;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      title={unsupported ? photo?.reason : photo ? `${photo.source} · ${photo.width}×${photo.height} · ${sizeText}` : "Checking size..."}
      disabled={disabled || photo === null || unsupported}
      onClick={onToggle}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-md border bg-white text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
        compact ? "w-28 shrink-0" : "w-full",
        selected ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/60",
        (photo === null || unsupported) && "cursor-not-allowed",
        unsupported && "opacity-50 grayscale"
      )}
    >
      <span className="relative block aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted">
        {tile.url ? (
          <img src={tile.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <ImageOff className="absolute inset-0 m-auto h-6 w-6 text-muted-foreground" />
        )}
        <span
          aria-hidden
          className={cn(
            "absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 shadow-sm",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-white bg-black/25 text-transparent"
          )}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
        {selected && <span aria-hidden className="absolute inset-0 bg-primary/10" />}
      </span>
      <span className="flex items-center justify-between gap-1 px-2 py-1 text-xs">
        <span className="truncate text-muted-foreground">{photo?.source ?? `Photo ${tile.index + 1}`}</span>
        {sizeText === null ? (
          <Loader2 aria-hidden className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <span className={cn("shrink-0 font-medium", unsupported ? "text-muted-foreground" : "text-foreground")}>{sizeText}</span>
        )}
      </span>
    </button>
  );
}

export function EmailPhotoPanel(props: EmailPhotoPanelProps) {
  const { photos, placeholderUrls, loading, error, limits, selectedIds, onChange, disabled = false, layout } = props;
  const [expanded, setExpanded] = useState(true);
  const tiles = buildTiles(photos, placeholderUrls);
  const stacked = layout === "stacked";
  const empty = !loading && tiles.length === 0;
  const selectable = (photos ?? []).filter((photo) => photo.supported);

  const toggle = (photo: EmailPhoto) => onChange(togglePhotoSelection(selectedIds, photo, limits));

  const actions = (
    <div className="flex items-center gap-1 text-xs">
      <button
        type="button"
        className="rounded px-2 py-1 font-medium text-primary hover:bg-white disabled:opacity-40"
        disabled={disabled || selectable.length === 0}
        onClick={() => onChange(selectAllPhotos(photos ?? [], limits))}
      >
        Select all
      </button>
      <button type="button" className="rounded px-2 py-1 text-muted-foreground hover:bg-white disabled:opacity-40" disabled={disabled || selectedIds.length === 0} onClick={() => onChange([])}>
        Clear
      </button>
    </div>
  );

  const body = (
    <>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {empty ? (
        <p className="rounded-md border border-dashed border-border bg-white px-3 py-6 text-center text-sm text-muted-foreground">This job has no photos yet.</p>
      ) : (
        <div className={cn(stacked ? "-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" : "grid grid-cols-2 gap-2")}>
          {tiles.map((tile) => (
            <PhotoTile
              key={tile.key}
              tile={tile}
              compact={stacked}
              selected={tile.photo ? selectedIds.includes(tile.photo.id) : false}
              disabled={disabled}
              onToggle={() => tile.photo && toggle(tile.photo)}
            />
          ))}
        </div>
      )}
    </>
  );

  if (stacked) {
    return (
      <section aria-label="Photos from this job" className="rounded-md border border-border bg-muted/30">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <button type="button" className="flex items-center gap-1.5 text-sm font-medium" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
            <ChevronDown className={cn("h-4 w-4 transition-transform", !expanded && "-rotate-90")} />
            Photos ({tiles.length})
          </button>
          {expanded && !empty && actions}
        </div>
        {expanded && (
          <div className="space-y-3 px-3 pb-3">
            {!empty && <SizeCounter photos={photos} selectedIds={selectedIds} limits={limits} loading={loading} />}
            {body}
          </div>
        )}
      </section>
    );
  }

  return (
    <aside aria-label="Photos from this job" className="flex w-[340px] shrink-0 flex-col border-l border-border bg-muted/30">
      <div className="shrink-0 space-y-3 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Photos from this job</h3>
          {!empty && actions}
        </div>
        {!empty && <SizeCounter photos={photos} selectedIds={selectedIds} limits={limits} loading={loading} />}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">{body}</div>
    </aside>
  );
}
