// Package wire decodes the documented iRacing SDK v2 binary layout.
// It deliberately uses explicit offsets instead of Go struct overlays.
package wire

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"strings"
)

const (
	HeaderSize        = 112
	DiskSubHeaderSize = 32
	VarHeaderSize     = 144
	HeaderVersion     = 2
	MaxVariables      = 4096
	MaxBufferSize     = 16 << 20
)

type VarBuffer struct {
	TickCount int32
	Offset    int32
}

type Header struct {
	Version           int32
	Status            int32
	TickRate          int32
	SessionInfoUpdate int32
	SessionInfoLen    int32
	SessionInfoOffset int32
	NumVars           int32
	VarHeaderOffset   int32
	NumBuffers        int32
	BufferLen         int32
	Buffers           [4]VarBuffer
}

func (h Header) Connected() bool { return h.Status&1 != 0 }

type DiskSubHeader struct {
	SessionStartUnix int64
	SessionStartTime float64
	SessionEndTime   float64
	SessionLapCount  int32
	SessionRecords   int32
}

type VarType int32

const (
	TypeChar VarType = iota
	TypeBool
	TypeInt
	TypeBitField
	TypeFloat
	TypeDouble
)

func (t VarType) Size() (int, bool) {
	switch t {
	case TypeChar, TypeBool:
		return 1, true
	case TypeInt, TypeBitField, TypeFloat:
		return 4, true
	case TypeDouble:
		return 8, true
	default:
		return 0, false
	}
}

type Variable struct {
	Type        VarType
	Offset      int32
	Count       int32
	CountAsTime bool
	Name        string
	Description string
	Unit        string
}

type Layout struct {
	BufferLen int
	Variables []Variable
	byName    map[string]int
}

func ParseHeader(data []byte) (Header, error) {
	if len(data) < HeaderSize {
		return Header{}, errors.New("irsdk header is truncated")
	}
	h := Header{
		Version:           int32(binary.LittleEndian.Uint32(data[0:4])),
		Status:            int32(binary.LittleEndian.Uint32(data[4:8])),
		TickRate:          int32(binary.LittleEndian.Uint32(data[8:12])),
		SessionInfoUpdate: int32(binary.LittleEndian.Uint32(data[12:16])),
		SessionInfoLen:    int32(binary.LittleEndian.Uint32(data[16:20])),
		SessionInfoOffset: int32(binary.LittleEndian.Uint32(data[20:24])),
		NumVars:           int32(binary.LittleEndian.Uint32(data[24:28])),
		VarHeaderOffset:   int32(binary.LittleEndian.Uint32(data[28:32])),
		NumBuffers:        int32(binary.LittleEndian.Uint32(data[32:36])),
		BufferLen:         int32(binary.LittleEndian.Uint32(data[36:40])),
	}
	if h.Version != HeaderVersion {
		return Header{}, fmt.Errorf("unsupported irsdk header version %d", h.Version)
	}
	if h.TickRate <= 0 || h.TickRate > 10_000 {
		return Header{}, fmt.Errorf("invalid irsdk tick rate %d", h.TickRate)
	}
	if h.NumVars < 0 || h.NumVars > MaxVariables {
		return Header{}, fmt.Errorf("invalid irsdk variable count %d", h.NumVars)
	}
	if h.NumBuffers < 1 || h.NumBuffers > 4 {
		return Header{}, fmt.Errorf("invalid irsdk buffer count %d", h.NumBuffers)
	}
	if h.BufferLen <= 0 || h.BufferLen > MaxBufferSize {
		return Header{}, fmt.Errorf("invalid irsdk buffer length %d", h.BufferLen)
	}
	if h.SessionInfoLen < 0 || h.SessionInfoOffset < 0 || h.VarHeaderOffset < 0 {
		return Header{}, errors.New("negative irsdk offset or length")
	}
	for i := 0; i < 4; i++ {
		base := 48 + i*16
		h.Buffers[i] = VarBuffer{
			TickCount: int32(binary.LittleEndian.Uint32(data[base : base+4])),
			Offset:    int32(binary.LittleEndian.Uint32(data[base+4 : base+8])),
		}
		if i < int(h.NumBuffers) && h.Buffers[i].Offset < 0 {
			return Header{}, errors.New("negative telemetry buffer offset")
		}
	}
	return h, nil
}

func ParseDiskSubHeader(data []byte) (DiskSubHeader, error) {
	if len(data) < DiskSubHeaderSize {
		return DiskSubHeader{}, errors.New("irsdk disk subheader is truncated")
	}
	return DiskSubHeader{
		SessionStartUnix: int64(binary.LittleEndian.Uint64(data[0:8])),
		SessionStartTime: math.Float64frombits(binary.LittleEndian.Uint64(data[8:16])),
		SessionEndTime:   math.Float64frombits(binary.LittleEndian.Uint64(data[16:24])),
		SessionLapCount:  int32(binary.LittleEndian.Uint32(data[24:28])),
		SessionRecords:   int32(binary.LittleEndian.Uint32(data[28:32])),
	}, nil
}

func ParseLayout(data []byte, header Header) (Layout, error) {
	start := int(header.VarHeaderOffset)
	bytesNeeded, ok := checkedMul(int(header.NumVars), VarHeaderSize)
	if !ok || start > len(data) || bytesNeeded > len(data)-start {
		return Layout{}, errors.New("irsdk variable headers exceed source bounds")
	}
	layout := Layout{BufferLen: int(header.BufferLen), Variables: make([]Variable, 0, header.NumVars), byName: make(map[string]int)}
	for i := 0; i < int(header.NumVars); i++ {
		raw := data[start+i*VarHeaderSize : start+(i+1)*VarHeaderSize]
		v := Variable{
			Type:        VarType(int32(binary.LittleEndian.Uint32(raw[0:4]))),
			Offset:      int32(binary.LittleEndian.Uint32(raw[4:8])),
			Count:       int32(binary.LittleEndian.Uint32(raw[8:12])),
			CountAsTime: raw[12] != 0,
			Name:        cString(raw[16:48]),
			Description: cString(raw[48:112]),
			Unit:        cString(raw[112:144]),
		}
		size, validType := v.Type.Size()
		if !validType || v.Offset < 0 || v.Count <= 0 || v.Name == "" {
			return Layout{}, fmt.Errorf("invalid irsdk variable header %d", i)
		}
		width, ok := checkedMul(int(v.Count), size)
		if !ok || int(v.Offset) > layout.BufferLen || width > layout.BufferLen-int(v.Offset) {
			return Layout{}, fmt.Errorf("irsdk variable %q exceeds telemetry row", v.Name)
		}
		if _, exists := layout.byName[v.Name]; exists {
			return Layout{}, fmt.Errorf("duplicate irsdk variable %q", v.Name)
		}
		layout.byName[v.Name] = len(layout.Variables)
		layout.Variables = append(layout.Variables, v)
	}
	return layout, nil
}

func (l Layout) Variable(name string) (Variable, bool) {
	index, ok := l.byName[name]
	if !ok {
		return Variable{}, false
	}
	return l.Variables[index], true
}

type Frame struct {
	Layout Layout
	Data   []byte
}

func (f Frame) Float(name string) (float64, bool) {
	v, ok := f.Layout.Variable(name)
	if !ok || v.Count < 1 {
		return 0, false
	}
	raw, ok := f.element(v, 0)
	if !ok {
		return 0, false
	}
	switch v.Type {
	case TypeFloat:
		return float64(math.Float32frombits(binary.LittleEndian.Uint32(raw))), true
	case TypeDouble:
		return math.Float64frombits(binary.LittleEndian.Uint64(raw)), true
	case TypeInt, TypeBitField:
		return float64(int32(binary.LittleEndian.Uint32(raw))), true
	case TypeBool:
		if raw[0] != 0 {
			return 1, true
		}
		return 0, true
	default:
		return 0, false
	}
}

func (f Frame) Int(name string) (int64, bool) {
	v, ok := f.Layout.Variable(name)
	if !ok || v.Count < 1 {
		return 0, false
	}
	raw, ok := f.element(v, 0)
	if !ok {
		return 0, false
	}
	switch v.Type {
	case TypeInt, TypeBitField:
		return int64(int32(binary.LittleEndian.Uint32(raw))), true
	case TypeBool, TypeChar:
		return int64(raw[0]), true
	default:
		return 0, false
	}
}

func (f Frame) Bool(name string) (bool, bool) {
	value, ok := f.Int(name)
	return value != 0, ok
}

func (f Frame) IntAt(name string, index int) (int64, bool) {
	v, ok := f.Layout.Variable(name)
	if !ok || (v.Type != TypeInt && v.Type != TypeBitField && v.Type != TypeBool && v.Type != TypeChar) {
		return 0, false
	}
	raw, ok := f.element(v, index)
	if !ok {
		return 0, false
	}
	if v.Type == TypeInt || v.Type == TypeBitField {
		return int64(int32(binary.LittleEndian.Uint32(raw))), true
	}
	return int64(raw[0]), true
}

func (f Frame) FloatAt(name string, index int) (float64, bool) {
	v, ok := f.Layout.Variable(name)
	if !ok {
		return 0, false
	}
	raw, ok := f.element(v, index)
	if !ok {
		return 0, false
	}
	switch v.Type {
	case TypeFloat:
		return float64(math.Float32frombits(binary.LittleEndian.Uint32(raw))), true
	case TypeDouble:
		return math.Float64frombits(binary.LittleEndian.Uint64(raw)), true
	default:
		return 0, false
	}
}

func (f Frame) element(v Variable, index int) ([]byte, bool) {
	size, ok := v.Type.Size()
	if !ok || index < 0 || index >= int(v.Count) || len(f.Data) < f.Layout.BufferLen {
		return nil, false
	}
	start := int(v.Offset) + index*size
	if start < 0 || start > len(f.Data) || size > len(f.Data)-start {
		return nil, false
	}
	return f.Data[start : start+size], true
}

func cString(raw []byte) string {
	if index := strings.IndexByte(string(raw), 0); index >= 0 {
		raw = raw[:index]
	}
	return strings.TrimSpace(string(raw))
}

func checkedMul(a, b int) (int, bool) {
	if a < 0 || b < 0 || (a != 0 && b > math.MaxInt/a) {
		return 0, false
	}
	return a * b, true
}
