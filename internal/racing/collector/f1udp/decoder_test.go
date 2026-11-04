package f1udp

import (
	"encoding/binary"
	"math"
	"testing"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
)

func TestDecoderSessionLapAndClassification(t *testing.T) {
	decoder := NewDecoder("test")
	now := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)

	sessionPacket := packet(PacketSession, 8)
	sessionPacket[HeaderSize+7] = byte(int8(13))
	if events, err := decoder.Decode(sessionPacket, now); err != nil || len(events) != 0 {
		t.Fatalf("session packet = %v, %v", events, err)
	}

	participants := packet(PacketParticipants, 1+58)
	participants[27] = 0
	participants[HeaderSize] = 1
	entry := participants[HeaderSize+1:]
	entry[3] = 8
	copy(entry[7:55], []byte("Driver One"))
	events, err := decoder.Decode(participants, now)
	if err != nil || len(events) != 1 || events[0].Type != session.EventStarted {
		t.Fatalf("participants events = %v, %v", events, err)
	}

	telemetry := packet(PacketCarTelemetry, 60*22+3)
	entry = telemetry[HeaderSize : HeaderSize+60]
	binary.LittleEndian.PutUint16(entry[0:2], 287)
	binary.LittleEndian.PutUint32(entry[2:6], math.Float32bits(0.9))
	binary.LittleEndian.PutUint32(entry[10:14], math.Float32bits(0.1))
	entry[16] = 7
	binary.LittleEndian.PutUint16(entry[17:19], 12_000)
	if events, err := decoder.Decode(telemetry, now); err != nil || len(events) != 0 {
		t.Fatalf("telemetry packet = %v, %v", events, err)
	}
	lapData := packet(PacketLapData, 57*22+2)
	lapData[HeaderSize+30] = 3
	lapData[HeaderSize+31] = 2
	events, err = decoder.Decode(lapData, now)
	if err != nil || len(events) != 1 || events[0].Telemetry.SpeedKPH != 287 || events[0].Telemetry.Position != 3 {
		t.Fatalf("lap telemetry events = %#v, %v", events, err)
	}

	history := packet(PacketSessionHistory, 7+14)
	history[HeaderSize] = 0
	history[HeaderSize+1] = 1
	lap := history[HeaderSize+7:]
	binary.LittleEndian.PutUint32(lap[0:4], 90_123)
	binary.LittleEndian.PutUint16(lap[4:6], 30_000)
	binary.LittleEndian.PutUint16(lap[7:9], 30_000)
	binary.LittleEndian.PutUint16(lap[10:12], 30_123)
	lap[13] = 1
	events, err = decoder.Decode(history, now.Add(90*time.Second))
	if err != nil || len(events) != 1 || events[0].Lap.Time != 90_123*time.Millisecond {
		t.Fatalf("history events = %#v, %v", events, err)
	}

	final := packet(PacketFinalClassification, 1+45)
	final[HeaderSize] = 1
	classification := final[HeaderSize+1:]
	classification[0], classification[1] = 1, 5
	binary.LittleEndian.PutUint32(classification[6:10], 90_123)
	events, err = decoder.Decode(final, now.Add(10*time.Minute))
	if err != nil || len(events) != 2 || events[0].Type != session.EventClassification || events[1].Type != session.EventEnded {
		t.Fatalf("final events = %#v, %v", events, err)
	}
}

func TestParseHeaderRejectsUnknownVersion(t *testing.T) {
	data := packet(PacketSession, 8)
	binary.LittleEndian.PutUint16(data[0:2], 2024)
	if _, err := ParseHeader(data); err == nil {
		t.Fatal("expected unsupported version error")
	}
}

func packet(id byte, payload int) []byte {
	data := make([]byte, HeaderSize+payload)
	binary.LittleEndian.PutUint16(data[0:2], 2026)
	data[2], data[3], data[4], data[5], data[6] = 26, 1, 0, 1, id
	binary.LittleEndian.PutUint64(data[7:15], 42)
	binary.LittleEndian.PutUint32(data[15:19], math.Float32bits(100))
	data[27], data[28] = 0, 255
	return data
}
