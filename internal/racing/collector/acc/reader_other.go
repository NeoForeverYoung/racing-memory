//go:build !windows

package acc

import "errors"

func NewReader() (Reader, error) {
	return nil, errors.New("ACC shared memory is only available on Windows; use a FixtureReader for tests")
}
