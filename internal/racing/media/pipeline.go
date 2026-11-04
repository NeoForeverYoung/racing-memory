// Package media creates deterministic highlight reels and still images with FFmpeg.
package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

type Runner interface {
	Run(context.Context, string, ...string) ([]byte, error)
}

type ExecRunner struct{}

func (ExecRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("%s failed: %w: %s", name, err, strings.TrimSpace(stderr.String()))
	}
	return out, nil
}

type Pipeline struct {
	Runner        Runner
	FFmpeg        string
	FFprobe       string
	MaxHighlights int
}

func (p Pipeline) Generate(ctx context.Context, input string, value model.Session, dir string) (model.ArtifactSet, error) {
	if p.Runner == nil {
		p.Runner = ExecRunner{}
	}
	if p.FFmpeg == "" {
		p.FFmpeg = "ffmpeg"
	}
	if p.FFprobe == "" {
		p.FFprobe = "ffprobe"
	}
	if p.MaxHighlights <= 0 {
		p.MaxHighlights = 12
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return model.ArtifactSet{}, err
	}
	highlights := selectHighlights(value.Highlights, p.MaxHighlights)
	if len(highlights) == 0 {
		return model.ArtifactSet{}, errors.New("no highlights are available")
	}

	var clips, images []string
	for i, highlight := range highlights {
		source := input
		if highlight.SourceClip != "" {
			source = highlight.SourceClip
		}
		if source == "" {
			return model.ArtifactSet{}, fmt.Errorf("highlight %s has no video input", highlight.ID)
		}
		duration, err := p.probe(ctx, source)
		if err != nil {
			return model.ArtifactSet{}, err
		}
		clip := filepath.Join(dir, fmt.Sprintf("clip-%02d.mp4", i+1))
		start, length, stillAt := clampWindow(highlight, duration, highlight.SourceClip != "")
		overlay := filepath.Join(dir, fmt.Sprintf("overlay-%02d.png", i+1))
		if err := writeOverlay(overlay, value, highlight); err != nil {
			return model.ArtifactSet{}, err
		}
		args := []string{
			"-hide_banner", "-loglevel", "error", "-y", "-ss", seconds(start), "-i", source,
			"-i", overlay, "-t", seconds(length), "-filter_complex", "[0:v][1:v]overlay=32:32[v]",
			"-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
			"-c:a", "aac", "-movflags", "+faststart", clip,
		}
		if _, err := p.Runner.Run(ctx, p.FFmpeg, args...); err != nil {
			return model.ArtifactSet{}, err
		}
		clips = append(clips, clip)
		imagePath := filepath.Join(dir, fmt.Sprintf("highlight-%02d.jpg", i+1))
		if _, err := p.Runner.Run(ctx, p.FFmpeg,
			"-hide_banner", "-loglevel", "error", "-y", "-ss", seconds(stillAt),
			"-i", source, "-frames:v", "1", "-q:v", "2", imagePath,
		); err != nil {
			return model.ArtifactSet{}, err
		}
		images = append(images, filepath.Base(imagePath))
	}

	listPath := filepath.Join(dir, "clips.txt")
	var list strings.Builder
	for _, clip := range clips {
		absolute, err := filepath.Abs(clip)
		if err != nil {
			return model.ArtifactSet{}, err
		}
		fmt.Fprintf(&list, "file '%s'\n", strings.ReplaceAll(absolute, "'", "'\\''"))
	}
	if err := os.WriteFile(listPath, []byte(list.String()), 0o644); err != nil {
		return model.ArtifactSet{}, err
	}
	video := filepath.Join(dir, "highlights.mp4")
	if _, err := p.Runner.Run(ctx, p.FFmpeg,
		"-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
		"-i", listPath, "-c", "copy", "-movflags", "+faststart", video,
	); err != nil {
		return model.ArtifactSet{}, err
	}
	if _, err := p.probe(ctx, video); err != nil {
		return model.ArtifactSet{}, fmt.Errorf("generated video verification failed: %w", err)
	}
	return model.ArtifactSet{Status: "ready", Video: filepath.Base(video), Images: images}, nil
}

func (p Pipeline) probe(ctx context.Context, input string) (time.Duration, error) {
	out, err := p.Runner.Run(ctx, p.FFprobe, "-v", "error", "-show_entries", "format=duration", "-of", "json", input)
	if err != nil {
		return 0, err
	}
	var payload struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &payload); err != nil {
		return 0, err
	}
	seconds, err := strconv.ParseFloat(payload.Format.Duration, 64)
	if err != nil || seconds <= 0 {
		return 0, errors.New("ffprobe returned an invalid duration")
	}
	return time.Duration(seconds * float64(time.Second)), nil
}

func selectHighlights(values []model.Highlight, limit int) []model.Highlight {
	out := append([]model.Highlight(nil), values...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	if len(out) > limit {
		out = out[:limit]
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At < out[j].At })
	return out
}

func clampWindow(value model.Highlight, duration time.Duration, replayBuffer bool) (time.Duration, time.Duration, time.Duration) {
	if replayBuffer {
		length := value.WindowEnd - value.WindowStart
		if length <= 0 || length > duration {
			length = minDuration(17*time.Second, duration)
		}
		start := duration - length
		still := duration - minDuration(2*time.Second, duration/2)
		return start, length, still
	}
	start, end := value.WindowStart, value.WindowEnd
	if start < 0 {
		start = 0
	}
	if end <= start {
		end = start + 10*time.Second
	}
	if end > duration {
		end = duration
	}
	still := value.At
	if still >= duration {
		still = duration - minDuration(time.Second, duration/2)
	}
	return start, end - start, still
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}

func seconds(value time.Duration) string {
	return strconv.FormatFloat(value.Seconds(), 'f', 3, 64)
}

func writeOverlay(path string, value model.Session, highlight model.Highlight) error {
	img := image.NewRGBA(image.Rect(0, 0, 540, 70))
	draw.Draw(img, img.Bounds(), image.NewUniform(color.RGBA{0, 0, 0, 175}), image.Point{}, draw.Src)
	text := fmt.Sprintf("%s / %s / %s", value.Track, value.Car, highlight.Kind)
	parsed, err := opentype.Parse(gobold.TTF)
	if err != nil {
		return err
	}
	face, err := opentype.NewFace(parsed, &opentype.FaceOptions{Size: 22, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		return err
	}
	defer face.Close()
	drawer := font.Drawer{
		Dst: img, Src: image.NewUniform(color.White), Face: face, Dot: fixed.P(20, 43),
	}
	drawer.DrawString(text)
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return png.Encode(file, img)
}
