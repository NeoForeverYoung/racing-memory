package store

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
)

func TestStoreRoundTripAndVerifyEvents(t *testing.T) {
	repository, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	event := session.Event{
		SourceID: "test", Sequence: 1, Type: session.EventStarted, At: time.Now().UTC(),
		Game: model.GameACC, Track: "Monza", Car: "GT3",
	}
	if err := repository.AppendEvent("race-1", event); err != nil {
		t.Fatal(err)
	}
	value := model.Session{ID: "race-1", Game: model.GameACC, Track: "Monza", Car: "GT3", StartedAt: event.At}
	if err := repository.Save(value); err != nil {
		t.Fatal(err)
	}
	got, err := repository.Load(value.ID)
	if err != nil || got.Track != value.Track {
		t.Fatalf("Load = %+v, %v", got, err)
	}
	dir, _ := repository.SessionDir(value.ID)
	if err := VerifyEvents(filepath.Join(dir, "events.ndjson")); err != nil {
		t.Fatal(err)
	}
}

func TestStoreRejectsTraversal(t *testing.T) {
	repository, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.SessionDir("../escape"); err == nil {
		t.Fatal("expected traversal rejection")
	}
}
