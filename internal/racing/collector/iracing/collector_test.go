package iracing

import (
	"context"
	"encoding/binary"
	"math"
	"testing"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/collector/iracing/wire"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
)

func TestCollectorContinuesAcrossSessions(t *testing.T) {
	layout := testLayout(t)
	info := []byte(`WeekendInfo:
  TrackName: spa
  TrackDisplayName: Spa
  SessionID: 10
  SubSessionID: 20
SessionInfo:
  Sessions:
    - SessionNum: 0
      SessionType: Race
    - SessionNum: 1
      SessionType: Practice
DriverInfo:
  DriverCarIdx: 0
  Drivers:
    - CarIdx: 0
      UserName: Local Driver
      CarScreenName: GT3
`)
	reader := &FixtureReader{Snapshots: []Snapshot{
		testSnapshot(layout, info, 1, 0, 5, 1),
		testSnapshot(layout, info, 1, 0, 6, 2),
		testSnapshot(layout, info, 2, 1, 5, 1),
	}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	output := make(chan session.Event, 32)
	done := make(chan error, 1)
	go func() { done <- (Collector{Reader: reader, Retry: time.Millisecond}).Run(ctx, output) }()
	var starts, ends int
	deadline := time.After(time.Second)
	for starts < 2 {
		select {
		case event := <-output:
			if event.Type == session.EventStarted {
				starts++
			}
			if event.Type == session.EventEnded {
				ends++
			}
		case <-deadline:
			t.Fatalf("timed out: starts=%d ends=%d", starts, ends)
		}
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if ends < 1 {
		t.Fatalf("ends = %d, want first session ended", ends)
	}
}

func testLayout(t *testing.T) wire.Layout {
	t.Helper()
	names := []string{"SessionTime", "SessionNum", "SessionUniqueID", "PlayerCarIdx", "LapCompleted", "SessionState"}
	types := []wire.VarType{wire.TypeDouble, wire.TypeInt, wire.TypeInt, wire.TypeInt, wire.TypeInt, wire.TypeInt}
	raw := make([]byte, 144+len(names)*wire.VarHeaderSize)
	putTestInt(raw, 0, 2)
	putTestInt(raw, 8, 60)
	putTestInt(raw, 24, len(names))
	putTestInt(raw, 28, 144)
	putTestInt(raw, 32, 1)
	putTestInt(raw, 36, 32)
	for i, name := range names {
		start := 144 + i*wire.VarHeaderSize
		putTestInt(raw, start, int(types[i]))
		offset := 8 + (i-1)*4
		if i == 0 {
			offset = 0
		}
		putTestInt(raw, start+4, offset)
		putTestInt(raw, start+8, 1)
		copy(raw[start+16:start+48], name)
	}
	header, err := wire.ParseHeader(raw)
	if err != nil {
		t.Fatal(err)
	}
	layout, err := wire.ParseLayout(raw, header)
	if err != nil {
		t.Fatal(err)
	}
	return layout
}

func testSnapshot(layout wire.Layout, info []byte, unique, number, state int, seconds float64) Snapshot {
	row := make([]byte, layout.BufferLen)
	binary.LittleEndian.PutUint64(row[0:8], math.Float64bits(seconds))
	putTestInt(row, 8, number)
	putTestInt(row, 12, unique)
	putTestInt(row, 16, 0)
	putTestInt(row, 20, 0)
	putTestInt(row, 24, state)
	return Snapshot{
		At:     time.Unix(1_700_000_000, 0).Add(time.Duration(seconds * float64(time.Second))),
		Header: wire.Header{Status: 1, SessionInfoUpdate: 1}, Layout: layout,
		SessionRaw: info, Frame: wire.Frame{Layout: layout, Data: row},
	}
}

func putTestInt(data []byte, offset, value int) {
	binary.LittleEndian.PutUint32(data[offset:offset+4], uint32(value))
}
