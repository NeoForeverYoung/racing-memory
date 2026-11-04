// Package app coordinates telemetry, replay capture, reports, and media jobs.
package app

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/media"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/report"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/store"
)

type ReplaySaver interface {
	EnsureReplayBuffer(context.Context) error
	SaveReplayBuffer(context.Context) (string, error)
}

type Config struct {
	VideoInput     string
	RejectExisting bool
}

type Engine struct {
	store      *store.Store
	assembler  *session.Assembler
	replay     ReplaySaver
	reporter   report.Renderer
	media      media.Pipeline
	cfg        Config
	mu         sync.Mutex
	captured   int
	hasSession bool
}

func NewEngine(repository *store.Store, replay ReplaySaver, pipeline media.Pipeline, cfg Config) *Engine {
	return &Engine{
		store: repository, assembler: newAssembler(""), replay: replay,
		reporter: report.Renderer{}, media: pipeline, cfg: cfg,
	}
}

func (e *Engine) Handle(ctx context.Context, event session.Event) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	current := e.assembler.Snapshot()
	if event.Type == session.EventStarted && (!e.hasSession || current.State != model.StateRunning) {
		id := ""
		if e.cfg.RejectExisting && event.ExternalID != "" {
			id = SessionID(event.ExternalID)
			if _, err := e.store.Load(id); err == nil {
				return fmt.Errorf("session %s was already imported", event.ExternalID)
			}
		}
		e.assembler = newAssembler(id)
		e.hasSession = true
		e.captured = 0
		current = e.assembler.Snapshot()
	}
	if err := e.store.AppendEvent(current.ID, event); err != nil {
		return err
	}
	changed, err := e.assembler.Apply(event)
	if err != nil || !changed {
		return err
	}
	value := e.assembler.Snapshot()
	if e.replay != nil && len(value.Highlights) > e.captured {
		for i := e.captured; i < len(value.Highlights); i++ {
			path, captureErr := e.replay.SaveReplayBuffer(ctx)
			if captureErr != nil {
				e.assembler.AddWarning("OBS replay capture failed: " + captureErr.Error())
				continue
			}
			if err := e.assembler.SetHighlightSource(i, path); err != nil {
				return err
			}
		}
		e.captured = len(value.Highlights)
		value = e.assembler.Snapshot()
	}
	if value.State == model.StateCompleted {
		return e.generate(ctx, value)
	}
	return e.store.Save(value)
}

func newAssembler(id string) *session.Assembler {
	if id == "" {
		id = fmt.Sprintf("race-%s", time.Now().UTC().Format("20060102T150405.000000000Z"))
	}
	return session.New(id)
}

func SessionID(externalID string) string {
	var clean strings.Builder
	for _, char := range externalID {
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_' {
			clean.WriteRune(char)
		}
	}
	if clean.Len() == 0 {
		return "iracing-import"
	}
	return "iracing-" + clean.String()
}

func (e *Engine) generate(ctx context.Context, value model.Session) error {
	dir, err := e.store.SessionDir(value.ID)
	if err != nil {
		return err
	}
	artifactDir := filepath.Join(dir, "artifacts")
	reportArtifacts, err := e.reporter.Generate(value, artifactDir)
	if err != nil {
		value.Artifacts = model.ArtifactSet{Status: "failed", Error: err.Error()}
		_ = e.store.Save(value)
		return err
	}
	value.Artifacts = reportArtifacts
	mediaArtifacts, err := e.media.Generate(ctx, e.cfg.VideoInput, value, artifactDir)
	if err != nil {
		value.Artifacts.Status = "partial"
		value.Artifacts.Error = err.Error()
		return e.store.Save(value)
	}
	value.Artifacts.Status = "ready"
	value.Artifacts.Video = mediaArtifacts.Video
	value.Artifacts.Images = mediaArtifacts.Images
	return e.store.Save(value)
}

func (e *Engine) Run(ctx context.Context, events <-chan session.Event) error {
	if e.store == nil {
		return errors.New("store is required")
	}
	if e.replay != nil {
		if err := e.replay.EnsureReplayBuffer(ctx); err != nil {
			return err
		}
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case event, ok := <-events:
			if !ok {
				return nil
			}
			if err := e.Handle(ctx, event); err != nil {
				return err
			}
		}
	}
}
