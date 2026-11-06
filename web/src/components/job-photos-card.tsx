import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, ImagePlus, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import type { EmailPhoto } from "@/lib/email-photos";
import { markdownImageUploadHandler } from "@/components/work-notes-editor-config";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Props = {
  referenceId: number;
  /** Can list the job's photos (GET /email-photos needs work_orders_sensitive:read). */
  canView: boolean;
  /** Can save new photos (they are stored as a new repair log). */
  canAdd: boolean;
  /** Changes whenever repair logs / work notes change, so the gallery reloads. */
  refreshKey: string;
  /** Called after a photo log was created, to reload the repair logs. */
  onPhotosSaved?: () => Promise<void> | void;
};

/** Upload is limited to this many photos per pick (keeps one log readable). */
export const JOB_PHOTO_MAX_PER_PICK = 10;

function todayISODate() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Markdown for the auto-created photo repair log. */
export function photoLogMarkdown(urls: string[]) {
  const lines = ["**Photos**", ""];
  urls.forEach((url, index) => {
    lines.push(`![Photo ${index + 1}](${url})`, "");
  });
  return lines.join("\n").trim();
}

/**
 * Job photo strip (Option A "soft library"): lists every photo stored in the
 * job's Problem / Work done / Repair log text via the email-photos API, with a
 * zoomable lightbox. "Take photo" opens the device camera on phones; picked
 * photos upload straight away and are saved as a new dated repair log, so they
 * show up on every device after a refresh.
 */
export function JobPhotosCard({ referenceId, canView, canAdd, refreshKey, onPhotosSaved }: Props) {
  const [photos, setPhotos] = useState<EmailPhoto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const requestRef = useRef(0);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const res = await apiClient.listWorkOrderEmailPhotos(referenceId);
      if (requestId !== requestRef.current) return;
      setPhotos(res.items ?? []);
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setPhotos([]);
      setError(err instanceof Error ? `Couldn't load photos: ${err.message}` : "Couldn't load photos.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [canView, referenceId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter((file) => file.type === "" || file.type.startsWith("image/"));
    if (files.length === 0) return;
    if (files.length > JOB_PHOTO_MAX_PER_PICK) {
      setUploadError(`Pick up to ${JOB_PHOTO_MAX_PER_PICK} photos at a time.`);
      return;
    }
    setUploadError("");
    setUploading({ done: 0, total: files.length });
    const urls: string[] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        urls.push(await markdownImageUploadHandler(file));
      } catch (err) {
        failures.push(err instanceof Error ? err.message : `Couldn't upload ${file.name}`);
      }
      setUploading((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
    }
    try {
      if (urls.length > 0) {
        try {
          await apiClient.createRepairLog(referenceId, { repair_date: todayISODate(), hours_used: 0, details: photoLogMarkdown(urls) });
        } catch (err) {
          // The log wasn't saved: drop the temporary uploads so nothing is orphaned.
          for (const url of urls) void apiClient.deleteMarkdownImage(url).catch(() => {});
          throw err;
        }
        await onPhotosSaved?.();
        await load();
      }
      if (failures.length > 0) setUploadError(failures.join(" "));
    } catch (err) {
      setUploadError(err instanceof Error ? `Couldn't save photos: ${err.message}` : "Couldn't save photos.");
    } finally {
      setUploading(null);
    }
  };

  if (!canView && !canAdd) return null;

  const items = photos ?? [];
  const current = openIndex !== null ? items[openIndex] ?? null : null;
  const step = (delta: number) => {
    if (openIndex === null || items.length === 0) return;
    setZoomed(false);
    setOpenIndex((openIndex + delta + items.length) % items.length);
  };

  return (
    <section aria-label="Job photos" className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Job photos{canView && photos ? ` (${items.length})` : ""}
        </h3>
        {canAdd && (
          <div className="flex flex-wrap gap-2">
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              data-testid="job-photo-camera-input"
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <input
              ref={libraryRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              data-testid="job-photo-library-input"
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <Button size="sm" className="h-10 md:h-8" onClick={() => cameraRef.current?.click()} disabled={uploading !== null}>
              <Camera className="mr-1.5 h-4 w-4" />
              Take photo
            </Button>
            <Button size="sm" variant="outline" className="h-10 md:h-8" onClick={() => libraryRef.current?.click()} disabled={uploading !== null}>
              <ImagePlus className="mr-1.5 h-4 w-4" />
              Add photos
            </Button>
          </div>
        )}
      </div>

      {uploading && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Uploading {uploading.done}/{uploading.total}...
        </p>
      )}
      {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {canView ? (
        loading && photos === null ? (
          <p className="text-xs text-muted-foreground">Loading photos...</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No photos on this job yet.{canAdd ? " Take or add a photo; it is saved as a repair log." : ""}
          </p>
        ) : (
          <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Job photo strip">
            {items.map((photo, index) => (
              <li key={photo.id} className="shrink-0">
                <button
                  type="button"
                  className="block w-28 overflow-hidden rounded-md border border-border bg-white text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`Open photo ${index + 1} from ${photo.source}`}
                  onClick={() => {
                    setZoomed(false);
                    setOpenIndex(index);
                  }}
                >
                  <span className="relative block aspect-[4/3] w-full bg-muted">
                    <img src={photo.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                  </span>
                  <span className="block truncate px-1.5 py-1 text-[11px] text-muted-foreground">{photo.source}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="text-xs text-muted-foreground">Photos you add are saved to this job&apos;s repair logs.</p>
      )}

      <Dialog open={current !== null} onOpenChange={(open) => !open && setOpenIndex(null)}>
        <DialogContent className="flex max-h-[95vh] w-[95vw] max-w-5xl flex-col gap-2 p-3">
          {current && (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <DialogTitle className="truncate text-sm font-semibold">
                    Photo {(openIndex ?? 0) + 1} of {items.length} · {current.source}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    {current.width > 0 ? `${current.width}×${current.height}` : current.name}
                  </DialogDescription>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" aria-label={zoomed ? "Fit photo" : "Zoom photo"} onClick={() => setZoomed((value) => !value)}>
                    {zoomed ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={current.url} target="_blank" rel="noreferrer">
                      Open original
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" aria-label="Close photo" onClick={() => setOpenIndex(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className={cn("relative min-h-0 flex-1 rounded bg-black/90", zoomed ? "overflow-auto" : "flex items-center justify-center overflow-hidden")}>
                <img
                  src={current.url}
                  alt={`Photo ${(openIndex ?? 0) + 1} from ${current.source}`}
                  className={cn(zoomed ? "max-w-none cursor-zoom-out" : "max-h-[75vh] max-w-full cursor-zoom-in object-contain")}
                  onClick={() => setZoomed((value) => !value)}
                />
              </div>
              {items.length > 1 && (
                <div className="flex justify-between">
                  <Button size="sm" variant="outline" onClick={() => step(-1)} aria-label="Previous photo">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => step(1)} aria-label="Next photo">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
