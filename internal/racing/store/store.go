// Package store persists racing events and generated artifacts on local disk.
package store

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
)

type eventRecord struct {
	Sequence uint64          `json:"sequence"`
	Checksum string          `json:"checksum"`
	Event    json.RawMessage `json:"event"`
}

type Store struct {
	root string
	mu   sync.Mutex
	seq  map[string]uint64
}

func New(root string) (*Store, error) {
	if root == "" {
		return nil, errors.New("data directory is required")
	}
	if err := os.MkdirAll(filepath.Join(root, "sessions"), 0o755); err != nil {
		return nil, err
	}
	return &Store{root: root, seq: make(map[string]uint64)}, nil
}

func (s *Store) Root() string { return s.root }

func (s *Store) SessionDir(id string) (string, error) {
	if err := validID(id); err != nil {
		return "", err
	}
	return filepath.Join(s.root, "sessions", id), nil
}

func (s *Store) AppendEvent(id string, event session.Event) error {
	dir, err := s.SessionDir(id)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(event)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(raw)

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	s.seq[id]++
	rec := eventRecord{Sequence: s.seq[id], Checksum: hex.EncodeToString(sum[:]), Event: raw}
	f, err := os.OpenFile(filepath.Join(dir, "events.ndjson"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := json.NewEncoder(f).Encode(rec); err != nil {
		return err
	}
	return f.Sync()
}

func (s *Store) Save(value model.Session) error {
	dir, err := s.SessionDir(value.ID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return atomicWrite(filepath.Join(dir, "session.json"), append(raw, '\n'))
}

func (s *Store) Load(id string) (model.Session, error) {
	dir, err := s.SessionDir(id)
	if err != nil {
		return model.Session{}, err
	}
	raw, err := os.ReadFile(filepath.Join(dir, "session.json"))
	if err != nil {
		return model.Session{}, err
	}
	var value model.Session
	if err := json.Unmarshal(raw, &value); err != nil {
		return model.Session{}, err
	}
	return value, nil
}

func (s *Store) List() ([]model.Session, error) {
	root := filepath.Join(s.root, "sessions")
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	out := make([]model.Session, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		value, err := s.Load(entry.Name())
		if err == nil {
			out = append(out, value)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.After(out[j].StartedAt) })
	return out, nil
}

func VerifyEvents(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	scan := bufio.NewScanner(f)
	var expected uint64 = 1
	for scan.Scan() {
		var rec eventRecord
		if err := json.Unmarshal(scan.Bytes(), &rec); err != nil {
			return err
		}
		sum := sha256.Sum256(rec.Event)
		if rec.Sequence != expected || rec.Checksum != hex.EncodeToString(sum[:]) {
			return fmt.Errorf("invalid event record %d", expected)
		}
		expected++
	}
	return scan.Err()
}

func validID(id string) error {
	if id == "" || id == "." || id == ".." || strings.ContainsAny(id, `/\`) {
		return errors.New("invalid session id")
	}
	return nil
}

func atomicWrite(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
