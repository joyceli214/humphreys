import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api/client";
import { DEFAULT_EMAIL_PHOTO_LIMITS, type EmailPhoto, type EmailPhotoLimits } from "@/lib/email-photos";

export type DraftPhotosState = {
  /** Photos of every job in the draft, grouped by job in draft order; null while loading. */
  photos: EmailPhoto[] | null;
  loading: boolean;
  error: string | null;
  limits: EmailPhotoLimits;
};

/**
 * Merges per-job photo lists into one list for the shared EmailPhotoPanel.
 * With more than one job the source is prefixed with the job number so the
 * tiles read "Job #6 · Repair log Jan 2". A photo used on two jobs is listed once.
 */
export function mergeJobPhotos(perJob: Array<{ jobId: number; items: EmailPhoto[] }>): EmailPhoto[] {
  const multi = perJob.length > 1;
  const seen = new Set<string>();
  const out: EmailPhoto[] = [];
  for (const { jobId, items } of perJob) {
    for (const photo of items) {
      if (seen.has(photo.id)) continue;
      seen.add(photo.id);
      out.push(multi ? { ...photo, source: `Job #${jobId} · ${photo.source}` } : photo);
    }
  }
  return out;
}

/** Loads the job-linked photos for a Management email draft (all of its jobs). */
export function useDraftPhotos(jobIds: number[] | null): DraftPhotosState {
  const [state, setState] = useState<DraftPhotosState>({ photos: null, loading: false, error: null, limits: DEFAULT_EMAIL_PHOTO_LIMITS });
  const requestRef = useRef(0);
  const key = jobIds?.join(",") ?? "";

  useEffect(() => {
    const ids = key ? key.split(",").map(Number) : [];
    const requestId = ++requestRef.current;
    if (ids.length === 0) {
      setState({ photos: null, loading: false, error: null, limits: DEFAULT_EMAIL_PHOTO_LIMITS });
      return;
    }
    setState((prev) => ({ ...prev, photos: null, loading: true, error: null }));
    void Promise.allSettled(ids.map((id) => Promise.resolve().then(() => apiClient.listWorkOrderEmailPhotos(id)))).then((results) => {
      if (requestId !== requestRef.current) return;
      const perJob: Array<{ jobId: number; items: EmailPhoto[] }> = [];
      const failed: number[] = [];
      let limits: EmailPhotoLimits | null = null;
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          perJob.push({ jobId: ids[index], items: result.value.items ?? [] });
          if (!limits) {
            limits = {
              maxPhotos: result.value.max_photos || DEFAULT_EMAIL_PHOTO_LIMITS.maxPhotos,
              maxTotalBytes: result.value.max_total_bytes || DEFAULT_EMAIL_PHOTO_LIMITS.maxTotalBytes
            };
          }
        } else {
          failed.push(ids[index]);
        }
      });
      setState({
        photos: mergeJobPhotos(perJob),
        loading: false,
        error: failed.length > 0 ? `Couldn't load photos for job(s) ${failed.map((id) => `#${id}`).join(", ")}.` : null,
        limits: limits ?? DEFAULT_EMAIL_PHOTO_LIMITS
      });
    });
  }, [key]);

  return state;
}
