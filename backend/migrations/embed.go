// Package migrations holds reviewed schema files. It never runs migrations on HTTP requests.
package migrations

import _ "embed"

//go:embed 001_initial.sql
var Initial string
