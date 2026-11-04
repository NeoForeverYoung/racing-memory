package iracing

import (
	"fmt"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/collector/iracing/wire"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
)

type Projector struct {
	SourceID        string
	Protocol        string
	Sequence        uint64
	Started         bool
	SessionNum      int
	SessionUnique   int64
	LastCompleted   int
	LastSessionTime time.Duration
	LastEmittedTime time.Duration
	Metadata        Metadata
}

func NewProjector(sourceID string) *Projector {
	return &Projector{SourceID: sourceID, Protocol: "irsdk-v2"}
}

func (p *Projector) Process(frame wire.Frame, info SessionInfo, at time.Time) ([]session.Event, error) {
	sessionNum := intValue(frame, "SessionNum")
	unique := int64Value(frame, "SessionUniqueID")
	sessionTime := secondsDuration(floatValue(frame, "SessionTime"))
	meta := info.Metadata(sessionNum)
	if info.WeekendInfo.SubSessionID == 0 && unique != 0 {
		meta.ExternalID = fmt.Sprintf("%d-%d", unique, sessionNum)
	}
	if meta.Car == "" {
		return nil, fmt.Errorf("iRacing player car is missing from SessionInfo")
	}
	var events []session.Event
	if p.Started && (sessionNum != p.SessionNum || (unique != 0 && unique != p.SessionUnique) || sessionTime < p.LastSessionTime) {
		events = append(events, p.endEvent(at, p.LastSessionTime, model.StateAborted, info)...)
		p.Started = false
		p.LastCompleted = 0
		p.LastEmittedTime = 0
	}
	if !p.Started {
		p.Started = true
		p.SessionNum, p.SessionUnique, p.Metadata = sessionNum, unique, meta
		p.Sequence++
		events = append(events, session.Event{
			SourceID: p.SourceID, Sequence: p.Sequence, Type: session.EventStarted, At: at,
			Game: model.GameIRacing, Protocol: p.Protocol, ExternalID: meta.ExternalID,
			WeekendID: meta.WeekendID, SessionKind: meta.SessionKind, Track: meta.Track,
			Car: meta.Car, Driver: meta.Driver, CarNumber: meta.CarNumber, CarClass: meta.CarClass,
		})
	}

	playerIdx := intValue(frame, "PlayerCarIdx")
	completed := intValue(frame, "LapCompleted")
	position := firstPositive(intValue(frame, "PlayerCarPosition"), arrayInt(frame, "CarIdxPosition", playerIdx))
	classPosition := firstPositive(intValue(frame, "PlayerCarClassPosition"), arrayInt(frame, "CarIdxClassPosition", playerIdx))
	sample := model.TelemetrySample{
		At: at, SessionTime: sessionTime, SpeedKPH: floatValue(frame, "Speed") * 3.6,
		RPM: intValue(frame, "RPM"), Gear: intValue(frame, "Gear"),
		Throttle: floatValue(frame, "Throttle"), Brake: floatValue(frame, "Brake"),
		Steering: floatValue(frame, "SteeringWheelAngle"), FuelLevel: floatValue(frame, "FuelLevel"),
		Lap: completed + 1, Position: position, ClassPosition: classPosition,
		IncidentCount: intValue(frame, "PlayerCarMyIncidentCount"), OnPitRoad: boolValue(frame, "OnPitRoad"),
	}
	if p.LastEmittedTime == 0 || sessionTime-p.LastEmittedTime >= 100*time.Millisecond {
		p.Sequence++
		events = append(events, session.Event{
			SourceID: p.SourceID, Sequence: p.Sequence, Type: session.EventTelemetry,
			At: at, SessionTime: sessionTime, Telemetry: &sample,
		})
		p.LastEmittedTime = sessionTime
	}
	if completed > p.LastCompleted {
		lastLap := secondsDuration(floatValue(frame, "LapLastLapTime"))
		if lastLap > 0 {
			p.Sequence++
			lap := model.Lap{
				Number: completed, Time: lastLap, Position: position, Valid: true, Completed: at,
			}
			events = append(events, session.Event{
				SourceID: p.SourceID, Sequence: p.Sequence, Type: session.EventLapCompleted,
				At: at, SessionTime: sessionTime, Lap: &lap,
			})
		}
		p.LastCompleted = completed
	}
	p.LastSessionTime = sessionTime
	return events, nil
}

func (p *Projector) End(at time.Time, info SessionInfo, completed bool) []session.Event {
	state := model.StateAborted
	if completed {
		state = model.StateCompleted
	}
	return p.endEvent(at, p.LastSessionTime, state, info)
}

func (p *Projector) endEvent(at time.Time, sessionTime time.Duration, state model.SessionState, info SessionInfo) []session.Event {
	if !p.Started {
		return nil
	}
	meta := info.Metadata(p.SessionNum)
	var events []session.Event
	if len(meta.Classification) > 0 {
		p.Sequence++
		events = append(events, session.Event{
			SourceID: p.SourceID, Sequence: p.Sequence, Type: session.EventClassification,
			At: at, SessionTime: sessionTime, Classification: meta.Classification,
		})
	}
	p.Sequence++
	events = append(events, session.Event{
		SourceID: p.SourceID, Sequence: p.Sequence, Type: session.EventEnded,
		At: at, SessionTime: sessionTime, EndState: state,
	})
	p.Started = false
	return events
}

func intValue(frame wire.Frame, name string) int {
	if value, ok := frame.Int(name); ok {
		return int(value)
	}
	if value, ok := frame.Float(name); ok {
		return int(value)
	}
	return 0
}

func int64Value(frame wire.Frame, name string) int64 {
	value, _ := frame.Int(name)
	return value
}

func floatValue(frame wire.Frame, name string) float64 {
	value, _ := frame.Float(name)
	return value
}

func boolValue(frame wire.Frame, name string) bool {
	value, _ := frame.Bool(name)
	return value
}

func arrayInt(frame wire.Frame, name string, index int) int {
	value, _ := frame.IntAt(name, index)
	return int(value)
}

func secondsDuration(value float64) time.Duration {
	if value <= 0 {
		return 0
	}
	return time.Duration(value * float64(time.Second))
}

func firstPositive(values ...int) int {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}
