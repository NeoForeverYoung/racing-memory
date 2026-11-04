package media

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
)

type fakeRunner struct {
	calls [][]string
}

func (f *fakeRunner) Run(_ context.Context, name string, args ...string) ([]byte, error) {
	f.calls = append(f.calls, append([]string{name}, args...))
	if name == "ffprobe" {
		return []byte(`{"format":{"duration":"120.0"}}`), nil
	}
	return nil, nil
}

func TestPipelineUsesReplayClipAndCreatesManifest(t *testing.T) {
	runner := &fakeRunner{}
	dir := t.TempDir()
	value := model.Session{
		Track: "Spa", Car: "McLaren",
		Highlights: []model.Highlight{{
			ID: "best-1", Kind: model.HighlightBestLap, At: 90 * time.Second,
			WindowStart: 78 * time.Second, WindowEnd: 95 * time.Second,
			Score: 100, Title: "Best Lap", SourceClip: "obs-replay.mkv",
		}},
	}
	got, err := (Pipeline{Runner: runner}).Generate(context.Background(), "", 30*time.Second, value, dir)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "ready" || got.Video != "highlights.mp4" ||
		got.Manifest != "highlights.json" || len(got.Images) != 1 {
		t.Fatalf("unexpected artifacts: %+v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "clips.txt")); err != nil {
		t.Fatal(err)
	}
	if len(runner.calls) != 5 {
		t.Fatalf("calls = %d, want probe, clip, still, output probe", len(runner.calls))
	}
	if got := runner.calls[1][6]; got != "103.000" {
		t.Fatalf("replay clip start = %s, want 103.000; offset must be ignored", got)
	}
}

func TestPipelineMapsContinuousRecordingAndCachesProbe(t *testing.T) {
	runner := &fakeRunner{}
	dir := t.TempDir()
	value := model.Session{
		Track: "Spa", Car: "Audi",
		Highlights: []model.Highlight{
			{ID: "best-1", Kind: model.HighlightBestLap, At: 20 * time.Second,
				WindowStart: 8 * time.Second, WindowEnd: 25 * time.Second, Score: 100},
			{ID: "finish-1", Kind: model.HighlightFinish, At: 115 * time.Second,
				WindowStart: 103 * time.Second, WindowEnd: 120 * time.Second, Score: 90},
		},
	}
	got, err := (Pipeline{Runner: runner}).Generate(
		context.Background(), "recording.mp4", 5*time.Second, value, dir,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Warnings) != 1 {
		t.Fatalf("warnings = %v, want one out-of-range warning", got.Warnings)
	}
	if len(runner.calls) != 7 {
		t.Fatalf("calls = %d, want one cached source probe, two clips/stills, concat, output probe", len(runner.calls))
	}
	if got := runner.calls[1][6]; got != "13.000" {
		t.Fatalf("continuous clip start = %s, want 13.000", got)
	}
	if got := runner.calls[1][12]; got != "17.000" {
		t.Fatalf("continuous clip length = %s, want 17.000", got)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "highlights.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"video_start_ms": 13000`) ||
		!strings.Contains(string(raw), `"clamped": true`) {
		t.Fatalf("unexpected manifest: %s", raw)
	}
}

func TestMapWindowContinuousBoundaries(t *testing.T) {
	tests := []struct {
		name   string
		value  model.Highlight
		offset time.Duration
		ok     bool
		start  time.Duration
		length time.Duration
		still  time.Duration
		clamp  bool
	}{
		{
			name: "zero offset", value: model.Highlight{
				At: 20 * time.Second, WindowStart: 8 * time.Second, WindowEnd: 25 * time.Second,
			}, ok: true, start: 8 * time.Second, length: 17 * time.Second, still: 20 * time.Second,
		},
		{
			name: "positive offset", value: model.Highlight{
				At: 20 * time.Second, WindowStart: 8 * time.Second, WindowEnd: 25 * time.Second,
			}, offset: 5 * time.Second, ok: true, start: 13 * time.Second,
			length: 17 * time.Second, still: 25 * time.Second,
		},
		{
			name: "negative offset clamps start", value: model.Highlight{
				At: 10 * time.Second, WindowStart: 0, WindowEnd: 15 * time.Second,
			}, offset: -5 * time.Second, ok: true, start: 0, length: 10 * time.Second,
			still: 5 * time.Second, clamp: true,
		},
		{
			name: "clamps end", value: model.Highlight{
				At: 115 * time.Second, WindowStart: 103 * time.Second, WindowEnd: 125 * time.Second,
			}, ok: true, start: 103 * time.Second, length: 17 * time.Second,
			still: 115 * time.Second, clamp: true,
		},
		{
			name: "outside before video", value: model.Highlight{
				At: 10 * time.Second, WindowStart: 0, WindowEnd: 15 * time.Second,
			}, offset: -20 * time.Second,
		},
		{
			name: "outside after video", value: model.Highlight{
				At: 130 * time.Second, WindowStart: 121 * time.Second, WindowEnd: 135 * time.Second,
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := mapWindow(test.value, 120*time.Second, false, test.offset)
			if ok != test.ok {
				t.Fatalf("ok = %v, want %v", ok, test.ok)
			}
			if !ok {
				return
			}
			if got.start != test.start || got.length != test.length ||
				got.stillAt != test.still || got.clamped != test.clamp {
				t.Fatalf("window = %+v", got)
			}
		})
	}
}
