package obs

import "testing"

func TestAuthenticationVector(t *testing.T) {
	got := authentication("password", "salt", "challenge")
	const want = "zTM5ki6L2vVvBQiTG9ckH1Lh64AbnCf6XZ226UmnkIA="
	if got != want {
		t.Fatalf("authentication = %q, want %q", got, want)
	}
}
