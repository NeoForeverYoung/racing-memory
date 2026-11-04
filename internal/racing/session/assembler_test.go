package session

import (
	"testing"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
)

func TestAssemblerBuildsLapsAndHighlights(t *testing.T) {
	now := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	a := New("race-test")
	events := []Event{
		{SourceID: "fixture", Sequence: 1, Type: EventStarted, At: now, Game: model.GameF1, Protocol: "2026.1", Track: "Spa", Car: "McLaren"},
		{SourceID: "fixture", Sequence: 2, Type: EventTelemetry, At: now.Add(time.Minute), SessionTime: time.Minute, Telemetry: &model.TelemetrySample{Lap: 1, Position: 5}},
		{SourceID: "fixture", Sequence: 3, Type: EventTelemetry, At: now.Add(70 * time.Second), SessionTime: 70 * time.Second, Telemetry: &model.TelemetrySample{Lap: 1, Position: 4}},
		{SourceID: "fixture", Sequence: 4, Type: EventLapCompleted, At: now.Add(90 * time.Second), SessionTime: 90 * time.Second, Lap: &model.Lap{Number: 1, Time: 90 * time.Second, Position: 4, Valid: true}},
		{SourceID: "fixture", Sequence: 5, Type: EventEnded, At: now.Add(2 * time.Minute), SessionTime: 2 * time.Minute},
	}
	for _, event := range events {
		if changed, err := a.Apply(event); err != nil || !changed {
			t.Fatalf("Apply(%s) = %v, %v", event.Type, changed, err)
		}
	}
	got := a.Snapshot()
	if got.State != model.StateCompleted || len(got.Laps) != 1 {
		t.Fatalf("unexpected session: %+v", got)
	}
	if len(got.Highlights) != 3 {
		t.Fatalf("highlights = %d, want overtake + best lap + finish", len(got.Highlights))
	}
	changed, err := a.Apply(events[len(events)-1])
	if err != nil || changed {
		t.Fatalf("closed duplicate = %v, %v; want ignored", changed, err)
	}
}
