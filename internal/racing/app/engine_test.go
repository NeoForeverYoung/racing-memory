package app

import (
	"context"
	"testing"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/media"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/store"
)

func TestEngineUsesExternalIDAndRejectsDuplicateImport(t *testing.T) {
	repository, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	engine := NewEngine(repository, nil, media.Pipeline{}, Config{RejectExisting: true})
	now := time.Now().UTC()
	start := session.Event{
		SourceID: "ibt", Sequence: 1, Type: session.EventStarted, At: now,
		Game: model.GameIRacing, Protocol: "irsdk-v2", ExternalID: "200-0",
		Track: "Okayama", Car: "MX-5 Cup", Driver: "Local Driver",
	}
	if err := engine.Handle(context.Background(), start); err != nil {
		t.Fatal(err)
	}
	if err := engine.Handle(context.Background(), session.Event{
		SourceID: "ibt", Sequence: 2, Type: session.EventEnded, At: now.Add(time.Minute),
		SessionTime: time.Minute,
	}); err != nil {
		t.Fatal(err)
	}
	got, err := repository.Load("iracing-200-0")
	if err != nil {
		t.Fatal(err)
	}
	if got.Game != model.GameIRacing || got.ExternalID != "200-0" {
		t.Fatalf("unexpected imported session: %+v", got)
	}
	again := NewEngine(repository, nil, media.Pipeline{}, Config{RejectExisting: true})
	if err := again.Handle(context.Background(), start); err == nil {
		t.Fatal("expected duplicate import error")
	}
}
