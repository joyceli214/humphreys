/**
 * Photos that can be attached to a customer email.
 *
 * The server is the source of truth (GET /work-orders/:id/email-photos returns
 * each photo's id and the exact size it will have once shrunk). The helpers
 * here extract photo links from the job text so the panel can show thumbnails
 * straight away, and compute the live size counter.
 */

// Mirrors api/internal/emailphotos/limits.go. The API also returns these values
// and the dialog prefers the server's numbers.
export const EMAIL_PHOTO_MAX_COUNT = 10;
export const EMAIL_PHOTO_MAX_TOTAL_BYTES = 15_000_000;
export const EMAIL_PHOTO_WARN_RATIO = 0.8;

export type EmailPhoto = {
  id: string;
  url: string;
  name: string;
  source: string;
  original_bytes: number;
  send_bytes: number;
  original_type: string;
  width: number;
  height: number;
  supported: boolean;
  reason?: string;
};

export type EmailPhotoLimits = { maxPhotos: number; maxTotalBytes: number };

export const DEFAULT_EMAIL_PHOTO_LIMITS: EmailPhotoLimits = {
  maxPhotos: EMAIL_PHOTO_MAX_COUNT,
  maxTotalBytes: EMAIL_PHOTO_MAX_TOTAL_BYTES
};

const IMAGE_PATTERN = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;

/** Same photo, different signed link: compare without the query string. */
export function normalizePhotoUrl(raw: string) {
  const value = raw.trim().replace(/&amp;/g, "&");
  try {
    const url = new URL(value);
    return `${url.origin}${decodeURIComponent(url.pathname)}`;
  } catch {
    return value.split(/[?#]/)[0];
  }
}

/** Photo links in the job text (problem, work done, repair logs), in order, without duplicates. */
export function extractPhotoUrls(texts: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(IMAGE_PATTERN)) {
      const url = (match[1] ?? match[2] ?? "").trim();
      if (!/^https?:\/\//i.test(url)) continue;
      const key = normalizePhotoUrl(url);
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(url);
    }
  }
  return urls;
}

export function formatMegabytes(bytes: number) {
  const mb = bytes / 1_000_000;
  if (bytes > 0 && mb < 0.1) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${mb.toFixed(1)} MB`;
}

export type PhotoSelectionLevel = "ok" | "warn" | "over";

export type PhotoSelectionSummary = {
  count: number;
  totalBytes: number;
  ratio: number;
  level: PhotoSelectionLevel;
  /** Why Send is blocked, or null when the selection can be sent. */
  blockedReason: string | null;
  label: string;
};

export function summarizePhotoSelection(
  photos: EmailPhoto[] | null,
  selectedIds: string[],
  limits: EmailPhotoLimits = DEFAULT_EMAIL_PHOTO_LIMITS,
  loading = false
): PhotoSelectionSummary {
  const byId = new Map((photos ?? []).map((photo) => [photo.id, photo]));
  const selected = selectedIds.map((id) => byId.get(id)).filter((photo): photo is EmailPhoto => Boolean(photo));
  const totalBytes = selected.reduce((sum, photo) => sum + (photo.supported ? photo.send_bytes : 0), 0);
  const ratio = limits.maxTotalBytes > 0 ? totalBytes / limits.maxTotalBytes : 0;
  const count = selected.length;

  let blockedReason: string | null = null;
  if (count > limits.maxPhotos) {
    blockedReason = `You can attach up to ${limits.maxPhotos} photos. Unselect ${count - limits.maxPhotos} to send.`;
  } else if (totalBytes > limits.maxTotalBytes) {
    blockedReason = `Photos are too big for one email (${formatMegabytes(totalBytes)} of ${formatMegabytes(limits.maxTotalBytes)}). Unselect some photos to send.`;
  } else if (selected.some((photo) => !photo.supported)) {
    blockedReason = "One of the selected photos can't be attached. Unselect it to send.";
  } else if (loading && selectedIds.length > 0) {
    blockedReason = "Still checking photo sizes...";
  }

  const level: PhotoSelectionLevel = blockedReason && !loading ? "over" : ratio > 1 ? "over" : ratio > EMAIL_PHOTO_WARN_RATIO ? "warn" : "ok";
  const noun = count === 1 ? "photo" : "photos";
  return {
    count,
    totalBytes,
    ratio,
    level,
    blockedReason,
    label: `${count} ${noun} selected · ${formatMegabytes(totalBytes)} of ${formatMegabytes(limits.maxTotalBytes)}`
  };
}

/** Toggle one photo; refuses to add past the photo cap or for unsupported photos. */
export function togglePhotoSelection(selectedIds: string[], photo: EmailPhoto, limits: EmailPhotoLimits = DEFAULT_EMAIL_PHOTO_LIMITS) {
  if (selectedIds.includes(photo.id)) return selectedIds.filter((id) => id !== photo.id);
  if (!photo.supported || selectedIds.length >= limits.maxPhotos) return selectedIds;
  return [...selectedIds, photo.id];
}

/** Select photos in order until the photo cap or the size limit is reached. */
export function selectAllPhotos(photos: EmailPhoto[], limits: EmailPhotoLimits = DEFAULT_EMAIL_PHOTO_LIMITS) {
  const ids: string[] = [];
  let total = 0;
  for (const photo of photos) {
    if (!photo.supported) continue;
    if (ids.length >= limits.maxPhotos) break;
    if (total + photo.send_bytes > limits.maxTotalBytes) continue;
    total += photo.send_bytes;
    ids.push(photo.id);
  }
  return ids;
}
