// Package model contains the game-neutral racing memory domain model.
package model

import "time"

type Game string

const (
	GameF1      Game = "f1"
	GameACC     Game = "acc"
	GameIRacing Game = "iracing"
)

type Source string

const (
	SourceOfficial Source = "official"
	SourceDerived  Source = "derived"
)

type SessionState string

const (
	StateRunning   SessionState = "running"
	StateCompleted SessionState = "completed"
	StateAborted   SessionState = "aborted"
)

type Session struct {
	ID              string       `json:"id"`
	ExternalID      string       `json:"external_id,omitempty"`
	WeekendID       string       `json:"weekend_id,omitempty"`
	Game            Game         `json:"game"`
	ProtocolVersion string       `json:"protocol_version"`
	SessionKind     string       `json:"session_kind,omitempty"`
	Track           string       `json:"track"`
	Car             string       `json:"car"`
	CarNumber       string       `json:"car_number,omitempty"`
	CarClass        string       `json:"car_class,omitempty"`
	Driver          string       `json:"driver,omitempty"`
	StartedAt       time.Time    `json:"started_at"`
	EndedAt         *time.Time   `json:"ended_at,omitempty"`
	State           SessionState `json:"state"`
	CurrentLap      int          `json:"current_lap"`
	Position        int          `json:"position,omitempty"`
	ClassPosition   int          `json:"class_position,omitempty"`
	Incidents       int          `json:"incidents,omitempty"`
	TotalCars       int          `json:"total_cars,omitempty"`
	Laps            []Lap        `json:"laps"`
	Highlights      []Highlight  `json:"highlights,omitempty"`
	Classification  []Standing   `json:"classification,omitempty"`
	ResultSource    Source       `json:"result_source"`
	Artifacts       ArtifactSet  `json:"artifacts,omitempty"`
	Warnings        []string     `json:"warnings,omitempty"`
}

type Lap struct {
	Number    int             `json:"number"`
	Time      time.Duration   `json:"time"`
	Sectors   []time.Duration `json:"sectors,omitempty"`
	Position  int             `json:"position,omitempty"`
	Valid     bool            `json:"valid"`
	Completed time.Time       `json:"completed_at"`
}

type Standing struct {
	Position      int           `json:"position"`
	ClassPosition int           `json:"class_position,omitempty"`
	Driver        string        `json:"driver"`
	Car           string        `json:"car,omitempty"`
	CarNumber     string        `json:"car_number,omitempty"`
	Class         string        `json:"class,omitempty"`
	Laps          int           `json:"laps"`
	BestLap       time.Duration `json:"best_lap,omitempty"`
}

type TelemetrySample struct {
	At            time.Time     `json:"at"`
	SessionTime   time.Duration `json:"session_time"`
	SpeedKPH      float64       `json:"speed_kph,omitempty"`
	RPM           int           `json:"rpm,omitempty"`
	Gear          int           `json:"gear,omitempty"`
	Throttle      float64       `json:"throttle,omitempty"`
	Brake         float64       `json:"brake,omitempty"`
	Lap           int           `json:"lap"`
	Position      int           `json:"position,omitempty"`
	ClassPosition int           `json:"class_position,omitempty"`
	IncidentCount int           `json:"incident_count,omitempty"`
	OnPitRoad     bool          `json:"on_pit_road,omitempty"`
	Steering      float64       `json:"steering,omitempty"`
	FuelLevel     float64       `json:"fuel_level,omitempty"`
}

type HighlightKind string

const (
	HighlightBestLap  HighlightKind = "best_lap"
	HighlightOvertake HighlightKind = "overtake"
	HighlightFinish   HighlightKind = "finish"
	HighlightIncident HighlightKind = "incident"
)

type Highlight struct {
	ID          string        `json:"id"`
	Kind        HighlightKind `json:"kind"`
	At          time.Duration `json:"at"`
	WindowStart time.Duration `json:"window_start"`
	WindowEnd   time.Duration `json:"window_end"`
	Score       int           `json:"score"`
	Title       string        `json:"title"`
	SourceClip  string        `json:"source_clip,omitempty"`
}

type ArtifactSet struct {
	Status     string   `json:"status,omitempty"`
	ReportJSON string   `json:"report_json,omitempty"`
	ReportHTML string   `json:"report_html,omitempty"`
	Scorecard  string   `json:"scorecard,omitempty"`
	Video      string   `json:"video,omitempty"`
	Images     []string `json:"images,omitempty"`
	Error      string   `json:"error,omitempty"`
}

func (s Session) BestLap() (Lap, bool) {
	var best Lap
	found := false
	for _, lap := range s.Laps {
		if !lap.Valid || lap.Time <= 0 {
			continue
		}
		if !found || lap.Time < best.Time {
			best, found = lap, true
		}
	}
	return best, found
}
