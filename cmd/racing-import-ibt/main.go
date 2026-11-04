package main

import (
	"context"
	"flag"
	"fmt"
	"log"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/app"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/collector/iracing/ibt"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/media"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/store"
)

func main() {
	file := flag.String("file", "", "path to an iRacing .ibt telemetry file")
	dataDir := flag.String("data-dir", "./racing-data", "output data directory")
	video := flag.String("video", "", "optional continuous recording aligned to SessionTime")
	videoSessionZero := flag.Duration(
		"video-session-zero", 0,
		"position in the recording that corresponds to iRacing SessionTime 0 (for example 30s)",
	)
	flag.Parse()
	if *file == "" {
		log.Fatal("-file is required")
	}
	source, err := ibt.Open(*file)
	if err != nil {
		log.Fatal(err)
	}
	defer source.Close()
	repository, err := store.New(*dataDir)
	if err != nil {
		log.Fatal(err)
	}
	engine := app.NewEngine(repository, nil, media.Pipeline{}, app.Config{
		VideoInput: *video, VideoSessionZero: *videoSessionZero, RejectExisting: true,
	})
	var externalID string
	if err := source.Emit(func(event session.Event) error {
		if event.Type == session.EventStarted && externalID == "" {
			externalID = event.ExternalID
		}
		return engine.Handle(context.Background(), event)
	}); err != nil {
		log.Fatal(err)
	}
	fmt.Println(app.SessionID(externalID))
}
