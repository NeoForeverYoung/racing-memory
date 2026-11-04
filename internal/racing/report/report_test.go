package report

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
)

func TestGenerateScorecard(t *testing.T) {
	dir := t.TempDir()
	value := model.Session{
		ID: "race-test", Game: model.GameIRacing, SessionKind: "race", Track: "Spa",
		Car: "GT3", CarNumber: "7", Driver: "Driver", Position: 2, ClassPosition: 1, Incidents: 2,
		Laps:           []model.Lap{{Number: 1, Time: 90 * time.Second, Position: 2, Valid: true}},
		Classification: []model.Standing{{Position: 2, ClassPosition: 1, Driver: "Driver", CarNumber: "7", BestLap: 90 * time.Second}},
	}
	got, err := (Renderer{}).Generate(value, dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{got.ReportJSON, got.ReportHTML, got.Scorecard} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil || info.Size() == 0 {
			t.Fatalf("%s was not generated: %v", name, err)
		}
	}
}
