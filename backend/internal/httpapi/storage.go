package httpapi

import (
	"context"
	"path/filepath"
	"sync"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/storagehealth"
)

type storageReport struct {
	State                       string               `json:"state"`
	Areas                       []storagehealth.Area `json:"areas"`
	MinimumFreeBytes            uint64               `json:"minimumFreeBytes"`
	WarningFreeBytes            uint64               `json:"warningFreeBytes"`
	UsageSampledAt              string               `json:"usageSampledAt"`
	HistoricalResourcesRetained bool                 `json:"historicalResourcesRetained"`
}
type storageObservation struct {
	mu          sync.Mutex
	databaseDir string
	at          time.Time
	usage       map[string]storagehealth.Area
}

func (a *App) storageDirectories() map[string]string {
	areas := map[string]string{"uploads": a.config.UploadDir}
	if a.storage.databaseDir != "" {
		areas["database"] = a.storage.databaseDir
	}
	if a.config.PublicationsDir != "" {
		areas["publications"] = a.config.PublicationsDir
	}
	return areas
}

func (a *App) observeStorage(ctx context.Context, usage bool) storageReport {
	report := storageReport{State: "ok", Areas: []storagehealth.Area{}, MinimumFreeBytes: storagehealth.MinimumFreeBytes, WarningFreeBytes: storagehealth.WarningFreeBytes, HistoricalResourcesRetained: true}
	directories := a.storageDirectories()
	a.storage.mu.Lock()
	defer a.storage.mu.Unlock()
	if usage && (a.storage.at.IsZero() || time.Since(a.storage.at) > time.Minute) {
		budget, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		a.storage.usage = map[string]storagehealth.Area{}
		for name, dir := range directories {
			n, files, complete := storagehealth.Measure(budget, dir)
			a.storage.usage[name] = storagehealth.Area{UsedBytes: n, Files: files, UsageComplete: complete}
		}
		a.storage.at = time.Now().UTC()
	}
	if !a.storage.at.IsZero() {
		report.UsageSampledAt = a.storage.at.Format(time.RFC3339)
	}
	for _, name := range []string{"database", "uploads", "publications"} {
		dir, ok := directories[name]
		if !ok {
			continue
		}
		area := storagehealth.Inspect(name, dir, storagehealth.MinimumFreeBytes)
		if u, ok := a.storage.usage[name]; ok {
			area.UsedBytes, area.Files, area.UsageComplete = u.UsedBytes, u.Files, u.UsageComplete
		}
		report.Areas = append(report.Areas, area)
		if !storagehealth.CanWrite(area) {
			report.State = "critical"
		} else if area.State == "warning" && report.State == "ok" {
			report.State = "warning"
		}
	}
	return report
}

func (a *App) initializeStorage(ctx context.Context) error {
	rows, err := a.db.QueryContext(ctx, "PRAGMA database_list")
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var sequence int
		var name, file string
		if err = rows.Scan(&sequence, &name, &file); err != nil {
			return err
		}
		if name == "main" && file != "" {
			a.storage.databaseDir = filepath.Dir(file)
		}
	}
	return rows.Err()
}
