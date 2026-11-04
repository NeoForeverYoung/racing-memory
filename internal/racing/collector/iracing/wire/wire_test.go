package wire

import (
	"encoding/binary"
	"math"
	"testing"
)

func TestParseHeaderLayoutAndFrame(t *testing.T) {
	data := make([]byte, 144+2*VarHeaderSize)
	put32(data, 0, HeaderVersion)
	put32(data, 8, 60)
	put32(data, 16, 16)
	put32(data, 20, 500)
	put32(data, 24, 2)
	put32(data, 28, 144)
	put32(data, 32, 1)
	put32(data, 36, 16)
	put32(data, 48, 10)
	put32(data, 52, 1024)
	writeVariable(data[144:144+VarHeaderSize], TypeDouble, 0, 1, "SessionTime", "s")
	writeVariable(data[144+VarHeaderSize:], TypeInt, 8, 2, "CarIdxPosition", "")

	header, err := ParseHeader(data)
	if err != nil {
		t.Fatal(err)
	}
	layout, err := ParseLayout(data, header)
	if err != nil {
		t.Fatal(err)
	}
	row := make([]byte, 16)
	binary.LittleEndian.PutUint64(row[0:8], math.Float64bits(12.5))
	put32(row, 8, 3)
	put32(row, 12, 7)
	frame := Frame{Layout: layout, Data: row}
	if got, ok := frame.Float("SessionTime"); !ok || got != 12.5 {
		t.Fatalf("SessionTime = %v, %v", got, ok)
	}
	if got, ok := frame.IntAt("CarIdxPosition", 1); !ok || got != 7 {
		t.Fatalf("CarIdxPosition[1] = %v, %v", got, ok)
	}
}

func TestParseLayoutRejectsOutOfBoundsVariable(t *testing.T) {
	data := make([]byte, 144+VarHeaderSize)
	put32(data, 0, HeaderVersion)
	put32(data, 8, 60)
	put32(data, 24, 1)
	put32(data, 28, 144)
	put32(data, 32, 1)
	put32(data, 36, 8)
	writeVariable(data[144:], TypeDouble, 4, 1, "Bad", "")
	header, err := ParseHeader(data)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseLayout(data, header); err == nil {
		t.Fatal("expected row bounds error")
	}
}

func TestCountAsTimeArraySupports360HzSubSamples(t *testing.T) {
	data := make([]byte, 144+VarHeaderSize)
	put32(data, 0, HeaderVersion)
	put32(data, 8, 60)
	put32(data, 24, 1)
	put32(data, 28, 144)
	put32(data, 32, 1)
	put32(data, 36, 24)
	writeVariable(data[144:], TypeFloat, 0, 6, "Brake_ST", "%")
	data[144+12] = 1
	header, err := ParseHeader(data)
	if err != nil {
		t.Fatal(err)
	}
	layout, err := ParseLayout(data, header)
	if err != nil {
		t.Fatal(err)
	}
	row := make([]byte, 24)
	binary.LittleEndian.PutUint32(row[20:24], math.Float32bits(0.75))
	value, ok := (Frame{Layout: layout, Data: row}).FloatAt("Brake_ST", 5)
	if !ok || value != 0.75 || !layout.Variables[0].CountAsTime {
		t.Fatalf("subsample = %v, %v; variable=%+v", value, ok, layout.Variables[0])
	}
}

func FuzzParseHeader(f *testing.F) {
	f.Add(make([]byte, HeaderSize))
	f.Fuzz(func(t *testing.T, data []byte) {
		_, _ = ParseHeader(data)
	})
}

func writeVariable(raw []byte, typ VarType, offset, count int, name, unit string) {
	put32(raw, 0, int(typ))
	put32(raw, 4, offset)
	put32(raw, 8, count)
	copy(raw[16:48], name)
	copy(raw[112:144], unit)
}

func put32(data []byte, offset, value int) {
	binary.LittleEndian.PutUint32(data[offset:offset+4], uint32(value))
}
