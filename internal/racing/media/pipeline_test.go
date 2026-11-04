package media

import (
	"context"
	"os"
	"path/filepath"
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
	got, err := (Pipeline{Runner: runner}).Generate(context.Background(), "", value, dir)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "ready" || got.Video != "highlights.mp4" || len(got.Images) != 1 {
		t.Fatalf("unexpected artifacts: %+v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "clips.txt")); err != nil {
		t.Fatal(err)
	}
	if len(runner.calls) != 5 {
		t.Fatalf("calls = %d, want probe, clip, still, output probe", len(runner.calls))
	}
}
