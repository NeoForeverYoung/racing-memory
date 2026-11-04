// Package f1udp decodes the official EA Sports F1 UDP telemetry protocol.
package f1udp

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
)

const HeaderSize = 29

const (
	PacketSession             = 1
	PacketLapData             = 2
	PacketParticipants        = 4
	PacketCarTelemetry        = 6
	PacketSessionHistory      = 11
	PacketFinalClassification = 8
)

type Header struct {
	PacketFormat       uint16
	GameYear           uint8
	GameMajorVersion   uint8
	GameMinorVersion   uint8
	PacketVersion      uint8
	PacketID           uint8
	SessionUID         uint64
	SessionTime        float32
	FrameIdentifier    uint32
	OverallFrameID     uint32
	PlayerCarIndex     uint8
	SecondaryPlayerCar uint8
}

type Decoder struct {
	sourceID   string
	seq        uint64
	started    bool
	track      string
	car        string
	driver     string
	lastLap    int
	lastSample time.Duration
	speedKPH   float64
	rpm        int
	gear       int
	throttle   float64
	brake      float64
}

func NewDecoder(sourceID string) *Decoder { return &Decoder{sourceID: sourceID} }

func ParseHeader(data []byte) (Header, error) {
	if len(data) < HeaderSize {
		return Header{}, errors.New("f1 packet is shorter than header")
	}
	format := binary.LittleEndian.Uint16(data[0:2])
	if format != 2025 && format != 2026 {
		return Header{}, fmt.Errorf("unsupported F1 packet format %d", format)
	}
	return Header{
		PacketFormat: format, GameYear: data[2], GameMajorVersion: data[3],
		GameMinorVersion: data[4], PacketVersion: data[5], PacketID: data[6],
		SessionUID:      binary.LittleEndian.Uint64(data[7:15]),
		SessionTime:     math.Float32frombits(binary.LittleEndian.Uint32(data[15:19])),
		FrameIdentifier: binary.LittleEndian.Uint32(data[19:23]),
		OverallFrameID:  binary.LittleEndian.Uint32(data[23:27]),
		PlayerCarIndex:  data[27], SecondaryPlayerCar: data[28],
	}, nil
}

func (d *Decoder) Decode(data []byte, received time.Time) ([]session.Event, error) {
	h, err := ParseHeader(data)
	if err != nil {
		return nil, err
	}
	protocol := fmt.Sprintf("%d.%d", h.PacketFormat, h.PacketVersion)
	sessionTime := durationSeconds(float64(h.SessionTime))
	var events []session.Event
	switch h.PacketID {
	case PacketSession:
		if len(data) < HeaderSize+8 {
			return nil, errors.New("truncated F1 session packet")
		}
		d.track = trackName(int8(data[HeaderSize+7]))
	case PacketParticipants:
		name, car, err := decodePlayerParticipant(data[HeaderSize:], int(h.PlayerCarIndex))
		if err != nil {
			return nil, err
		}
		d.driver, d.car = name, car
	case PacketCarTelemetry:
		if err := d.decodeCarTelemetry(data[HeaderSize:], int(h.PlayerCarIndex)); err != nil {
			return nil, err
		}
	case PacketLapData:
		lap, position, err := decodePlayerLapData(data[HeaderSize:], int(h.PlayerCarIndex))
		if err != nil {
			return nil, err
		}
		if d.started && (d.lastSample == 0 || sessionTime-d.lastSample >= 100*time.Millisecond) {
			d.lastSample = sessionTime
			d.seq++
			sample := model.TelemetrySample{
				At: received, SessionTime: sessionTime, SpeedKPH: d.speedKPH, RPM: d.rpm,
				Gear: d.gear, Throttle: d.throttle, Brake: d.brake, Lap: lap, Position: position,
			}
			events = append(events, session.Event{
				SourceID: d.sourceID, Sequence: d.seq, Type: session.EventTelemetry,
				At: received, SessionTime: sessionTime, Telemetry: &sample,
			})
		}
	case PacketSessionHistory:
		laps, err := decodeSessionHistory(data[HeaderSize:], h.PlayerCarIndex)
		if err != nil {
			return nil, err
		}
		for _, lap := range laps {
			if lap.Number <= d.lastLap {
				continue
			}
			d.lastLap = lap.Number
			d.seq++
			events = append(events, session.Event{
				SourceID: d.sourceID, Sequence: d.seq, Type: session.EventLapCompleted,
				At: received, SessionTime: sessionTime, Lap: &lap,
			})
		}
	case PacketFinalClassification:
		classification, err := decodeClassification(data[HeaderSize:])
		if err != nil {
			return nil, err
		}
		d.seq++
		events = append(events, session.Event{
			SourceID: d.sourceID, Sequence: d.seq, Type: session.EventClassification,
			At: received, SessionTime: sessionTime, Classification: classification,
		})
		d.seq++
		events = append(events, session.Event{
			SourceID: d.sourceID, Sequence: d.seq, Type: session.EventEnded,
			At: received, SessionTime: sessionTime,
		})
		d.started = false
		d.track, d.car, d.driver = "", "", ""
		d.lastLap = 0
		d.lastSample = 0
	}
	if !d.started && d.track != "" && d.car != "" {
		d.started = true
		d.seq++
		start := session.Event{
			SourceID: d.sourceID, Sequence: d.seq, Type: session.EventStarted, At: received,
			Game: model.GameF1, Protocol: protocol, Track: d.track, Car: d.car, Driver: d.driver,
		}
		events = append([]session.Event{start}, events...)
	}
	return events, nil
}

func decodePlayerLapData(payload []byte, player int) (int, int, error) {
	entrySize, err := arrayEntrySize(len(payload), 2, player, 32)
	if err != nil {
		return 0, 0, fmt.Errorf("lap data: %w", err)
	}
	start := player * entrySize
	entry := payload[start : start+entrySize]
	return int(entry[31]), int(entry[30]), nil
}

func (d *Decoder) decodeCarTelemetry(payload []byte, player int) error {
	entrySize, err := arrayEntrySize(len(payload), 3, player, 19)
	if err != nil {
		return fmt.Errorf("car telemetry: %w", err)
	}
	start := player * entrySize
	entry := payload[start : start+entrySize]
	d.speedKPH = float64(binary.LittleEndian.Uint16(entry[0:2]))
	d.throttle = float64(math.Float32frombits(binary.LittleEndian.Uint32(entry[2:6])))
	d.brake = float64(math.Float32frombits(binary.LittleEndian.Uint32(entry[10:14])))
	d.gear = int(int8(entry[16]))
	d.rpm = int(binary.LittleEndian.Uint16(entry[17:19]))
	return nil
}

func arrayEntrySize(total, trailer, player, minimum int) (int, error) {
	for _, cars := range []int{24, 22} {
		body := total - trailer
		if body > 0 && body%cars == 0 {
			size := body / cars
			if size >= minimum && player < cars {
				return size, nil
			}
		}
	}
	return 0, errors.New("unsupported packet array layout")
}

func decodePlayerParticipant(payload []byte, player int) (string, string, error) {
	if len(payload) < 1 {
		return "", "", errors.New("truncated participants packet")
	}
	const participantSize = 58
	count := int(payload[0])
	if player >= count {
		return "", "", fmt.Errorf("player index %d outside %d participants", player, count)
	}
	start := 1 + player*participantSize
	if len(payload) < start+participantSize {
		return "", "", errors.New("unsupported or truncated participant layout")
	}
	p := payload[start : start+participantSize]
	name := trimCString(p[7:55])
	return name, teamName(p[3]), nil
}

func decodeSessionHistory(payload []byte, player uint8) ([]model.Lap, error) {
	if len(payload) < 7 {
		return nil, errors.New("truncated session history packet")
	}
	if payload[0] != player {
		return nil, nil
	}
	count := int(payload[1])
	const entrySize = 14
	if count > 100 || len(payload) < 7+count*entrySize {
		return nil, errors.New("unsupported or truncated lap history layout")
	}
	out := make([]model.Lap, 0, count)
	for i := 0; i < count; i++ {
		p := payload[7+i*entrySize : 7+(i+1)*entrySize]
		ms := binary.LittleEndian.Uint32(p[0:4])
		if ms == 0 {
			continue
		}
		out = append(out, model.Lap{
			Number: i + 1, Time: time.Duration(ms) * time.Millisecond,
			Sectors: []time.Duration{
				sectorDuration(p[4:7]), sectorDuration(p[7:10]), sectorDuration(p[10:13]),
			},
			Valid: p[13]&1 != 0,
		})
	}
	return out, nil
}

func decodeClassification(payload []byte) ([]model.Standing, error) {
	if len(payload) < 1 {
		return nil, errors.New("truncated classification packet")
	}
	count := int(payload[0])
	const entrySize = 45
	if count > 24 || len(payload) < 1+count*entrySize {
		return nil, errors.New("unsupported or truncated classification layout")
	}
	out := make([]model.Standing, 0, count)
	for i := 0; i < count; i++ {
		p := payload[1+i*entrySize : 1+(i+1)*entrySize]
		best := time.Duration(binary.LittleEndian.Uint32(p[6:10])) * time.Millisecond
		out = append(out, model.Standing{
			Position: int(p[0]), Driver: fmt.Sprintf("car-%d", i+1), Laps: int(p[1]), BestLap: best,
		})
	}
	return out, nil
}

func sectorDuration(p []byte) time.Duration {
	ms := int(binary.LittleEndian.Uint16(p[:2])) + int(p[2])*60_000
	return time.Duration(ms) * time.Millisecond
}

func durationSeconds(v float64) time.Duration { return time.Duration(v * float64(time.Second)) }

func trimCString(value []byte) string {
	for i, b := range value {
		if b == 0 {
			return string(value[:i])
		}
	}
	return string(value)
}

func trackName(id int8) string {
	names := map[int8]string{0: "Melbourne", 3: "Bahrain", 5: "Monaco", 7: "Silverstone", 13: "Spa", 14: "Monza", 15: "Singapore", 26: "Zandvoort", 31: "Las Vegas"}
	if name := names[id]; name != "" {
		return name
	}
	return fmt.Sprintf("track-%d", id)
}

func teamName(id uint8) string {
	names := map[uint8]string{0: "Mercedes", 1: "Ferrari", 2: "Red Bull Racing", 3: "Williams", 4: "Aston Martin", 5: "Alpine", 6: "RB", 7: "Haas", 8: "McLaren", 9: "Sauber"}
	if name := names[id]; name != "" {
		return name
	}
	return fmt.Sprintf("team-%d", id)
}
