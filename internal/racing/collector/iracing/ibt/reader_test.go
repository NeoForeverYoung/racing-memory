package ibt

import (
	"bytes"
	"context"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/app"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/collector/iracing/wire"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/media"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/store"
)

func TestSyntheticIBTEmitsRaceEvents(t *testing.T) {
	path := filepath.Join(t.TempDir(), "synthetic.ibt")
	if err := os.WriteFile(path, syntheticIBT(), 0o600); err != nil {
		t.Fatal(err)
	}
	source, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	if source.Records() != 3 {
		t.Fatalf("records = %d", source.Records())
	}
	var events []session.Event
	if err := source.Emit(func(event session.Event) error {
		events = append(events, event)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var started, laps, classified, ended int
	for _, event := range events {
		switch event.Type {
		case session.EventStarted:
			started++
			if event.Game != "iracing" || event.Track != "Okayama" || event.Car != "MX-5 Cup" {
				t.Fatalf("unexpected start: %+v", event)
			}
		case session.EventLapCompleted:
			laps++
			if event.Lap.Time.Seconds() != 90.5 {
				t.Fatalf("lap time = %v", event.Lap.Time)
			}
		case session.EventClassification:
			classified++
		case session.EventEnded:
			ended++
		}
	}
	if started != 1 || laps != 1 || classified != 1 || ended != 1 {
		t.Fatalf("event counts start=%d laps=%d classification=%d end=%d", started, laps, classified, ended)
	}
}

func TestSyntheticIBTImportsThroughEngine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "synthetic.ibt")
	if err := os.WriteFile(path, syntheticIBT(), 0o600); err != nil {
		t.Fatal(err)
	}
	source, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	repository, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	engine := app.NewEngine(repository, nil, media.Pipeline{}, app.Config{RejectExisting: true})
	if err := source.Emit(func(event session.Event) error {
		return engine.Handle(context.Background(), event)
	}); err != nil {
		t.Fatal(err)
	}
	value, err := repository.Load("iracing-200-0")
	if err != nil {
		t.Fatal(err)
	}
	if value.Game != "iracing" || len(value.Laps) != 1 || value.ResultSource != "official" {
		t.Fatalf("unexpected imported session: %+v", value)
	}
}

func TestIBTUsesAvailableRowsWhenDeclaredCountIsTooLarge(t *testing.T) {
	raw := syntheticIBT()
	binary.LittleEndian.PutUint32(raw[140:144], 1000)
	path := filepath.Join(t.TempDir(), "truncated.ibt")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	source, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	if source.Records() != 3 {
		t.Fatalf("records = %d, want available rows", source.Records())
	}
}

func FuzzParseIBT(f *testing.F) {
	seed := syntheticIBT()
	f.Add(seed)
	f.Fuzz(func(t *testing.T, data []byte) {
		_, _ = parse(bytes.NewReader(data), int64(len(data)))
	})
}

func syntheticIBT() []byte {
	yaml := []byte(`WeekendInfo:
  TrackName: okayama
  TrackDisplayName: Okayama
  SessionID: 100
  SubSessionID: 200
SessionInfo:
  Sessions:
    - SessionNum: 0
      SessionType: Race
      ResultsPositions:
        - Position: 0
          ClassPosition: 0
          CarIdx: 0
          LapsComplete: 1
          FastestTime: 90.5
DriverInfo:
  DriverCarIdx: 0
  Drivers:
    - CarIdx: 0
      UserName: Local Driver
      CarScreenName: MX-5 Cup
      CarNumber: "7"
      CarClassShortName: MX5
`)
	vars := []testVar{
		{wire.TypeDouble, 0, "SessionTime"}, {wire.TypeInt, 8, "SessionNum"},
		{wire.TypeInt, 12, "SessionUniqueID"}, {wire.TypeInt, 16, "PlayerCarIdx"},
		{wire.TypeInt, 20, "LapCompleted"}, {wire.TypeFloat, 24, "LapLastLapTime"},
		{wire.TypeFloat, 28, "Speed"}, {wire.TypeFloat, 32, "RPM"},
		{wire.TypeInt, 36, "Gear"}, {wire.TypeFloat, 40, "Throttle"},
		{wire.TypeFloat, 44, "Brake"}, {wire.TypeInt, 48, "PlayerCarPosition"},
		{wire.TypeInt, 52, "PlayerCarClassPosition"}, {wire.TypeInt, 56, "PlayerCarMyIncidentCount"},
		{wire.TypeBool, 60, "OnPitRoad"},
	}
	const rowLen = 64
	yamlOffset := 144 + len(vars)*wire.VarHeaderSize
	rowOffset := yamlOffset + len(yaml)
	raw := make([]byte, rowOffset+3*rowLen)
	putInt32(raw, 0, 2)
	putInt32(raw, 8, 60)
	putInt32(raw, 16, len(yaml))
	putInt32(raw, 20, yamlOffset)
	putInt32(raw, 24, len(vars))
	putInt32(raw, 28, 144)
	putInt32(raw, 32, 1)
	putInt32(raw, 36, rowLen)
	putInt32(raw, 52, rowOffset)
	binary.LittleEndian.PutUint64(raw[112:120], uint64(1_700_000_000))
	binary.LittleEndian.PutUint64(raw[120:128], math.Float64bits(0))
	binary.LittleEndian.PutUint64(raw[128:136], math.Float64bits(3))
	putInt32(raw, 136, 1)
	putInt32(raw, 140, 3)
	for i, variable := range vars {
		start := 144 + i*wire.VarHeaderSize
		putInt32(raw, start, int(variable.typ))
		putInt32(raw, start+4, variable.offset)
		putInt32(raw, start+8, 1)
		copy(raw[start+16:start+48], variable.name)
	}
	copy(raw[yamlOffset:], yaml)
	for i := 0; i < 3; i++ {
		row := raw[rowOffset+i*rowLen : rowOffset+(i+1)*rowLen]
		binary.LittleEndian.PutUint64(row[0:8], math.Float64bits(float64(i+1)))
		putInt32(row, 8, 0)
		putInt32(row, 12, 999)
		putInt32(row, 16, 0)
		putInt32(row, 20, boolInt(i >= 1))
		putFloat32(row, 24, 90.5)
		putFloat32(row, 28, 40)
		putFloat32(row, 32, 6500)
		putInt32(row, 36, 4)
		putFloat32(row, 40, 0.8)
		putFloat32(row, 44, 0.1)
		putInt32(row, 48, 1)
		putInt32(row, 52, 1)
	}
	return raw
}

type testVar struct {
	typ    wire.VarType
	offset int
	name   string
}

func putInt32(data []byte, offset, value int) {
	binary.LittleEndian.PutUint32(data[offset:offset+4], uint32(value))
}

func putFloat32(data []byte, offset int, value float32) {
	binary.LittleEndian.PutUint32(data[offset:offset+4], math.Float32bits(value))
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
