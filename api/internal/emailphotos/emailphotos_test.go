package emailphotos

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math/rand"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// noisyJPEG makes a photo-like JPEG (noise compresses poorly, like real photos).
func noisyJPEG(t *testing.T, w, h int, seed int64) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	r := rand.New(rand.NewSource(seed))
	for i := range img.Pix {
		img.Pix[i] = uint8(r.Intn(256))
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// withExif inserts an APP1 Exif segment (orientation + a fake GPS marker) after SOI.
func withExif(data []byte, orientation uint16) []byte {
	tiff := []byte{'M', 'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, byte(orientation >> 8), byte(orientation), 0, 0, 0, 0, 0, 0}
	payload := append([]byte("Exif\x00\x00"), tiff...)
	payload = append(payload, []byte("GPSLatitude=43.7")...)
	length := len(payload) + 2
	segment := append([]byte{0xFF, 0xE1, byte(length >> 8), byte(length)}, payload...)
	out := append([]byte{}, data[:2]...)
	out = append(out, segment...)
	return append(out, data[2:]...)
}

func TestShrinkResizesRotatesAndStripsExif(t *testing.T) {
	original := withExif(noisyJPEG(t, 4000, 3000, 1), 6)
	if jpegOrientation(original) != 6 {
		t.Fatalf("test fixture orientation not readable")
	}
	prepared, err := Shrink(original, "markdown/31225/IMG_0001.HEIC.jpeg")
	if err != nil {
		t.Fatalf("shrink: %v", err)
	}
	if prepared.Width != 1200 || prepared.Height != 1600 {
		t.Fatalf("expected rotated 1200x1600, got %dx%d", prepared.Width, prepared.Height)
	}
	if len(prepared.Data) >= len(original) {
		t.Fatalf("expected smaller output: %d >= %d", len(prepared.Data), len(original))
	}
	if bytes.Contains(prepared.Data, []byte("Exif")) || bytes.Contains(prepared.Data, []byte("GPSLatitude")) {
		t.Fatal("expected EXIF/GPS data to be stripped")
	}
	if prepared.Name != "IMG_0001.HEIC.jpg" || prepared.ContentType != "image/jpeg" || prepared.OriginalBytes != len(original) {
		t.Fatalf("unexpected metadata: %+v", prepared)
	}
	again, _ := Shrink(original, "x.jpg")
	if !bytes.Equal(again.Data, prepared.Data) {
		t.Fatal("expected deterministic output so the shown size equals the attached size")
	}
}

func TestShrinkKeepsSmallPhotoDimensionsAndFlattensTransparency(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 40, 20))
	img.Set(1, 1, color.NRGBA{R: 255, A: 255})
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	prepared, err := Shrink(buf.Bytes(), "diagram.png")
	if err != nil {
		t.Fatalf("shrink png: %v", err)
	}
	decoded, err := jpeg.Decode(bytes.NewReader(prepared.Data))
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Bounds().Dx() != 40 || decoded.Bounds().Dy() != 20 || prepared.Name != "diagram.jpg" {
		t.Fatalf("unexpected output %v %s", decoded.Bounds(), prepared.Name)
	}
	r, g, b, _ := decoded.At(30, 15).RGBA()
	if r>>8 < 240 || g>>8 < 240 || b>>8 < 240 {
		t.Fatalf("transparent area should be white, got %d %d %d", r>>8, g>>8, b>>8)
	}
}

func TestShrinkRejectsSVGHEICAndNonImages(t *testing.T) {
	cases := map[string][]byte{
		"svg":  []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"heic": append([]byte{0, 0, 0, 24}, []byte("ftypheic\x00\x00\x00\x00mif1heic")...),
		"pdf":  []byte("%PDF-1.4 not a photo"),
	}
	for name, data := range cases {
		if _, err := Shrink(data, name); !errors.Is(err, ErrUnsupported) {
			t.Fatalf("%s: expected ErrUnsupported, got %v", name, err)
		}
	}
}

type fakeStore struct {
	objects map[string][]byte
	reads   atomic.Int32
}

func (f *fakeStore) Enabled() bool { return true }
func (f *fakeStore) ManagedImageKeys(markdown string) []string {
	var keys []string
	for _, field := range strings.Fields(markdown) {
		if strings.HasPrefix(field, "managed:") {
			keys = append(keys, strings.TrimPrefix(field, "managed:"))
		}
	}
	return keys
}
func (f *fakeStore) GetObjectBytes(_ context.Context, key string) ([]byte, string, error) {
	f.reads.Add(1)
	data, ok := f.objects[key]
	if !ok {
		return nil, "", errors.New("missing")
	}
	return data, "", nil
}
func (f *fakeStore) PresignedGetURL(key string, _ time.Duration) (string, error) {
	return "https://storage.example/" + key + "?sig=1", nil
}

func TestCollectDedupesAcrossSourcesInOrder(t *testing.T) {
	store := &fakeStore{}
	photos := Collect(store, []Source{
		{Label: "Problem description", Markdown: "managed:a.jpg external managed:b.png"},
		{Label: "Work done", Markdown: "managed:b.png managed:c.jpg"},
		{Label: "Repair log", Markdown: "managed:a.jpg managed:d.jpg"},
	})
	got := []string{}
	for _, p := range photos {
		got = append(got, p.Key+"@"+p.Source)
	}
	want := "a.jpg@Problem description,b.png@Problem description,c.jpg@Work done,d.jpg@Repair log"
	if strings.Join(got, ",") != want {
		t.Fatalf("got %v", got)
	}
	if photos[0].ID != PhotoID("a.jpg") || len(photos[0].ID) != 24 {
		t.Fatalf("unexpected id %q", photos[0].ID)
	}
}

func TestResolveValidatesSelection(t *testing.T) {
	store := &fakeStore{objects: map[string][]byte{
		"a.jpg":   noisyJPEG(t, 800, 600, 1),
		"b.jpg":   noisyJPEG(t, 800, 600, 2),
		"bad.svg": []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`),
	}}
	service := NewService(store)
	available := Collect(store, []Source{{Markdown: "managed:a.jpg managed:b.jpg managed:bad.svg"}})
	ctx := context.Background()

	attachments, err := service.Resolve(ctx, available, []string{PhotoID("b.jpg"), PhotoID("a.jpg"), PhotoID("b.jpg")}, "job-31225")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(attachments) != 2 || attachments[0].Name != "job-31225-photo-1.jpg" || attachments[1].ContentType != "image/jpeg" {
		t.Fatalf("unexpected attachments: %+v", attachments)
	}

	if _, err := service.Resolve(ctx, available, []string{PhotoID("someone-elses-job/x.jpg")}, ""); !errors.Is(err, ErrPhotoNotOnJob) {
		t.Fatalf("expected foreign photo to be rejected, got %v", err)
	}
	if _, err := service.Resolve(ctx, available, []string{"https://evil.example/x.jpg"}, ""); !errors.Is(err, ErrPhotoNotOnJob) {
		t.Fatalf("expected raw URL to be rejected, got %v", err)
	}
	if _, err := service.Resolve(ctx, available, []string{PhotoID("bad.svg")}, ""); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("expected svg to be rejected, got %v", err)
	}
	many := make([]string, MaxPhotos+1)
	for i := range many {
		many[i] = PhotoID(string(rune('a'+i)) + ".jpg")
	}
	if _, err := service.Resolve(ctx, available, many, ""); !errors.Is(err, ErrTooManyPhotos) {
		t.Fatalf("expected too many photos, got %v", err)
	}

	service.maxTotalBytes = len(attachments[0].Data) + 10
	if _, err := service.Resolve(ctx, available, []string{PhotoID("a.jpg"), PhotoID("b.jpg")}, ""); !errors.Is(err, ErrPhotosTooLarge) {
		t.Fatalf("expected over-limit rejection, got %v", err)
	}
}

func TestListReportsSendSizeAndCaches(t *testing.T) {
	store := &fakeStore{objects: map[string][]byte{
		"a.jpg":   noisyJPEG(t, 2400, 1800, 3),
		"bad.svg": []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`),
	}}
	service := NewService(store)
	photos := Collect(store, []Source{{Markdown: "managed:a.jpg managed:bad.svg managed:missing.jpg"}})
	infos := service.List(context.Background(), photos)
	if !infos[0].Supported || infos[0].Width != 1600 || infos[0].SendBytes <= 0 || infos[0].SendBytes >= infos[0].OriginalBytes {
		t.Fatalf("unexpected info: %+v", infos[0])
	}
	if !strings.HasPrefix(infos[0].URL, "data:image/jpeg;base64,") || len(infos[0].URL) > 80_000 {
		t.Fatalf("expected a small inline thumbnail, got %d chars", len(infos[0].URL))
	}
	if infos[1].Supported || !strings.Contains(infos[1].Reason, "SVG") || !strings.HasPrefix(infos[1].URL, "https://storage.example/") {
		t.Fatalf("expected svg unsupported: %+v", infos[1])
	}
	if infos[2].Supported || infos[2].Reason == "" {
		t.Fatalf("expected missing photo to be reported: %+v", infos[2])
	}
	readsBefore := store.reads.Load()
	attachments, err := service.Resolve(context.Background(), photos, []string{photos[0].ID}, "")
	if err != nil || len(attachments[0].Data) != infos[0].SendBytes {
		t.Fatalf("attached size must equal listed size: %v %d vs %d", err, len(attachments[0].Data), infos[0].SendBytes)
	}
	if store.reads.Load() != readsBefore {
		t.Fatal("expected cached shrink result to be reused")
	}
}
