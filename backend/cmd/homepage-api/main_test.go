package main

import "testing"

func TestPublishModeResolution(t *testing.T) {
	for _, c := range []struct{ mode, legacy, want string }{
		{"", "", "off"}, {"", "0", "off"}, {"", "1", "local"},
		{"off", "0", "off"}, {"local", "1", "local"}, {"production", "0", "production"}, {"production", "", "production"},
	} {
		got, err := publishMode(c.mode, c.legacy)
		if err != nil || got != c.want {
			t.Fatalf("publishMode(%q,%q)=%q,%v want %q", c.mode, c.legacy, got, err, c.want)
		}
	}
	for _, c := range []struct{ mode, legacy string }{
		{"production", "1"}, {"off", "1"}, {"enabled", ""}, {"", "yes"}, {"PRODUCTION", "0"},
	} {
		if _, err := publishMode(c.mode, c.legacy); err == nil {
			t.Fatalf("publishMode(%q,%q) must refuse", c.mode, c.legacy)
		}
	}
}
