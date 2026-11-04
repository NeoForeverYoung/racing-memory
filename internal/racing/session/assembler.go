// Package session assembles lossy game telemetry into durable race sessions.
package session

import (
	"errors"
	"fmt"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
)

type EventType string

const (
	EventStarted        EventType = "session_started"
	EventTelemetry      EventType = "telemetry"
	EventLapCompleted   EventType = "lap_completed"
	EventClassification EventType = "classification"
	EventEnded          EventType = "session_ended"
)

type Event struct {
	SourceID       string                 `json:"source_id"`
	Sequence       uint64                 `json:"sequence"`
	Type           EventType              `json:"type"`
	At             time.Time              `json:"at"`
	SessionTime    time.Duration          `json:"session_time,omitempty"`
	Game           model.Game             `json:"game,omitempty"`
	Protocol       string                 `json:"protocol,omitempty"`
	ExternalID     string                 `json:"external_id,omitempty"`
	WeekendID      string                 `json:"weekend_id,omitempty"`
	SessionKind    string                 `json:"session_kind,omitempty"`
	Track          string                 `json:"track,omitempty"`
	Car            string                 `json:"car,omitempty"`
	CarNumber      string                 `json:"car_number,omitempty"`
	CarClass       string                 `json:"car_class,omitempty"`
	Driver         string                 `json:"driver,omitempty"`
	EndState       model.SessionState     `json:"end_state,omitempty"`
	Lap            *model.Lap             `json:"lap,omitempty"`
	Telemetry      *model.TelemetrySample `json:"telemetry,omitempty"`
	Classification []model.Standing       `json:"classification,omitempty"`
}

type Assembler struct {
	value         model.Session
	lastBySource  map[string]uint64
	bestLap       time.Duration
	lastPosition  int
	lastIncidents int
	lastOnPitRoad bool
}

func New(id string) *Assembler {
	return &Assembler{
		value:        model.Session{ID: id, State: model.StateRunning, ResultSource: model.SourceDerived},
		lastBySource: make(map[string]uint64),
	}
}

func (a *Assembler) Apply(event Event) (bool, error) {
	if event.SourceID == "" || event.Sequence == 0 {
		return false, errors.New("source_id and positive sequence are required")
	}
	if event.Sequence <= a.lastBySource[event.SourceID] {
		return false, nil
	}
	if a.value.State != model.StateRunning && event.Type != EventClassification {
		return false, errors.New("session is already closed")
	}

	switch event.Type {
	case EventStarted:
		if event.Game == "" || event.Track == "" || event.Car == "" || event.At.IsZero() {
			return false, errors.New("session start requires game, track, car and time")
		}
		a.value.Game = event.Game
		a.value.ProtocolVersion = event.Protocol
		a.value.ExternalID = event.ExternalID
		a.value.WeekendID = event.WeekendID
		a.value.SessionKind = event.SessionKind
		a.value.Track = event.Track
		a.value.Car = event.Car
		a.value.CarNumber = event.CarNumber
		a.value.CarClass = event.CarClass
		a.value.Driver = event.Driver
		a.value.StartedAt = event.At
	case EventTelemetry:
		if event.Telemetry == nil {
			return false, errors.New("telemetry payload is required")
		}
		a.value.CurrentLap = event.Telemetry.Lap
		a.value.Position = event.Telemetry.Position
		a.value.ClassPosition = event.Telemetry.ClassPosition
		a.value.Incidents = event.Telemetry.IncidentCount
		if a.lastPosition > 0 && event.Telemetry.Position > 0 && event.Telemetry.Position < a.lastPosition &&
			!event.Telemetry.OnPitRoad && !a.lastOnPitRoad && a.lastPosition-event.Telemetry.Position <= 4 {
			a.addHighlight(model.HighlightOvertake, event.SessionTime, 80, "超越对手")
		}
		if event.Telemetry.IncidentCount > a.lastIncidents {
			a.addHighlight(model.HighlightIncident, event.SessionTime, 60, "赛道事故")
		}
		if event.Telemetry.Position > 0 {
			a.lastPosition = event.Telemetry.Position
		}
		a.lastIncidents = event.Telemetry.IncidentCount
		a.lastOnPitRoad = event.Telemetry.OnPitRoad
	case EventLapCompleted:
		if event.Lap == nil || event.Lap.Number <= 0 || event.Lap.Time <= 0 {
			return false, errors.New("valid lap payload is required")
		}
		if len(a.value.Laps) > 0 && event.Lap.Number <= a.value.Laps[len(a.value.Laps)-1].Number {
			return false, nil
		}
		a.value.Laps = append(a.value.Laps, *event.Lap)
		a.value.CurrentLap = event.Lap.Number
		if event.Lap.Valid && (a.bestLap == 0 || event.Lap.Time < a.bestLap) {
			a.bestLap = event.Lap.Time
			a.addHighlight(model.HighlightBestLap, event.SessionTime, 100, fmt.Sprintf("最佳圈 %s", formatLap(event.Lap.Time)))
		}
	case EventClassification:
		if len(event.Classification) == 0 {
			return false, errors.New("classification is empty")
		}
		a.value.Classification = append([]model.Standing(nil), event.Classification...)
		a.value.ResultSource = model.SourceOfficial
		for _, standing := range event.Classification {
			if standing.Driver == a.value.Driver {
				a.value.Position = standing.Position
				a.value.ClassPosition = standing.ClassPosition
				break
			}
		}
	case EventEnded:
		ended := event.At
		if ended.IsZero() {
			ended = time.Now().UTC()
		}
		a.value.EndedAt = &ended
		a.value.State = event.EndState
		if a.value.State == "" {
			a.value.State = model.StateCompleted
		}
		if a.value.State == model.StateCompleted {
			a.addHighlight(model.HighlightFinish, event.SessionTime, 90, "冲线")
		}
	default:
		return false, fmt.Errorf("unsupported event type %q", event.Type)
	}
	a.lastBySource[event.SourceID] = event.Sequence
	return true, nil
}

func (a *Assembler) Snapshot() model.Session {
	out := a.value
	out.Laps = append([]model.Lap(nil), a.value.Laps...)
	out.Highlights = append([]model.Highlight(nil), a.value.Highlights...)
	out.Classification = append([]model.Standing(nil), a.value.Classification...)
	return out
}

func (a *Assembler) SetHighlightSource(index int, path string) error {
	if index < 0 || index >= len(a.value.Highlights) {
		return errors.New("highlight index out of range")
	}
	a.value.Highlights[index].SourceClip = path
	return nil
}

func (a *Assembler) AddWarning(message string) {
	a.value.Warnings = append(a.value.Warnings, message)
}

func (a *Assembler) addHighlight(kind model.HighlightKind, at time.Duration, score int, title string) {
	start := at - 12*time.Second
	if start < 0 {
		start = 0
	}
	a.value.Highlights = append(a.value.Highlights, model.Highlight{
		ID:   fmt.Sprintf("%s-%d-%d", kind, len(a.value.Highlights)+1, at.Milliseconds()),
		Kind: kind, At: at, WindowStart: start, WindowEnd: at + 5*time.Second, Score: score, Title: title,
	})
}

func formatLap(d time.Duration) string {
	minutes := int(d.Minutes())
	seconds := d - time.Duration(minutes)*time.Minute
	return fmt.Sprintf("%d:%06.3f", minutes, seconds.Seconds())
}
