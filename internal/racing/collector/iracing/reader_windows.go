//go:build windows

package iracing

import (
	"bytes"
	"context"
	"errors"
	"time"
	"unsafe"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/collector/iracing/wire"
	"golang.org/x/sys/windows"
)

const (
	memoryName     = `Local\IRSDKMemMapFileName`
	eventName      = `Local\IRSDKDataValidEvent`
	synchronize    = 0x00100000
	waitTimeout    = 258
	maxMappingRead = 64 << 20
)

var (
	kernel32            = windows.NewLazySystemDLL("kernel32.dll")
	openFileMappingW    = kernel32.NewProc("OpenFileMappingW")
	openEventW          = kernel32.NewProc("OpenEventW")
	waitForSingleObject = kernel32.NewProc("WaitForSingleObject")
)

type windowsReader struct {
	mapping   windows.Handle
	event     windows.Handle
	view      uintptr
	layout    wire.Layout
	layoutKey [4]int32
}

func NewReader() (Reader, error) { return &windowsReader{}, nil }

func (r *windowsReader) Read(ctx context.Context) (Snapshot, error) {
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	if err := r.ensureOpen(); err != nil {
		return Snapshot{}, err
	}
	result, _, callErr := waitForSingleObject.Call(uintptr(r.event), 250)
	if result == waitTimeout {
		return Snapshot{}, ErrNoData
	}
	if result != 0 {
		r.closeHandles()
		_ = callErr
		return Snapshot{}, ErrNotConnected
	}
	headerRaw := append([]byte(nil), memoryBytes(r.view, wire.HeaderSize)...)
	header, err := wire.ParseHeader(headerRaw)
	if err != nil || !header.Connected() {
		r.closeHandles()
		return Snapshot{}, ErrNotConnected
	}
	layoutKey := [4]int32{header.Version, header.NumVars, header.VarHeaderOffset, header.BufferLen}
	if layoutKey != r.layoutKey {
		layoutEnd := int(header.VarHeaderOffset) + int(header.NumVars)*wire.VarHeaderSize
		if layoutEnd < wire.HeaderSize || layoutEnd > maxMappingRead {
			return Snapshot{}, errors.New("iRacing variable layout exceeds safety limit")
		}
		layoutRaw := append([]byte(nil), memoryBytes(r.view, layoutEnd)...)
		layout, parseErr := wire.ParseLayout(layoutRaw, header)
		if parseErr != nil {
			return Snapshot{}, parseErr
		}
		r.layout, r.layoutKey = layout, layoutKey
	}
	var sessionRaw []byte
	for attempt := 0; attempt < 2; attempt++ {
		updateBefore := int32Value(r.view, 12)
		start, length := int(header.SessionInfoOffset), int(header.SessionInfoLen)
		if start < 0 || length < 0 || start > maxMappingRead || length > maxMappingRead-start {
			return Snapshot{}, errors.New("iRacing SessionInfo exceeds safety limit")
		}
		sessionRaw = append(sessionRaw[:0], memoryBytes(r.view+uintptr(start), length)...)
		if updateBefore == int32Value(r.view, 12) {
			break
		}
		if attempt == 1 {
			return Snapshot{}, errors.New("iRacing SessionInfo changed while reading")
		}
	}
	sessionRaw = bytes.TrimRight(sessionRaw, "\x00")
	index := latestBuffer(header)
	rowOffset := int(header.Buffers[index].Offset)
	if rowOffset < 0 || rowOffset > maxMappingRead || int(header.BufferLen) > maxMappingRead-rowOffset {
		return Snapshot{}, errors.New("iRacing telemetry buffer exceeds safety limit")
	}
	var row []byte
	for attempt := 0; attempt < 3; attempt++ {
		tickBefore := int32Value(r.view, 48+index*16)
		row = append(row[:0], memoryBytes(r.view+uintptr(rowOffset), int(header.BufferLen))...)
		if tickBefore == int32Value(r.view, 48+index*16) {
			return Snapshot{
				At: time.Now().UTC(), Header: header, Layout: r.layout, SessionRaw: sessionRaw,
				Frame: wire.Frame{Layout: r.layout, Data: row},
			}, nil
		}
	}
	return Snapshot{}, errors.New("iRacing telemetry buffer changed while reading")
}

func (r *windowsReader) ensureOpen() error {
	if r.view != 0 && r.event != 0 {
		return nil
	}
	name, _ := windows.UTF16PtrFromString(memoryName)
	handle, _, _ := openFileMappingW.Call(uintptr(windows.FILE_MAP_READ), 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		return ErrNotConnected
	}
	view, mapErr := windows.MapViewOfFile(windows.Handle(handle), windows.FILE_MAP_READ, 0, 0, 0)
	if mapErr != nil {
		windows.CloseHandle(windows.Handle(handle))
		return ErrNotConnected
	}
	eventPtr, _ := windows.UTF16PtrFromString(eventName)
	event, _, eventErr := openEventW.Call(synchronize, 0, uintptr(unsafe.Pointer(eventPtr)))
	if event == 0 {
		windows.UnmapViewOfFile(view)
		windows.CloseHandle(windows.Handle(handle))
		_ = eventErr
		return ErrNotConnected
	}
	r.mapping, r.view, r.event = windows.Handle(handle), view, windows.Handle(event)
	return nil
}

func (r *windowsReader) Close() error {
	r.closeHandles()
	return nil
}

func (r *windowsReader) closeHandles() {
	if r.view != 0 {
		_ = windows.UnmapViewOfFile(r.view)
		r.view = 0
	}
	if r.mapping != 0 {
		_ = windows.CloseHandle(r.mapping)
		r.mapping = 0
	}
	if r.event != 0 {
		_ = windows.CloseHandle(r.event)
		r.event = 0
	}
	r.layoutKey = [4]int32{}
}

func latestBuffer(header wire.Header) int {
	index := 0
	for i := 1; i < int(header.NumBuffers); i++ {
		if header.Buffers[i].TickCount > header.Buffers[index].TickCount {
			index = i
		}
	}
	return index
}

func memoryBytes(address uintptr, length int) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(address)), length)
}

func int32Value(address uintptr, offset int) int32 {
	raw := memoryBytes(address+uintptr(offset), 4)
	return int32(uint32(raw[0]) | uint32(raw[1])<<8 | uint32(raw[2])<<16 | uint32(raw[3])<<24)
}
