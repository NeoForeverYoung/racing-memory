// Command racing-demo generates a complete synthetic racing memory for local validation.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/app"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/media"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/store"
)

func main() {
	output := flag.String("output", "./racing-demo-data", "demo output directory")
	input := flag.String("video", "", "optional source video")
	flag.Parse()
	if err := os.MkdirAll(*output, 0o755); err != nil {
		log.Fatal(err)
	}
	video := *input
	if video == "" {
		video = filepath.Join(*output, "demo-source.mp4")
		if err := generateVideo(video); err != nil {
			log.Fatal(err)
		}
	}
	repository, err := store.New(*output)
	if err != nil {
		log.Fatal(err)
	}
	engine := app.NewEngine(repository, nil, media.Pipeline{}, app.Config{VideoInput: video})
	now := time.Now().UTC()
	events := []session.Event{
		{SourceID: "demo", Sequence: 1, Type: session.EventStarted, At: now, Game: model.GameF1, Protocol: "demo", Track: "Spa", Car: "McLaren", Driver: "Demo Driver"},
		{SourceID: "demo", Sequence: 2, Type: session.EventTelemetry, At: now.Add(15 * time.Second), SessionTime: 15 * time.Second, Telemetry: &model.TelemetrySample{Lap: 1, Position: 5}},
		{SourceID: "demo", Sequence: 3, Type: session.EventTelemetry, At: now.Add(20 * time.Second), SessionTime: 20 * time.Second, Telemetry: &model.TelemetrySample{Lap: 1, Position: 4}},
		{SourceID: "demo", Sequence: 4, Type: session.EventLapCompleted, At: now.Add(35 * time.Second), SessionTime: 35 * time.Second, Lap: &model.Lap{Number: 1, Time: 90*time.Second + 123*time.Millisecond, Position: 4, Valid: true, Completed: now.Add(35 * time.Second)}},
		{SourceID: "demo", Sequence: 5, Type: session.EventEnded, At: now.Add(50 * time.Second), SessionTime: 50 * time.Second},
	}
	for _, event := range events {
		if err := engine.Handle(context.Background(), event); err != nil {
			log.Fatal(err)
		}
	}
	values, err := repository.List()
	if err != nil || len(values) != 1 {
		log.Fatalf("load generated session: count=%d error=%v", len(values), err)
	}
	dir, _ := repository.SessionDir(values[0].ID)
	fmt.Println(filepath.Join(dir, "artifacts"))
}

func generateVideo(path string) error {
	cmd := exec.Command("ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
		"-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
		"-t", "60", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-shortest", path,
	)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("generate demo video: %w: %s", err, output)
	}
	return nil
}
