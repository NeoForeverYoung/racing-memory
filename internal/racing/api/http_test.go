package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/store"
)

func TestSessionAndArtifactEndpoints(t *testing.T) {
	repository, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	value := model.Session{
		ID: "race-1", Game: model.GameIRacing, Track: "Spa", StartedAt: time.Now().UTC(),
		Highlights: []model.Highlight{{ID: "best", SourceClip: `C:\Users\driver\Videos\private.mkv`}},
	}
	if err := repository.Save(value); err != nil {
		t.Fatal(err)
	}
	dir, _ := repository.SessionDir(value.ID)
	if err := os.MkdirAll(filepath.Join(dir, "artifacts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "artifacts", "highlights.mp4"), []byte("video"), 0o644); err != nil {
		t.Fatal(err)
	}
	handler := New(repository)

	req := httptest.NewRequest(http.MethodGet, "/v1/racing/sessions/race-1/memory", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"session_id":"race-1"`) {
		t.Fatalf("memory response = %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "private.mkv") || strings.Contains(rec.Body.String(), `C:\\Users`) {
		t.Fatalf("memory response leaked source clip: %s", rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/racing/artifacts/race-1/highlights.mp4", nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "video" {
		t.Fatalf("artifact response = %d %q", rec.Code, rec.Body.String())
	}
}
