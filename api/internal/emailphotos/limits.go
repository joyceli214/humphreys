// Package emailphotos finds the photos attached to a work order, shrinks them
// for email and enforces the attachment limits for customer emails.
package emailphotos

// Limits for photos attached to a customer email. The web app mirrors these in
// web/src/lib/email-photos.ts, and GET /work-orders/:id/email-photos returns
// them so the dialog always uses the server's numbers.
//
// MaxTotalBytes is the total size of the shrunken JPEGs we attach. Attachments
// are base64-encoded in the MIME message (about +37% with line breaks), so
// 15 MB of photos is roughly a 20 MB email: under Exchange Online's default
// 35 MB send limit and the 20-25 MB receive limit of Gmail, Outlook.com and most
// ISP mailboxes.
const (
	MaxPhotos     = 10
	MaxTotalBytes = 15_000_000

	// MaxLongEdge and JPEGQuality control how photos are shrunk before sending.
	MaxLongEdge = 1600
	JPEGQuality = 80
	// ThumbnailEdge is the long edge of the dialog previews.
	ThumbnailEdge = 360

	// maxSourcePixels guards against decompression bombs (about 60 megapixels).
	maxSourcePixels = 60_000_000
)
