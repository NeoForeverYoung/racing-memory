package iracing

import (
	"context"
	"errors"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
)

type Collector struct {
	Reader   Reader
	SourceID string
	Retry    time.Duration
}

func (c Collector) Run(ctx context.Context, output chan<- session.Event) error {
	if c.Reader == nil {
		return errors.New("iRacing reader is required")
	}
	defer c.Reader.Close()
	sourceID := c.SourceID
	if sourceID == "" {
		sourceID = "iracing-shm"
	}
	retry := c.Retry
	if retry <= 0 {
		retry = 250 * time.Millisecond
	}
	projector := NewProjector(sourceID)
	var info SessionInfo
	var infoUpdate int32 = -1
	var ended bool
	var endedSessionNum int64
	var endedUnique int64
	for {
		snapshot, err := c.Reader.Read(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			if errors.Is(err, ErrNoData) {
				continue
			}
			if errors.Is(err, ErrNotConnected) {
				if projector.Started {
					for _, event := range projector.End(time.Now().UTC(), info, false) {
						if !sendEvent(ctx, output, event) {
							return nil
						}
					}
				}
				if !wait(ctx, retry) {
					return nil
				}
				continue
			}
			return err
		}
		if !snapshot.Header.Connected() {
			continue
		}
		if snapshot.Header.SessionInfoUpdate != infoUpdate {
			parsed, parseErr := ParseSessionInfo(snapshot.SessionRaw)
			if parseErr != nil {
				return parseErr
			}
			info, infoUpdate = parsed, snapshot.Header.SessionInfoUpdate
		}
		sessionNum, _ := snapshot.Frame.Int("SessionNum")
		sessionUnique, _ := snapshot.Frame.Int("SessionUniqueID")
		if ended {
			if sessionNum == endedSessionNum && sessionUnique == endedUnique {
				continue
			}
			ended = false
		}
		events, err := projector.Process(snapshot.Frame, info, snapshot.At)
		if err != nil {
			return err
		}
		for _, event := range events {
			if !sendEvent(ctx, output, event) {
				return nil
			}
		}
		if state, ok := snapshot.Frame.Int("SessionState"); ok && state >= 5 && projector.Started {
			for _, event := range projector.End(snapshot.At, info, true) {
				if !sendEvent(ctx, output, event) {
					return nil
				}
			}
			ended, endedSessionNum, endedUnique = true, sessionNum, sessionUnique
		}
	}
}

func sendEvent(ctx context.Context, output chan<- session.Event, event session.Event) bool {
	select {
	case output <- event:
		return true
	case <-ctx.Done():
		return false
	}
}

func wait(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
}
