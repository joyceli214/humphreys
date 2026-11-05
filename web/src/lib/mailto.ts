/**
 * mailto: links for handing a draft to the device's email app.
 *
 * Long mailto URLs are silently truncated or rejected by some browsers and mail
 * clients, so past MAILTO_MAX_LENGTH we drop the body from the link and the
 * caller copies the full draft to the clipboard instead. Nothing is truncated.
 */
export const MAILTO_MAX_LENGTH = 1800;

export type MailtoLink = { href: string; tooLong: boolean };

const toCRLF = (text: string) => text.replace(/\r\n|\r|\n/g, "\r\n");

/** Encodes the address part; "@" stays readable, everything else ("?", "&", "+") is escaped. */
const encodeRecipient = (to: string) => encodeURIComponent(to.trim()).replace(/%40/g, "@");

export function buildMailto(to: string, subject: string, body: string): MailtoLink {
  const base = `mailto:${encodeRecipient(to)}?subject=${encodeURIComponent(toCRLF(subject))}`;
  const full = `${base}&body=${encodeURIComponent(toCRLF(body))}`;
  if (full.length <= MAILTO_MAX_LENGTH) return { href: full, tooLong: false };
  return { href: base, tooLong: true };
}

/** Plain-text copy of a draft for the clipboard fallback. */
export function draftClipboardText(subject: string, body: string): string {
  return `Subject: ${subject}\n\n${body}`;
}

/** Indirection so tests can observe navigation (jsdom can't navigate to mailto:). */
export const mailtoNavigator = {
  open(href: string) {
    window.location.href = href;
  }
};
