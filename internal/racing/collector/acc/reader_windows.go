//go:build windows

package acc

import (
	"context"
	"errors"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowsReader struct {
	graphics mapping
	physics  mapping
	static   mapping
}

type mapping struct {
	handle windows.Handle
	view   uintptr
	size   uintptr
}

var openFileMappingW = windows.NewLazySystemDLL("kernel32.dll").NewProc("OpenFileMappingW")

type graphicsPage struct {
	PacketID              int32
	Status                int32
	Session               int32
	CurrentTime           [15]uint16
	LastTime              [15]uint16
	BestTime              [15]uint16
	Split                 [15]uint16
	CompletedLaps         int32
	Position              int32
	CurrentLapMS          int32
	LastLapMS             int32
	BestLapMS             int32
	SessionTimeLeft       float32
	DistanceTraveled      float32
	IsInPit               int32
	CurrentSectorIndex    int32
	LastSectorTime        int32
	NumberOfLaps          int32
	TyreCompound          [33]uint16
	ReplayTimeMultiplier  float32
	NormalizedCarPosition float32
}

type physicsPage struct {
	PacketID   int32
	Gas        float32
	Brake      float32
	Fuel       float32
	Gear       int32
	RPM        int32
	SteerAngle float32
	SpeedKPH   float32
}

type staticPage struct {
	SMVersion        [15]uint16
	ACVersion        [15]uint16
	NumberOfSessions int32
	NumCars          int32
	CarModel         [33]uint16
	Track            [33]uint16
	PlayerName       [33]uint16
	PlayerSurname    [33]uint16
	PlayerNick       [33]uint16
}

func NewReader() (Reader, error) {
	graphics, err := openMapping(`Local\acpmf_graphics`, unsafe.Sizeof(graphicsPage{}))
	if err != nil {
		return nil, err
	}
	physics, err := openMapping(`Local\acpmf_physics`, unsafe.Sizeof(physicsPage{}))
	if err != nil {
		graphics.close()
		return nil, err
	}
	static, err := openMapping(`Local\acpmf_static`, unsafe.Sizeof(staticPage{}))
	if err != nil {
		graphics.close()
		physics.close()
		return nil, err
	}
	return &windowsReader{graphics: graphics, physics: physics, static: static}, nil
}

func (r *windowsReader) Read(ctx context.Context) (Snapshot, error) {
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	if r.graphics.view == 0 || r.physics.view == 0 || r.static.view == 0 {
		return Snapshot{}, errors.New("ACC shared memory is closed")
	}
	g := *(*graphicsPage)(unsafe.Pointer(r.graphics.view))
	p := *(*physicsPage)(unsafe.Pointer(r.physics.view))
	s := *(*staticPage)(unsafe.Pointer(r.static.view))
	return Snapshot{
		At: nowUTC(), PacketID: g.PacketID, Status: g.Status, Session: g.Session,
		CompletedLaps: g.CompletedLaps, Position: g.Position, CurrentLapMS: g.CurrentLapMS,
		LastLapMS: g.LastLapMS, BestLapMS: g.BestLapMS, SessionTime: durationFromMS(g.CurrentLapMS),
		SpeedKPH: p.SpeedKPH, RPM: p.RPM, Gear: p.Gear, Throttle: p.Gas, Brake: p.Brake,
		Car: utf16String(s.CarModel[:]), Track: utf16String(s.Track[:]),
		Driver: joinName(utf16String(s.PlayerName[:]), utf16String(s.PlayerSurname[:])),
	}, nil
}

func (r *windowsReader) Close() error {
	r.graphics.close()
	r.physics.close()
	r.static.close()
	return nil
}

func openMapping(name string, size uintptr) (mapping, error) {
	ptr, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return mapping{}, err
	}
	rawHandle, _, callErr := openFileMappingW.Call(
		uintptr(windows.FILE_MAP_READ),
		0,
		uintptr(unsafe.Pointer(ptr)),
	)
	if rawHandle == 0 {
		return mapping{}, callErr
	}
	handle := windows.Handle(rawHandle)
	view, err := windows.MapViewOfFile(handle, windows.FILE_MAP_READ, 0, 0, size)
	if err != nil {
		windows.CloseHandle(handle)
		return mapping{}, err
	}
	return mapping{handle: handle, view: view, size: size}, nil
}

func (m *mapping) close() {
	if m.view != 0 {
		_ = windows.UnmapViewOfFile(m.view)
		m.view = 0
	}
	if m.handle != 0 {
		_ = windows.CloseHandle(m.handle)
		m.handle = 0
	}
}

func utf16String(value []uint16) string {
	for i, v := range value {
		if v == 0 {
			value = value[:i]
			break
		}
	}
	return string(utf16.Decode(value))
}
