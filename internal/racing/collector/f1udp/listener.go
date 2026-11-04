package f1udp

import (
	"context"
	"errors"
	"net"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
)

type Listener struct {
	Address string
	Decoder *Decoder
}

func (l Listener) Run(ctx context.Context, output chan<- session.Event) error {
	if l.Decoder == nil {
		return errors.New("F1 decoder is required")
	}
	address := l.Address
	if address == "" {
		address = "0.0.0.0:20777"
	}
	conn, err := net.ListenPacket("udp", address)
	if err != nil {
		return err
	}
	defer conn.Close()
	go func() {
		<-ctx.Done()
		_ = conn.Close()
	}()

	buffer := make([]byte, 64<<10)
	for {
		n, _, err := conn.ReadFrom(buffer)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		events, err := l.Decoder.Decode(buffer[:n], time.Now().UTC())
		if err != nil {
			continue
		}
		for _, event := range events {
			select {
			case output <- event:
			case <-ctx.Done():
				return nil
			}
		}
	}
}
