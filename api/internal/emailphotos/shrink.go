package emailphotos

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/gif" // register decoders
	"image/jpeg"
	_ "image/png"
	"net/http"
	"path"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// ErrUnsupported is returned for files that can't be attached as photos.
var ErrUnsupported = errors.New("unsupported photo")

// UnsupportedError explains why a file can't be attached.
type UnsupportedError struct{ Reason string }

func (e *UnsupportedError) Error() string        { return e.Reason }
func (e *UnsupportedError) Is(target error) bool { return target == ErrUnsupported }

// Prepared is a photo ready to attach: a re-encoded JPEG without metadata.
type Prepared struct {
	// Thumbnail is a small JPEG (ThumbnailEdge px) for the email dialog.
	Thumbnail     []byte
	Name          string
	ContentType   string
	Data          []byte
	Width         int
	Height        int
	OriginalBytes int
	OriginalType  string
}

// DetectType sniffs the real file type from its bytes (never trusts the name).
func DetectType(data []byte) string {
	if len(data) >= 12 && string(data[4:8]) == "ftyp" {
		brand := strings.ToLower(string(data[8:12]))
		switch {
		case strings.HasPrefix(brand, "hei"), strings.HasPrefix(brand, "hev"), brand == "mif1", brand == "msf1":
			return "image/heic"
		case strings.HasPrefix(brand, "avi"):
			return "image/avif"
		}
	}
	trimmed := bytes.TrimSpace(data[:min(len(data), 512)])
	if bytes.HasPrefix(trimmed, []byte("<svg")) || (bytes.HasPrefix(trimmed, []byte("<?xml")) && bytes.Contains(data[:min(len(data), 2048)], []byte("<svg"))) {
		return "image/svg+xml"
	}
	return http.DetectContentType(data)
}

// Shrink decodes a JPEG, PNG, GIF or WebP photo, applies its EXIF rotation,
// scales it so the long edge is at most MaxLongEdge and re-encodes it as a
// JPEG (quality JPEGQuality). Re-encoding drops EXIF data such as GPS location.
// The output is deterministic for the same input bytes.
func Shrink(data []byte, name string) (Prepared, error) {
	detected := DetectType(data)
	switch detected {
	case "image/jpeg", "image/png", "image/gif", "image/webp":
	case "image/svg+xml":
		return Prepared{}, &UnsupportedError{Reason: "SVG drawings can't be attached as photos"}
	case "image/heic", "image/avif":
		return Prepared{}, &UnsupportedError{Reason: "HEIC/AVIF photos can't be converted for email yet"}
	default:
		return Prepared{}, &UnsupportedError{Reason: "This file is not a photo we can attach"}
	}

	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return Prepared{}, &UnsupportedError{Reason: "This photo could not be read"}
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width*config.Height > maxSourcePixels {
		return Prepared{}, &UnsupportedError{Reason: "This photo is too large to convert"}
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return Prepared{}, &UnsupportedError{Reason: "This photo could not be read"}
	}

	orientation := 1
	if detected == "image/jpeg" {
		orientation = jpegOrientation(data)
	}
	bounds := src.Bounds()
	width, height := fitWithin(bounds.Dx(), bounds.Dy(), MaxLongEdge)

	// Scale first (cheap to rotate afterwards). Draw onto white so transparent
	// PNG/GIF areas don't turn black in the JPEG.
	scaled := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(scaled, scaled.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	if width == bounds.Dx() && height == bounds.Dy() {
		draw.Draw(scaled, scaled.Bounds(), src, bounds.Min, draw.Over)
	} else {
		draw.CatmullRom.Scale(scaled, scaled.Bounds(), src, bounds, draw.Over, nil)
	}
	dst := applyOrientation(scaled, orientation)
	width, height = dst.Bounds().Dx(), dst.Bounds().Dy()

	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: JPEGQuality}); err != nil {
		return Prepared{}, fmt.Errorf("encode jpeg: %w", err)
	}
	thumbnail, err := encodeThumbnail(dst)
	if err != nil {
		return Prepared{}, err
	}
	return Prepared{
		Thumbnail:     thumbnail,
		Name:          jpegName(name),
		ContentType:   "image/jpeg",
		Data:          out.Bytes(),
		Width:         width,
		Height:        height,
		OriginalBytes: len(data),
		OriginalType:  detected,
	}, nil
}

func fitWithin(width, height, maxEdge int) (int, int) {
	long := max(width, height)
	if long <= maxEdge {
		return width, height
	}
	scale := float64(maxEdge) / float64(long)
	return max(1, int(float64(width)*scale+0.5)), max(1, int(float64(height)*scale+0.5))
}

func jpegName(name string) string {
	base := path.Base(strings.TrimSpace(name))
	if base == "" || base == "." || base == "/" {
		base = "photo"
	}
	if ext := path.Ext(base); ext != "" {
		base = strings.TrimSuffix(base, ext)
	}
	return base + ".jpg"
}

// applyOrientation rotates/flips an image according to its EXIF orientation.
func applyOrientation(src image.Image, orientation int) image.Image {
	if orientation <= 1 || orientation > 8 {
		return src
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	swap := orientation >= 5
	dw, dh := w, h
	if swap {
		dw, dh = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var dx, dy int
			switch orientation {
			case 2:
				dx, dy = w-1-x, y
			case 3:
				dx, dy = w-1-x, h-1-y
			case 4:
				dx, dy = x, h-1-y
			case 5:
				dx, dy = y, x
			case 6:
				dx, dy = h-1-y, x
			case 7:
				dx, dy = h-1-y, w-1-x
			case 8:
				dx, dy = y, w-1-x
			}
			dst.Set(dx, dy, src.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}

// encodeThumbnail makes the small preview shown in the dialog, so the browser
// doesn't download every full-size original.
func encodeThumbnail(src image.Image) ([]byte, error) {
	bounds := src.Bounds()
	width, height := fitWithin(bounds.Dx(), bounds.Dy(), ThumbnailEdge)
	thumb := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.ApproxBiLinear.Scale(thumb, thumb.Bounds(), src, bounds, draw.Src, nil)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, thumb, &jpeg.Options{Quality: 70}); err != nil {
		return nil, fmt.Errorf("encode thumbnail: %w", err)
	}
	return out.Bytes(), nil
}
