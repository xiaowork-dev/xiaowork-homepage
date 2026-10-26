package httpapi

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentdata"
)

func (a *App) registerContent(mux *http.ServeMux) {
	const base = "/api/admin/v1"
	mux.HandleFunc("GET "+base+"/workspace", a.getWorkspace)
	mux.HandleFunc("GET "+base+"/dashboard", a.getDashboard)
	mux.HandleFunc("GET "+base+"/projects", a.getProjects)
	mux.HandleFunc("POST "+base+"/projects", a.createProject)
	mux.HandleFunc("GET "+base+"/projects/{id}", a.getProject)
	mux.HandleFunc("PUT "+base+"/projects/{id}", a.updateProject)
	mux.HandleFunc("POST "+base+"/projects/{id}/archive", a.archiveProject)
	mux.HandleFunc("POST "+base+"/projects/{id}/restore", a.restoreProject)
	mux.HandleFunc("PUT "+base+"/projects/order", a.orderProjects)
	mux.HandleFunc("GET "+base+"/categories", a.getCategories)
	mux.HandleFunc("POST "+base+"/categories", a.createCategory)
	mux.HandleFunc("GET "+base+"/categories/{id}", a.getCategory)
	mux.HandleFunc("PUT "+base+"/categories/{id}", a.updateCategory)
	mux.HandleFunc("DELETE "+base+"/categories/{id}", a.deleteCategory)
	mux.HandleFunc("PUT "+base+"/categories/order", a.orderCategories)
	mux.HandleFunc("GET "+base+"/profile", a.getProfile)
	mux.HandleFunc("PUT "+base+"/profile", a.putProfile)
	mux.HandleFunc("GET "+base+"/settings", a.getSettings)
	mux.HandleFunc("PUT "+base+"/settings", a.putSettings)
}

func queryOnly(r *http.Request, allowed ...string) error {
	query, err := parseContentQuery(r)
	if err != nil {
		return err
	}
	set := map[string]bool{}
	for _, key := range allowed {
		set[key] = true
	}
	for key, values := range query {
		if !set[key] || len(values) != 1 {
			return problem(400, "INVALID_REQUEST", "查询参数不合法。")
		}
	}
	return nil
}
func parseContentQuery(r *http.Request) (map[string][]string, error) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return nil, problem(400, "INVALID_REQUEST", "查询参数不合法。")
	}
	return query, nil
}

func (a *App) contentRead(w http.ResponseWriter, r *http.Request, read func(context.Context, *sql.Tx, int64) (map[string]any, error)) {
	tx, err := a.db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer tx.Rollback()
	revision, err := contentdata.CurrentRevision(r.Context(), tx)
	if err != nil {
		writeError(w, r, err)
		return
	}
	data, err := read(r.Context(), tx, revision)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, r, err)
		return
	}
	data["revision"] = contentdata.Revision(revision)
	w.Header().Set("ETag", `"`+contentdata.Revision(revision)+`"`)
	writeData(w, r, 200, data)
}
func (a *App) getWorkspace(w http.ResponseWriter, r *http.Request) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	a.contentRead(w, r, func(ctx context.Context, tx *sql.Tx, revision int64) (map[string]any, error) {
		projects, err := contentdata.Projects(ctx, tx)
		if err != nil {
			return nil, err
		}
		categories, err := contentdata.Categories(ctx, tx)
		if err != nil {
			return nil, err
		}
		profile, pReady, err := contentdata.ProfileView(ctx, tx)
		if err != nil {
			return nil, err
		}
		settings, sReady, err := contentdata.SettingsView(ctx, tx)
		if err != nil {
			return nil, err
		}
		var p, s any
		if pReady {
			p = profile
		}
		if sReady {
			s = settings
		}
		return map[string]any{"projects": projects, "categories": categories, "profile": p, "settings": s, "origin": contentdata.PublicOrigin, "initialized": pReady && sReady, "validation": contentdata.ExplainMissing(pReady && sReady)}, nil
	})
}
func (a *App) getDashboard(w http.ResponseWriter, r *http.Request) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	a.contentRead(w, r, func(ctx context.Context, tx *sql.Tx, _ int64) (map[string]any, error) {
		return contentdata.Dashboard(ctx, tx)
	})
}

type contentCursor struct {
	Revision int64  `json:"revision"`
	Offset   int    `json:"offset"`
	Kind     string `json:"kind"`
	Archived string `json:"archived"`
}

func contentPage(r *http.Request, revision int64, kind, archived string) (int, int, error) {
	limit := 20
	if value := r.URL.Query().Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 100 {
			return 0, 0, problem(400, "INVALID_REQUEST", "分页上限为100。")
		}
		limit = parsed
	}
	offset := 0
	if value := r.URL.Query().Get("cursor"); value != "" {
		if len(value) > 512 {
			return 0, 0, problem(400, "INVALID_REQUEST", "分页游标不合法。")
		}
		raw, err := base64.RawURLEncoding.DecodeString(value)
		var cursor contentCursor
		if err != nil || json.Unmarshal(raw, &cursor) != nil || cursor.Offset < 0 || cursor.Kind != kind || cursor.Archived != archived {
			return 0, 0, problem(400, "INVALID_REQUEST", "分页游标不合法。")
		}
		if cursor.Revision != revision {
			return 0, 0, &contentdata.Error{Status: 409, Code: "REVISION_CONFLICT", Message: "列表已改变，请重新加载。", CurrentRevision: contentdata.Revision(revision)}
		}
		offset = cursor.Offset
	}
	return offset, limit, nil
}
func nextContentCursor(revision int64, offset, total, limit int, kind, archived string) any {
	if offset+limit >= total {
		return nil
	}
	raw, _ := json.Marshal(contentCursor{Revision: revision, Offset: offset + limit, Kind: kind, Archived: archived})
	return base64.RawURLEncoding.EncodeToString(raw)
}
func (a *App) getProjects(w http.ResponseWriter, r *http.Request) {
	if err := queryOnly(r, "archived", "cursor", "limit"); err != nil {
		writeError(w, r, err)
		return
	}
	archived := r.URL.Query().Get("archived")
	if archived == "" {
		archived = "false"
	}
	if archived != "false" && archived != "true" && archived != "all" {
		writeError(w, r, problem(400, "INVALID_REQUEST", "归档筛选不合法。"))
		return
	}
	a.contentRead(w, r, func(ctx context.Context, tx *sql.Tx, revision int64) (map[string]any, error) {
		items, err := contentdata.Projects(ctx, tx)
		if err != nil {
			return nil, err
		}
		filtered := []contentdata.Project{}
		for _, p := range items {
			if archived == "all" || archived == "true" && p.ArchivedAt != nil || archived == "false" && p.ArchivedAt == nil {
				filtered = append(filtered, p)
			}
		}
		offset, limit, err := contentPage(r, revision, "projects", archived)
		if err != nil {
			return nil, err
		}
		if offset > len(filtered) {
			return nil, problem(400, "INVALID_REQUEST", "分页游标不合法。")
		}
		end := min(offset+limit, len(filtered))
		return map[string]any{"projects": filtered[offset:end], "nextCursor": nextContentCursor(revision, offset, len(filtered), limit, "projects", archived), "total": len(filtered)}, nil
	})
}
func (a *App) getProject(w http.ResponseWriter, r *http.Request) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	a.contentRead(w, r, func(ctx context.Context, tx *sql.Tx, _ int64) (map[string]any, error) {
		p, err := contentdata.ProjectByID(ctx, tx, r.PathValue("id"))
		return map[string]any{"project": p}, err
	})
}
func (a *App) createProject(w http.ResponseWriter, r *http.Request) { a.saveProject(w, r, true) }
func (a *App) updateProject(w http.ResponseWriter, r *http.Request) { a.saveProject(w, r, false) }
func (a *App) saveProject(w http.ResponseWriter, r *http.Request, create bool) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	var input contentdata.ProjectInput
	if err := decodeJSON(r, &input, 256<<10); err != nil {
		writeError(w, r, err)
		return
	}
	id := r.PathValue("id")
	status := 200
	action := "project.update"
	if create {
		id = newID("prj")
		status = 201
		action = "project.create"
	}
	a.mutate(w, r, status, action, func(tx *sql.Tx, _ int64) (map[string]any, error) {
		p, err := contentdata.SaveProject(r.Context(), tx, id, input, create, a.now().Unix())
		if err != nil {
			return nil, err
		}
		if create {
			w.Header().Set("Location", "/api/admin/v1/projects/"+p.ID)
		}
		return map[string]any{"project": p}, nil
	})
}
func (a *App) archiveProject(w http.ResponseWriter, r *http.Request) { a.setArchived(w, r, true) }
func (a *App) restoreProject(w http.ResponseWriter, r *http.Request) { a.setArchived(w, r, false) }
func (a *App) setArchived(w http.ResponseWriter, r *http.Request, archive bool) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	var empty struct{}
	if err := decodeJSON(r, &empty, 256<<10); err != nil {
		writeError(w, r, err)
		return
	}
	action := "project.restore"
	if archive {
		action = "project.archive"
	}
	a.mutate(w, r, 200, action, func(tx *sql.Tx, _ int64) (map[string]any, error) {
		p, err := contentdata.ArchiveProject(r.Context(), tx, r.PathValue("id"), archive, a.now().Unix())
		return map[string]any{"project": p}, err
	})
}
func (a *App) getCategories(w http.ResponseWriter, r *http.Request) {
	if err := queryOnly(r, "cursor", "limit"); err != nil {
		writeError(w, r, err)
		return
	}
	a.contentRead(w, r, func(ctx context.Context, tx *sql.Tx, revision int64) (map[string]any, error) {
		items, err := contentdata.Categories(ctx, tx)
		if err != nil {
			return nil, err
		}
		offset, limit, err := contentPage(r, revision, "categories", "")
		if err != nil {
			return nil, err
		}
		if offset > len(items) {
			return nil, problem(400, "INVALID_REQUEST", "分页游标不合法。")
		}
		return map[string]any{"categories": items[offset:min(offset+limit, len(items))], "nextCursor": nextContentCursor(revision, offset, len(items), limit, "categories", ""), "total": len(items)}, nil
	})
}
func (a *App) getCategory(w http.ResponseWriter, r *http.Request) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	a.contentRead(w, r, func(ctx context.Context, tx *sql.Tx, _ int64) (map[string]any, error) {
		c, err := contentdata.CategoryByID(ctx, tx, r.PathValue("id"))
		return map[string]any{"category": c}, err
	})
}
func (a *App) createCategory(w http.ResponseWriter, r *http.Request) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	var input struct {
		Slug string `json:"slug"`
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &input, 256<<10); err != nil {
		writeError(w, r, err)
		return
	}
	id := newID("cat")
	a.mutate(w, r, 201, "category.create", func(tx *sql.Tx, _ int64) (map[string]any, error) {
		c, err := contentdata.SaveCategory(r.Context(), tx, id, input.Slug, input.Name, true, a.now().Unix())
		return map[string]any{"category": c}, err
	})
}
func (a *App) updateCategory(w http.ResponseWriter, r *http.Request) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &input, 256<<10); err != nil {
		writeError(w, r, err)
		return
	}
	a.mutate(w, r, 200, "category.update", func(tx *sql.Tx, _ int64) (map[string]any, error) {
		c, err := contentdata.SaveCategory(r.Context(), tx, r.PathValue("id"), "", input.Name, false, a.now().Unix())
		return map[string]any{"category": c}, err
	})
}
func (a *App) deleteCategory(w http.ResponseWriter, r *http.Request) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	a.mutate(w, r, 200, "category.delete", func(tx *sql.Tx, _ int64) (map[string]any, error) {
		id := r.PathValue("id")
		err := contentdata.DeleteCategory(r.Context(), tx, id)
		return map[string]any{"deletedId": id}, err
	})
}
func (a *App) orderProjects(w http.ResponseWriter, r *http.Request) { a.orderContent(w, r, "projects") }
func (a *App) orderCategories(w http.ResponseWriter, r *http.Request) {
	a.orderContent(w, r, "categories")
}
func (a *App) orderContent(w http.ResponseWriter, r *http.Request, kind string) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	var input struct {
		IDs []string `json:"ids"`
	}
	if err := decodeJSON(r, &input, 256<<10); err != nil {
		writeError(w, r, err)
		return
	}
	a.mutate(w, r, 200, kind+".order", func(tx *sql.Tx, _ int64) (map[string]any, error) {
		err := contentdata.Order(r.Context(), tx, kind, input.IDs, a.now().Unix())
		return map[string]any{"ids": input.IDs}, err
	})
}
func (a *App) getProfile(w http.ResponseWriter, r *http.Request) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	a.contentRead(w, r, func(ctx context.Context, tx *sql.Tx, _ int64) (map[string]any, error) {
		p, ready, err := contentdata.ProfileView(ctx, tx)
		var value any
		if ready {
			value = p
		}
		return map[string]any{"profile": value, "initialized": ready}, err
	})
}
func (a *App) putProfile(w http.ResponseWriter, r *http.Request) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	var input contentdata.Profile
	if err := decodeJSON(r, &input, 256<<10); err != nil {
		writeError(w, r, err)
		return
	}
	a.mutate(w, r, 200, "profile.update", func(tx *sql.Tx, _ int64) (map[string]any, error) {
		if err := contentdata.SaveProfile(r.Context(), tx, input, a.now().Unix()); err != nil {
			return nil, err
		}
		p, _, err := contentdata.ProfileView(r.Context(), tx)
		return map[string]any{"profile": p}, err
	})
}
func (a *App) getSettings(w http.ResponseWriter, r *http.Request) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	a.contentRead(w, r, func(ctx context.Context, tx *sql.Tx, _ int64) (map[string]any, error) {
		s, ready, err := contentdata.SettingsView(ctx, tx)
		var value any
		if ready {
			value = s
		}
		return map[string]any{"settings": value, "initialized": ready, "origin": contentdata.PublicOrigin}, err
	})
}
func (a *App) putSettings(w http.ResponseWriter, r *http.Request) {
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	var input contentdata.Settings
	if err := decodeJSON(r, &input, 256<<10); err != nil {
		writeError(w, r, err)
		return
	}
	a.mutate(w, r, 200, "settings.update", func(tx *sql.Tx, _ int64) (map[string]any, error) {
		if err := contentdata.SaveSettings(r.Context(), tx, input, a.now().Unix()); err != nil {
			return nil, err
		}
		s, _, err := contentdata.SettingsView(r.Context(), tx)
		return map[string]any{"settings": s}, err
	})
}
