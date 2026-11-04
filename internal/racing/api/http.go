// Package api exposes local, read-only racing memory endpoints.
package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/store"
)

type Handler struct {
	store *store.Store
	mux   *http.ServeMux
}

func New(repository *store.Store) http.Handler {
	h := &Handler{store: repository, mux: http.NewServeMux()}
	h.mux.HandleFunc("GET /healthz", h.health)
	h.mux.HandleFunc("GET /v1/racing/sessions", h.sessions)
	h.mux.HandleFunc("GET /v1/racing/sessions/{id}", h.session)
	h.mux.HandleFunc("GET /v1/racing/sessions/{id}/memory", h.memory)
	h.mux.HandleFunc("GET /v1/racing/artifacts/{id}/{name}", h.artifact)
	return h
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	h.mux.ServeHTTP(w, r)
}

func (h *Handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) sessions(w http.ResponseWriter, _ *http.Request) {
	values, err := h.store.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	for i := range values {
		values[i] = publicSession(values[i])
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": values})
}

func (h *Handler) session(w http.ResponseWriter, r *http.Request) {
	value, err := h.store.Load(r.PathValue("id"))
	if err != nil {
		status := http.StatusInternalServerError
		if os.IsNotExist(err) {
			status = http.StatusNotFound
		}
		writeError(w, status, err)
		return
	}
	writeJSON(w, http.StatusOK, publicSession(value))
}

func (h *Handler) memory(w http.ResponseWriter, r *http.Request) {
	value, err := h.store.Load(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	public := publicSession(value)
	writeJSON(w, http.StatusOK, map[string]any{
		"session_id": public.ID, "state": public.State, "highlights": public.Highlights, "artifacts": public.Artifacts,
	})
}

func (h *Handler) artifact(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" || filepath.Base(name) != name || strings.HasPrefix(name, ".") {
		writeError(w, http.StatusBadRequest, os.ErrInvalid)
		return
	}
	dir, err := h.store.SessionDir(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	path := filepath.Join(dir, "artifacts", name)
	if _, err := os.Stat(path); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(name, `"`, "")+`"`)
	http.ServeFile(w, r, path)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"message": err.Error()}})
}

func publicSession(value model.Session) model.Session {
	value.Highlights = append([]model.Highlight(nil), value.Highlights...)
	for i := range value.Highlights {
		value.Highlights[i].SourceClip = ""
	}
	return value
}
