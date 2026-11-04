//go:build !windows

package iracing

import "errors"

func NewReader() (Reader, error) {
	return nil, errors.New("live iRacing telemetry requires Windows; import a .ibt file on this platform")
}
