//go:build integration

package ibt

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/app"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/media"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/store"
)

func TestSyntheticIBTWithContinuousVideo(t *testing.T) {
	requireFFmpeg(t)
	root := t.TempDir()
	ibtPath := filepath.Join(root, "synthetic.ibt")
	if err := os.WriteFile(ibtPath, syntheticIBT(), 0o600); err != nil {
		t.Fatal(err)
	}
	videoPath := filepath.Join(root, "continuous.mp4")
	generateFixtureVideo(t, videoPath, 12*time.Second, 10)

	value := importWithVideo(t, ibtPath, videoPath, 2*time.Second, filepath.Join(root, "data"))
	if value.Artifacts.Status != "ready" || value.Artifacts.Video != "highlights.mp4" ||
		value.Artifacts.Manifest != "highlights.json" {
		t.Fatalf("unexpected artifacts: %+v", value.Artifacts)
	}
	assertArtifact(t, root, "data", value.ID, "highlights.mp4")
	assertArtifact(t, root, "data", value.ID, "highlights.json")
}

func TestRealIBTGoldenWithGeneratedVideo(t *testing.T) {
	path := os.Getenv("RACING_IBT_GOLDEN")
	if path == "" {
		t.Skip("RACING_IBT_GOLDEN is not set")
	}
	requireFFmpeg(t)
	source, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	duration := time.Duration(source.Disk.SessionEndTime*float64(time.Second)) + 10*time.Second
	_ = source.Close()

	root := t.TempDir()
	videoPath := filepath.Join(root, "continuous.mp4")
	generateFixtureVideo(t, videoPath, duration, 1)
	value := importWithVideo(t, path, videoPath, 0, filepath.Join(root, "data"))
	if value.Track != "Circuit de Spa-Francorchamps" || len(value.Laps) != 16 ||
		value.Incidents != 4 {
		t.Fatalf("unexpected real fixture summary: track=%q laps=%d incidents=%d",
			value.Track, len(value.Laps), value.Incidents)
	}
	best, ok := value.BestLap()
	if !ok || best.Time != 140617904663*time.Nanosecond {
		t.Fatalf("best lap = %v, found=%v", best.Time, ok)
	}
	if value.Artifacts.Status != "ready" {
		t.Fatalf("real fixture media failed: %+v", value.Artifacts)
	}
	assertArtifact(t, root, "data", value.ID, "highlights.mp4")
	assertArtifact(t, root, "data", value.ID, "highlights.json")
}

func importWithVideo(t *testing.T, ibtPath, videoPath string, zero time.Duration, dataDir string) model.Session {
	t.Helper()
	source, err := Open(ibtPath)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	repository, err := store.New(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	engine := app.NewEngine(repository, nil, media.Pipeline{}, app.Config{
		VideoInput: videoPath, VideoSessionZero: zero, RejectExisting: true,
	})
	var externalID string
	if err := source.Emit(func(event session.Event) error {
		if event.Type == session.EventStarted && externalID == "" {
			externalID = event.ExternalID
		}
		return engine.Handle(context.Background(), event)
	}); err != nil {
		t.Fatal(err)
	}
	value, err := repository.Load(app.SessionID(externalID))
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func requireFFmpeg(t *testing.T) {
	t.Helper()
	for _, binary := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(binary); err != nil {
			t.Skipf("%s is unavailable", binary)
		}
	}
}

func generateFixtureVideo(t *testing.T, path string, duration time.Duration, rate int) {
	t.Helper()
	input := fmt.Sprintf("testsrc2=size=320x180:rate=%d", rate)
	cmd := exec.Command(
		"ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", input, "-t", fmt.Sprintf("%.3f", duration.Seconds()),
		"-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
		"-an", "-movflags", "+faststart", path,
	)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("generate fixture video: %v: %s", err, output)
	}
}

func assertArtifact(t *testing.T, root, dataDir, sessionID, name string) {
	t.Helper()
	path := filepath.Join(root, dataDir, "sessions", sessionID, "artifacts", name)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() == 0 {
		t.Fatalf("%s is empty", path)
	}
}
