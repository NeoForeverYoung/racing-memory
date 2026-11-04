package iracing

import (
	"context"
	"errors"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/collector/iracing/wire"
)

var (
	ErrNotConnected = errors.New("iRacing telemetry is not connected")
	ErrNoData       = errors.New("iRacing telemetry has no new frame")
)

type Snapshot struct {
	At         time.Time
	Header     wire.Header
	Layout     wire.Layout
	SessionRaw []byte
	Frame      wire.Frame
}

type Reader interface {
	Read(context.Context) (Snapshot, error)
	Close() error
}

type FixtureReader struct {
	Snapshots []Snapshot
	Errors    map[int]error
	index     int
}

func (f *FixtureReader) Read(context.Context) (Snapshot, error) {
	if err := f.Errors[f.index]; err != nil {
		f.index++
		return Snapshot{}, err
	}
	if f.index >= len(f.Snapshots) {
		return Snapshot{}, ErrNotConnected
	}
	value := f.Snapshots[f.index]
	f.index++
	return value, nil
}

func (f *FixtureReader) Close() error { return nil }
