// Package report renders portable race scorecards without a browser runtime.
package report

import (
	"encoding/json"
	"fmt"
	"html/template"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/model"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

type Renderer struct{}

func (Renderer) Generate(value model.Session, dir string) (model.ArtifactSet, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return model.ArtifactSet{}, err
	}
	artifacts := model.ArtifactSet{
		Status: "processing", ReportJSON: "report.json", ReportHTML: "scorecard.html", Scorecard: "scorecard.png",
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return artifacts, err
	}
	if err := os.WriteFile(filepath.Join(dir, artifacts.ReportJSON), append(raw, '\n'), 0o644); err != nil {
		return artifacts, err
	}
	if err := renderHTML(value, filepath.Join(dir, artifacts.ReportHTML)); err != nil {
		return artifacts, err
	}
	if err := renderPNG(value, filepath.Join(dir, artifacts.Scorecard)); err != nil {
		return artifacts, err
	}
	return artifacts, nil
}

var scorecardTemplate = template.Must(template.New("scorecard").Funcs(template.FuncMap{
	"duration": formatDuration,
}).Parse(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>{{.Track}} · 赛车回忆</title>
<style>
body{margin:0;background:#0b0e14;color:#f4f6fb;font:16px system-ui}main{max-width:720px;margin:40px auto;padding:36px;background:#151b26;border-radius:24px}
h1{font-size:40px;margin:0 0 8px}.meta{color:#9ba7b8}.hero{font-size:64px;font-weight:800;color:#ff4d43;margin:36px 0}
table{width:100%;border-collapse:collapse}td,th{padding:12px;border-bottom:1px solid #2a3343;text-align:left}
</style><main><p class="meta">{{.Game}} · {{.SessionKind}} · {{.Car}} {{.CarNumber}}</p><h1>{{.Track}}</h1>
{{with .BestLap}}<div class="hero">{{duration .Time}}</div>{{end}}
<p>车手 {{.Driver}} · 最终位置 P{{.Position}} / 组别 P{{.ClassPosition}} · 事故 {{.Incidents}}x · {{len .Laps}} 圈</p>
<table><tr><th>圈次</th><th>圈速</th><th>位置</th></tr>{{range .Laps}}
<tr><td>{{.Number}}</td><td>{{duration .Time}}</td><td>P{{.Position}}</td></tr>{{end}}</table>
{{if .Classification}}<h2>最终排名</h2><table><tr><th>位置</th><th>车手</th><th>车辆</th><th>最佳圈</th></tr>
{{range .Classification}}<tr><td>P{{.Position}} / C{{.ClassPosition}}</td><td>{{.Driver}}</td><td>{{.Car}} #{{.CarNumber}}</td><td>{{duration .BestLap}}</td></tr>{{end}}</table>{{end}}
</main></html>`))

type view struct {
	model.Session
	BestLap *model.Lap
}

func renderHTML(value model.Session, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	v := view{Session: value}
	if best, ok := value.BestLap(); ok {
		v.BestLap = &best
	}
	return scorecardTemplate.Execute(f, v)
}

func renderPNG(value model.Session, path string) error {
	const width, height = 1200, 1600
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.RGBA{11, 14, 20, 255}}, image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(64, 64, width-64, height-64), &image.Uniform{C: color.RGBA{21, 27, 38, 255}}, image.Point{}, draw.Src)
	regular, err := newFace(goregular.TTF, 28)
	if err != nil {
		return err
	}
	defer regular.Close()
	bold, err := newFace(gobold.TTF, 48)
	if err != nil {
		return err
	}
	defer bold.Close()
	write := func(face font.Face, x, y int, c color.Color, text string) {
		drawer := font.Drawer{Dst: img, Src: image.NewUniform(c), Face: face, Dot: fixed.P(x, y)}
		drawer.DrawString(text)
	}
	white := color.RGBA{244, 246, 251, 255}
	muted := color.RGBA{155, 167, 184, 255}
	accent := color.RGBA{255, 77, 67, 255}
	write(regular, 110, 150, muted, fmt.Sprintf("%s  /  %s  /  %s #%s", value.Game, value.SessionKind, value.Car, value.CarNumber))
	write(bold, 110, 230, white, value.Track)
	write(regular, 110, 290, white, "DRIVER  "+value.Driver)
	if best, ok := value.BestLap(); ok {
		write(bold, 110, 410, accent, "BEST LAP  "+formatDuration(best.Time))
	}
	write(regular, 110, 490, white, fmt.Sprintf("POSITION P%d  CLASS P%d  LAPS %d  INCIDENTS %dx", value.Position, value.ClassPosition, len(value.Laps), value.Incidents))
	y := 590
	write(regular, 110, y, muted, "LAP        TIME             POSITION")
	for _, lap := range value.Laps {
		y += 58
		if y > 1450 {
			break
		}
		write(regular, 110, y, white, fmt.Sprintf("%-10d %-16s P%d", lap.Number, formatDuration(lap.Time), lap.Position))
	}
	if len(value.Classification) > 0 && y < 1250 {
		y += 90
		write(regular, 110, y, muted, "FINAL CLASSIFICATION")
		for _, standing := range value.Classification {
			y += 46
			if y > 1450 {
				break
			}
			write(regular, 110, y, white, fmt.Sprintf("P%-3d C%-3d %-18s #%s", standing.Position, standing.ClassPosition, standing.Driver, standing.CarNumber))
		}
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, img)
}

func newFace(data []byte, size float64) (font.Face, error) {
	parsed, err := opentype.Parse(data)
	if err != nil {
		return nil, err
	}
	return opentype.NewFace(parsed, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingFull})
}

func formatDuration(value time.Duration) string {
	minutes := int(value.Minutes())
	seconds := value - time.Duration(minutes)*time.Minute
	return fmt.Sprintf("%d:%06.3f", minutes, seconds.Seconds())
}
