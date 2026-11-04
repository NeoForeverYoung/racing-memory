.PHONY: run demo import-ibt test race build build-windows clean

run:
	go run ./cmd/racing-companion -config configs/racing.example.json

demo:
	go run ./cmd/racing-demo -output racing-demo-data

import-ibt:
	@test -n "$(FILE)" || (echo "usage: make import-ibt FILE=/path/to/session.ibt [VIDEO=/path/to/recording.mp4] [VIDEO_SESSION_ZERO=30s]" && exit 1)
	go run ./cmd/racing-import-ibt -file "$(FILE)" -data-dir racing-data \
		$(if $(VIDEO),-video "$(VIDEO)") \
		$(if $(VIDEO_SESSION_ZERO),-video-session-zero "$(VIDEO_SESSION_ZERO)")

test:
	go test ./...

race:
	go test -race ./...

build:
	mkdir -p build
	go build -o build/racing-companion ./cmd/racing-companion
	go build -o build/racing-import-ibt ./cmd/racing-import-ibt

build-windows:
	mkdir -p build
	GOOS=windows GOARCH=amd64 go build -o build/racing-companion.exe ./cmd/racing-companion
	GOOS=windows GOARCH=amd64 go build -o build/racing-import-ibt.exe ./cmd/racing-import-ibt

clean:
	rm -rf build racing-data racing-demo-data
