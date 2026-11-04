package iracing

import (
	"fmt"
	"strings"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"gopkg.in/yaml.v3"
)

type SessionInfo struct {
	WeekendInfo struct {
		TrackName        string `yaml:"TrackName"`
		TrackDisplayName string `yaml:"TrackDisplayName"`
		SessionID        int64  `yaml:"SessionID"`
		SubSessionID     int64  `yaml:"SubSessionID"`
	} `yaml:"WeekendInfo"`
	SessionInfo struct {
		Sessions []SessionDefinition `yaml:"Sessions"`
	} `yaml:"SessionInfo"`
	DriverInfo struct {
		DriverCarIdx int      `yaml:"DriverCarIdx"`
		Drivers      []Driver `yaml:"Drivers"`
	} `yaml:"DriverInfo"`
}

type SessionDefinition struct {
	SessionNum       int              `yaml:"SessionNum"`
	SessionType      string           `yaml:"SessionType"`
	SessionName      string           `yaml:"SessionName"`
	ResultsPositions []ResultPosition `yaml:"ResultsPositions"`
}

type ResultPosition struct {
	Position      int     `yaml:"Position"`
	ClassPosition int     `yaml:"ClassPosition"`
	CarIdx        int     `yaml:"CarIdx"`
	LapsComplete  int     `yaml:"LapsComplete"`
	FastestTime   float64 `yaml:"FastestTime"`
}

type Driver struct {
	CarIdx            int    `yaml:"CarIdx"`
	UserName          string `yaml:"UserName"`
	CarScreenName     string `yaml:"CarScreenName"`
	CarNumber         string `yaml:"CarNumber"`
	CarClassShortName string `yaml:"CarClassShortName"`
}

type Metadata struct {
	ExternalID     string
	WeekendID      string
	Track          string
	Car            string
	Driver         string
	SessionKind    string
	CarNumber      string
	CarClass       string
	Classification []model.Standing
}

func ParseSessionInfo(raw []byte) (SessionInfo, error) {
	var info SessionInfo
	if err := yaml.Unmarshal(raw, &info); err != nil {
		return info, fmt.Errorf("parse iRacing SessionInfo: %w", err)
	}
	if info.WeekendInfo.TrackName == "" && info.WeekendInfo.TrackDisplayName == "" {
		return info, fmt.Errorf("iRacing SessionInfo has no track")
	}
	return info, nil
}

func (s SessionInfo) Metadata(sessionNum int) Metadata {
	meta := Metadata{
		ExternalID: fmt.Sprintf("%d-%d", s.WeekendInfo.SubSessionID, sessionNum),
		WeekendID:  fmt.Sprintf("%d", s.WeekendInfo.SessionID),
		Track:      firstNonEmpty(s.WeekendInfo.TrackDisplayName, s.WeekendInfo.TrackName),
	}
	drivers := make(map[int]Driver, len(s.DriverInfo.Drivers))
	for _, driver := range s.DriverInfo.Drivers {
		drivers[driver.CarIdx] = driver
		if driver.CarIdx == s.DriverInfo.DriverCarIdx {
			meta.Car = driver.CarScreenName
			meta.Driver = driver.UserName
			meta.CarNumber = driver.CarNumber
			meta.CarClass = driver.CarClassShortName
		}
	}
	for _, current := range s.SessionInfo.Sessions {
		if current.SessionNum != sessionNum {
			continue
		}
		meta.SessionKind = normalizeSessionKind(firstNonEmpty(current.SessionType, current.SessionName))
		for _, result := range current.ResultsPositions {
			driver := drivers[result.CarIdx]
			number := firstNonEmpty(driver.CarNumber, fmt.Sprintf("%d", result.CarIdx))
			name := fmt.Sprintf("Car %s", number)
			if result.CarIdx == s.DriverInfo.DriverCarIdx {
				name = meta.Driver
			}
			meta.Classification = append(meta.Classification, model.Standing{
				Position: result.Position + 1, ClassPosition: result.ClassPosition + 1,
				Driver: name, Car: driver.CarScreenName, CarNumber: number,
				Class: driver.CarClassShortName, Laps: result.LapsComplete,
				BestLap: durationSeconds(result.FastestTime),
			})
		}
		break
	}
	return meta
}

func normalizeSessionKind(value string) string {
	value = strings.ToLower(value)
	switch {
	case strings.Contains(value, "practice"):
		return "practice"
	case strings.Contains(value, "qual"):
		return "qualifying"
	case strings.Contains(value, "race"):
		return "race"
	case strings.Contains(value, "time trial"):
		return "time_trial"
	default:
		return strings.ReplaceAll(strings.TrimSpace(value), " ", "_")
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func durationSeconds(value float64) time.Duration {
	if value <= 0 {
		return 0
	}
	return time.Duration(value * float64(time.Second))
}
