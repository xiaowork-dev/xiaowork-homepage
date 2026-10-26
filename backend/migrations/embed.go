// Package migrations holds reviewed schema files. It never runs migrations on HTTP requests.
package migrations

import _ "embed"

//go:embed 001_initial.sql
var Initial string

//go:embed 002_content_history.sql
var ContentHistory string

// All is ordered and append-only; applied migration bytes must not change.
var All = []string{Initial, ContentHistory}
