package acc

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
)

type Collector struct {
	Reader   Reader
	Interval time.Duration
	SourceID string
}

func (c Collector) Run(ctx context.Context, output chan<- session.Event) error {
	if c.Reader == nil {
		return errors.New("ACC reader is required")
	}
	defer c.Reader.Close()
	interval := c.Interval
	if interval <= 0 {
		interval = 50 * time.Millisecond
	}
	sourceID := c.SourceID
	if sourceID == "" {
		sourceID = "acc-shared-memory"
	}
	var seq uint64
	var started bool
	var completedLaps int32
	var startedAt time.Time
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			snapshot, err := c.Reader.Read(ctx)
			if err != nil {
				return err
			}
			if !started && snapshot.Status != 0 && snapshot.Track != "" && snapshot.Car != "" {
				started = true
				startedAt = snapshot.At
				seq++
				if !send(ctx, output, session.Event{
					SourceID: sourceID, Sequence: seq, Type: session.EventStarted, At: snapshot.At,
					Game: model.GameACC, Protocol: "shared-memory", Track: snapshot.Track,
					Car: snapshot.Car, Driver: snapshot.Driver,
				}) {
					return nil
				}
			}
			if !started {
				continue
			}
			sessionTime := snapshot.At.Sub(startedAt)
			if snapshot.Status == 0 {
				seq++
				send(ctx, output, session.Event{
					SourceID: sourceID, Sequence: seq, Type: session.EventEnded,
					At: snapshot.At, SessionTime: sessionTime,
				})
				return nil
			}
			seq++
			sample := snapshot.Telemetry()
			sample.SessionTime = sessionTime
			if !send(ctx, output, session.Event{
				SourceID: sourceID, Sequence: seq, Type: session.EventTelemetry, At: snapshot.At,
				SessionTime: sessionTime, Telemetry: &sample,
			}) {
				return nil
			}
			if snapshot.CompletedLaps > completedLaps && snapshot.LastLapMS > 0 {
				completedLaps = snapshot.CompletedLaps
				seq++
				lap := model.Lap{
					Number: int(completedLaps), Time: durationFromMS(snapshot.LastLapMS),
					Position: int(snapshot.Position), Valid: true, Completed: snapshot.At,
				}
				if !send(ctx, output, session.Event{
					SourceID: sourceID, Sequence: seq, Type: session.EventLapCompleted,
					At: snapshot.At, SessionTime: sessionTime, Lap: &lap,
				}) {
					return nil
				}
			}
		}
	}
}

func send(ctx context.Context, output chan<- session.Event, event session.Event) bool {
	select {
	case output <- event:
		return true
	case <-ctx.Done():
		return false
	}
}

type FixtureReader struct {
	Snapshots []Snapshot
	index     int
}

func (f *FixtureReader) Read(context.Context) (Snapshot, error) {
	if f.index >= len(f.Snapshots) {
		return Snapshot{}, fmt.Errorf("fixture exhausted after %d snapshots", f.index)
	}
	value := f.Snapshots[f.index]
	f.index++
	return value, nil
}

func (f *FixtureReader) Close() error { return nil }
