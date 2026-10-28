package emailphotos

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"path"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

var (
	ErrPhotoNotOnJob   = errors.New("one or more photos do not belong to this job")
	ErrTooManyPhotos   = fmt.Errorf("you can attach up to %d photos", MaxPhotos)
	ErrPhotosTooLarge  = fmt.Errorf("selected photos are larger than the %d MB email limit", MaxTotalBytes/1_000_000)
	ErrStorageDisabled = errors.New("photo storage is not configured")
)

// Store is the object storage the photos live in (the uploads module).
type Store interface {
	Enabled() bool
	ManagedImageKeys(markdown string) []string
	GetObjectBytes(ctx context.Context, key string) ([]byte, string, error)
	PresignedGetURL(key string, expires time.Duration) (string, error)
}

// Source is one block of work-order text that may contain photos.
type Source struct {
	Label    string
	Markdown string
}

// Photo is a photo found on a work order. ID is derived from the storage key,
// so the client only ever sends back IDs, never URLs.
type Photo struct {
	ID     string
	Key    string
	Name   string
	Source string
}

// PhotoID returns the stable, opaque id for a storage key.
func PhotoID(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:12])
}

// Collect lists the photos stored for a work order, in order of appearance,
// without duplicates. Only images stored in the app's own bucket are included.
func Collect(store Store, sources []Source) []Photo {
	if store == nil || !store.Enabled() {
		return nil
	}
	seen := make(map[string]struct{})
	photos := make([]Photo, 0, 8)
	for _, source := range sources {
		for _, key := range store.ManagedImageKeys(source.Markdown) {
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}
			photos = append(photos, Photo{ID: PhotoID(key), Key: key, Name: path.Base(key), Source: source.Label})
		}
	}
	return photos
}

// Info is what the email dialog shows for one photo.
type Info struct {
	Photo
	URL           string
	OriginalBytes int
	SendBytes     int
	OriginalType  string
	Width         int
	Height        int
	Supported     bool
	Reason        string
}

type cacheEntry struct {
	prepared Prepared
	err      error
	expires  time.Time
}

// Service shrinks photos once and keeps the result for a while so the size the
// dialog shows is exactly the size that gets attached.
type Service struct {
	store         Store
	ttl           time.Duration
	maxBytes      int
	maxTotalBytes int

	mu    sync.Mutex
	cache map[string]cacheEntry
	group singleflight.Group
}

func NewService(store Store) *Service {
	return &Service{store: store, ttl: 30 * time.Minute, maxBytes: 200_000_000, maxTotalBytes: MaxTotalBytes, cache: make(map[string]cacheEntry)}
}

func (s *Service) Store() Store { return s.store }

// Prepare returns the shrunken photo for a storage key (cached).
func (s *Service) Prepare(ctx context.Context, photo Photo) (Prepared, error) {
	now := time.Now()
	s.mu.Lock()
	if entry, ok := s.cache[photo.Key]; ok && now.Before(entry.expires) {
		s.mu.Unlock()
		return entry.prepared, entry.err
	}
	s.mu.Unlock()

	value, err, _ := s.group.Do(photo.Key, func() (any, error) {
		data, _, err := s.store.GetObjectBytes(ctx, photo.Key)
		if err != nil {
			return Prepared{}, fmt.Errorf("read photo: %w", err) // not cached: storage errors are retried
		}
		prepared, shrinkErr := Shrink(data, photo.Name)
		if shrinkErr != nil {
			prepared = Prepared{OriginalBytes: len(data), OriginalType: DetectType(data)}
		}
		s.remember(photo.Key, cacheEntry{prepared: prepared, err: shrinkErr, expires: time.Now().Add(s.ttl)})
		return prepared, shrinkErr
	})
	prepared, _ := value.(Prepared)
	return prepared, err
}

func (s *Service) remember(key string, entry cacheEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache[key] = entry
	total := 0
	for k, e := range s.cache {
		if time.Now().After(e.expires) {
			delete(s.cache, k)
			continue
		}
		total += len(e.prepared.Data)
	}
	// Simple bound on memory: drop the oldest entries until under the cap.
	for total > s.maxBytes && len(s.cache) > 1 {
		var oldestKey string
		var oldest time.Time
		for k, e := range s.cache {
			if k == key {
				continue
			}
			if oldestKey == "" || e.expires.Before(oldest) {
				oldestKey, oldest = k, e.expires
			}
		}
		if oldestKey == "" {
			break
		}
		total -= len(s.cache[oldestKey].prepared.Data)
		delete(s.cache, oldestKey)
	}
}

// List returns every photo on the work order with its real send size.
func (s *Service) List(ctx context.Context, photos []Photo) []Info {
	infos := make([]Info, len(photos))
	var wg sync.WaitGroup
	limit := make(chan struct{}, 4)
	for i, photo := range photos {
		wg.Add(1)
		go func(i int, photo Photo) {
			defer wg.Done()
			limit <- struct{}{}
			defer func() { <-limit }()
			info := Info{Photo: photo}
			prepared, err := s.Prepare(ctx, photo)
			if len(prepared.Thumbnail) > 0 {
				info.URL = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(prepared.Thumbnail)
			} else if url, urlErr := s.store.PresignedGetURL(photo.Key, time.Hour); urlErr == nil {
				info.URL = url
			}
			info.OriginalBytes = prepared.OriginalBytes
			info.OriginalType = prepared.OriginalType
			switch {
			case err == nil:
				info.Supported = true
				info.SendBytes = len(prepared.Data)
				info.Width, info.Height = prepared.Width, prepared.Height
			case errors.Is(err, ErrUnsupported):
				info.Reason = err.Error()
			default:
				info.Reason = "This photo could not be loaded"
			}
			infos[i] = info
		}(i, photo)
	}
	wg.Wait()
	return infos
}

// Attachment is a validated, shrunken photo ready to attach.
type Attachment struct {
	Name        string
	ContentType string
	Data        []byte
}

// Resolve validates the photo ids picked in the dialog against the photos
// that really belong to the work order and returns the attachments to send.
// Attachments are named "<namePrefix>-photo-<n>.jpg" in the order selected.
func (s *Service) Resolve(ctx context.Context, available []Photo, ids []string, namePrefix string) ([]Attachment, error) {
	unique := make([]string, 0, len(ids))
	seen := make(map[string]struct{})
	for _, raw := range ids {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return nil, nil
	}
	if len(unique) > MaxPhotos {
		return nil, ErrTooManyPhotos
	}
	byID := make(map[string]Photo, len(available))
	for _, photo := range available {
		byID[photo.ID] = photo
	}
	selected := make([]Photo, 0, len(unique))
	for _, id := range unique {
		photo, ok := byID[id]
		if !ok {
			return nil, ErrPhotoNotOnJob
		}
		selected = append(selected, photo)
	}
	if s.store == nil || !s.store.Enabled() {
		return nil, ErrStorageDisabled
	}

	attachments := make([]Attachment, 0, len(selected))
	total := 0
	for index, photo := range selected {
		prepared, err := s.Prepare(ctx, photo)
		if err != nil {
			if errors.Is(err, ErrUnsupported) {
				return nil, fmt.Errorf("%s: %w", photo.Name, err)
			}
			return nil, err
		}
		total += len(prepared.Data)
		if total > s.maxTotalBytes {
			return nil, ErrPhotosTooLarge
		}
		name := fmt.Sprintf("photo-%d.jpg", index+1)
		if prefix := strings.TrimSpace(namePrefix); prefix != "" {
			name = prefix + "-" + name
		}
		attachments = append(attachments, Attachment{Name: name, ContentType: prepared.ContentType, Data: prepared.Data})
	}
	return attachments, nil
}
