package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/api"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/app"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/collector/acc"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/collector/f1udp"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/collector/iracing"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/media"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/obs"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/store"
)

type config struct {
	Game             string `json:"game"`
	DataDir          string `json:"data_dir"`
	HTTP             string `json:"http"`
	F1UDP            string `json:"f1_udp"`
	OBSAddress       string `json:"obs_address"`
	OBSEnabled       bool   `json:"obs_enabled"`
	VideoInput       string `json:"video_input"`
	VideoSessionZero string `json:"video_session_zero"`
}

func main() {
	configPath := flag.String("config", "configs/racing.example.json", "configuration JSON path")
	flag.Parse()
	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	repository, err := store.New(cfg.DataDir)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var replay *obs.Client
	if cfg.OBSEnabled {
		replay, err = obs.Dial(ctx, cfg.OBSAddress, os.Getenv("RACING_OBS_PASSWORD"))
		if err != nil {
			log.Fatalf("connect OBS: %v", err)
		}
		defer replay.Close()
	}
	videoSessionZero, err := parseVideoSessionZero(cfg.VideoSessionZero)
	if err != nil {
		log.Fatal(err)
	}
	engine := app.NewEngine(repository, replay, media.Pipeline{}, app.Config{
		VideoInput: cfg.VideoInput, VideoSessionZero: videoSessionZero,
	})
	events := make(chan session.Event, 256)
	errs := make(chan error, 3)

	go func() {
		defer close(events)
		switch cfg.Game {
		case "f1":
			errs <- (f1udp.Listener{Address: cfg.F1UDP, Decoder: f1udp.NewDecoder("f1-udp")}).Run(ctx, events)
		case "acc":
			reader, openErr := acc.NewReader()
			if openErr != nil {
				errs <- openErr
				return
			}
			errs <- (acc.Collector{Reader: reader}).Run(ctx, events)
		case "iracing":
			reader, openErr := iracing.NewReader()
			if openErr != nil {
				errs <- openErr
				return
			}
			errs <- (iracing.Collector{Reader: reader}).Run(ctx, events)
		default:
			errs <- fmt.Errorf("unsupported game %q", cfg.Game)
		}
	}()
	go func() { errs <- engine.Run(ctx, events) }()

	server := &http.Server{Addr: cfg.HTTP, Handler: api.New(repository), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		log.Printf("racing companion listening on %s; game=%s data=%s", cfg.HTTP, cfg.Game, cfg.DataDir)
		err := server.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errs <- err
		}
	}()

	select {
	case <-ctx.Done():
	case err := <-errs:
		if err != nil {
			log.Printf("pipeline stopped: %v", err)
		}
		stop()
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
}

func loadConfig(path string) (config, error) {
	cfg := config{
		Game: "f1", DataDir: "./racing-data", HTTP: "127.0.0.1:8090",
		F1UDP: "0.0.0.0:20777", OBSAddress: "ws://127.0.0.1:4455",
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return cfg, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cfg); err != nil {
		return cfg, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return cfg, errors.New("configuration contains trailing JSON")
	}
	if cfg.DataDir == "" || cfg.HTTP == "" {
		return cfg, errors.New("data_dir and http are required")
	}
	if cfg.Game != "f1" && cfg.Game != "acc" && cfg.Game != "iracing" {
		return cfg, fmt.Errorf("unsupported game %q", cfg.Game)
	}
	if _, err := parseVideoSessionZero(cfg.VideoSessionZero); err != nil {
		return cfg, err
	}
	host, _, err := net.SplitHostPort(cfg.HTTP)
	if err != nil {
		return cfg, fmt.Errorf("invalid http address: %w", err)
	}
	if ip := net.ParseIP(host); host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return cfg, errors.New("http must listen on a loopback address")
	}
	return cfg, nil
}

func parseVideoSessionZero(value string) (time.Duration, error) {
	if value == "" {
		return 0, nil
	}
	offset, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("invalid video_session_zero: %w", err)
	}
	return offset, nil
}
