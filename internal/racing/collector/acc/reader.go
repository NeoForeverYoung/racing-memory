// Package acc reads the official Assetto Corsa Competizione shared-memory pages.
package acc

import (
	"context"
	"strings"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
)

type Snapshot struct {
	At            time.Time
	PacketID      int32
	Status        int32
	Session       int32
	CompletedLaps int32
	Position      int32
	CurrentLapMS  int32
	LastLapMS     int32
	BestLapMS     int32
	SessionTime   time.Duration
	SpeedKPH      float32
	RPM           int32
	Gear          int32
	Throttle      float32
	Brake         float32
	Car           string
	Track         string
	Driver        string
}

type Reader interface {
	Read(context.Context) (Snapshot, error)
	Close() error
}

func (s Snapshot) Telemetry() model.TelemetrySample {
	return model.TelemetrySample{
		At: s.At, SessionTime: s.SessionTime, SpeedKPH: float64(s.SpeedKPH),
		RPM: int(s.RPM), Gear: int(s.Gear), Throttle: float64(s.Throttle),
		Brake: float64(s.Brake), Lap: int(s.CompletedLaps + 1), Position: int(s.Position),
	}
}

func nowUTC() time.Time { return time.Now().UTC() }

func durationFromMS(value int32) time.Duration {
	return time.Duration(value) * time.Millisecond
}

func joinName(first, last string) string {
	return strings.TrimSpace(first + " " + last)
}
