// Package ibt imports iRacing telemetry files on every Go-supported platform.
package ibt

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/NeoForeverYoung/racing-memory/internal/racing/collector/iracing"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/collector/iracing/wire"
	"github.com/NeoForeverYoung/racing-memory/internal/racing/session"
)

type Source struct {
	file       *os.File
	size       int64
	Header     wire.Header
	Disk       wire.DiskSubHeader
	Layout     wire.Layout
	SessionRaw []byte
	Info       iracing.SessionInfo
	rowOffset  int64
	records    int
}

func Open(path string) (*Source, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	source, err := parse(file, info.Size())
	if err != nil {
		file.Close()
		return nil, err
	}
	source.file = file
	return source, nil
}

func parse(reader io.ReaderAt, size int64) (*Source, error) {
	if size < wire.HeaderSize+wire.DiskSubHeaderSize {
		return nil, errors.New("ibt file is shorter than its headers")
	}
	headerRaw := make([]byte, wire.HeaderSize)
	if _, err := reader.ReadAt(headerRaw, 0); err != nil {
		return nil, err
	}
	header, err := wire.ParseHeader(headerRaw)
	if err != nil {
		return nil, err
	}
	diskRaw := make([]byte, wire.DiskSubHeaderSize)
	if _, err := reader.ReadAt(diskRaw, wire.HeaderSize); err != nil {
		return nil, err
	}
	disk, err := wire.ParseDiskSubHeader(diskRaw)
	if err != nil {
		return nil, err
	}
	layoutEnd := int64(header.VarHeaderOffset) + int64(header.NumVars)*wire.VarHeaderSize
	if layoutEnd < 0 || layoutEnd > size {
		return nil, errors.New("ibt variable headers exceed file bounds")
	}
	layoutRaw := make([]byte, layoutEnd)
	if _, err := reader.ReadAt(layoutRaw, 0); err != nil {
		return nil, err
	}
	layout, err := wire.ParseLayout(layoutRaw, header)
	if err != nil {
		return nil, err
	}
	infoStart, infoLen := int64(header.SessionInfoOffset), int64(header.SessionInfoLen)
	if infoStart < 0 || infoLen < 0 || infoStart > size || infoLen > size-infoStart {
		return nil, errors.New("ibt SessionInfo exceeds file bounds")
	}
	sessionRaw := make([]byte, infoLen)
	if _, err := reader.ReadAt(sessionRaw, infoStart); err != nil {
		return nil, err
	}
	sessionRaw = bytes.TrimRight(sessionRaw, "\x00")
	sessionInfo, err := iracing.ParseSessionInfo(sessionRaw)
	if err != nil {
		return nil, err
	}
	rowOffset := int64(header.Buffers[0].Offset)
	if rowOffset < 0 || rowOffset > size {
		return nil, errors.New("ibt telemetry row offset exceeds file bounds")
	}
	available := int((size - rowOffset) / int64(header.BufferLen))
	records := int(disk.SessionRecords)
	if records < 0 {
		return nil, errors.New("ibt has a negative record count")
	}
	if records == 0 || records > available {
		records = available
	}
	return &Source{
		size: size, Header: header, Disk: disk, Layout: layout, SessionRaw: sessionRaw,
		Info: sessionInfo, rowOffset: rowOffset, records: records,
	}, nil
}

func (s *Source) Close() error {
	if s.file == nil {
		return nil
	}
	return s.file.Close()
}

func (s *Source) Records() int { return s.records }

func (s *Source) Frame(index int) (wire.Frame, error) {
	if index < 0 || index >= s.records {
		return wire.Frame{}, fmt.Errorf("ibt record %d outside 0..%d", index, s.records-1)
	}
	row := make([]byte, s.Header.BufferLen)
	offset := s.rowOffset + int64(index)*int64(s.Header.BufferLen)
	if _, err := s.file.ReadAt(row, offset); err != nil {
		return wire.Frame{}, err
	}
	return wire.Frame{Layout: s.Layout, Data: row}, nil
}

func (s *Source) Emit(emit func(session.Event) error) error {
	projector := iracing.NewProjector("iracing-ibt")
	base := time.Unix(s.Disk.SessionStartUnix, 0).UTC()
	if s.Disk.SessionStartUnix <= 0 {
		base = time.Unix(0, 0).UTC()
	}
	for i := 0; i < s.records; i++ {
		frame, err := s.Frame(i)
		if err != nil {
			return err
		}
		seconds, _ := frame.Float("SessionTime")
		at := base.Add(time.Duration(seconds * float64(time.Second)))
		events, err := projector.Process(frame, s.Info, at)
		if err != nil {
			return err
		}
		for _, event := range events {
			if err := emit(event); err != nil {
				return err
			}
		}
	}
	endAt := base.Add(time.Duration(s.Disk.SessionEndTime * float64(time.Second)))
	completed := s.Disk.SessionEndTime > s.Disk.SessionStartTime
	for _, event := range projector.End(endAt, s.Info, completed) {
		if err := emit(event); err != nil {
			return err
		}
	}
	return nil
}
