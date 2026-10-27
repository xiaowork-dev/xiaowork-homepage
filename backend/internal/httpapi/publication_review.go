package httpapi

import (
	"context"
	"database/sql"
	"reflect"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

type reviewItem struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type publicationReview struct {
	Revision          string       `json:"revision"`
	Available         bool         `json:"available"`
	Added             []reviewItem `json:"added"`
	Modified          []reviewItem `json:"modified"`
	Hidden            []reviewItem `json:"hidden"`
	Archived          []reviewItem `json:"archived"`
	ProfileChanged    bool         `json:"profileChanged"`
	SettingsChanged   bool         `json:"settingsChanged"`
	CategoriesChanged bool         `json:"categoriesChanged"`
	MediaChanged      bool         `json:"mediaChanged"`
}

func (a *App) reviewWithQuery(ctx context.Context, q contentdata.Queryer, revision int64, current string, verified bool) publicationReview {
	out := publicationReview{Revision: revisionLabel(revision), Added: []reviewItem{}, Modified: []reviewItem{}, Hidden: []reviewItem{}, Archived: []reviewItem{}}
	if current != "" && !verified {
		return out
	}
	next, _, _, e := publishdata.Project(ctx, q, "snap_00000000000000000000000000000000", revision, a.now().Unix())
	if e != nil {
		return out
	}
	previous := publishmodel.Snapshot{VisibleProjects: []publishmodel.PublicProject{}}
	if current != "" {
		var sid string
		if e = q.QueryRowContext(ctx, `SELECT snapshot_id FROM releases WHERE id=?`, current).Scan(&sid); e != nil {
			return out
		}
		if previous, _, _, e = publishdata.Load(ctx, q, sid); e != nil {
			return out
		}
	}
	old := map[string]publishmodel.PublicProject{}
	for _, p := range previous.VisibleProjects {
		old[p.ID] = p
	}
	visible := map[string]bool{}
	for _, p := range next.VisibleProjects {
		visible[p.ID] = true
		item := reviewItem{p.ID, p.Name}
		prior, found := old[p.ID]
		if !found {
			out.Added = append(out.Added, item)
		} else if !reflect.DeepEqual(prior, p) {
			out.Modified = append(out.Modified, item)
		}
	}
	all, e := contentdata.Projects(ctx, q)
	if e != nil {
		return out
	}
	for _, p := range all {
		if _, found := old[p.ID]; !found || visible[p.ID] {
			continue
		}
		item := reviewItem{p.ID, p.Name}
		if p.ArchivedAt != nil {
			out.Archived = append(out.Archived, item)
		} else {
			out.Hidden = append(out.Hidden, item)
		}
	}
	out.ProfileChanged = current == "" || !reflect.DeepEqual(previous.SiteProfile, next.SiteProfile) || !reflect.DeepEqual(previous.AboutProfile, next.AboutProfile)
	out.SettingsChanged = current == "" || !reflect.DeepEqual(previous.SiteSettings, next.SiteSettings)
	out.CategoriesChanged = current == "" || !reflect.DeepEqual(previous.Categories, next.Categories)
	out.MediaChanged = current == "" || !reflect.DeepEqual(previous.MediaManifest, next.MediaManifest) || !reflect.DeepEqual(previous.LegacyAssetAllowlist, next.LegacyAssetAllowlist)
	out.Available = true
	return out
}
func (a *App) publicationReview(ctx context.Context, current string, verified bool) publicationReview {
	tx, e := a.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return publicationReview{}
	}
	defer tx.Rollback()
	revision, e := contentdata.CurrentRevision(ctx, tx)
	if e != nil {
		return publicationReview{}
	}
	review := a.reviewWithQuery(ctx, tx, revision, current, verified)
	if tx.Commit() != nil {
		review.Available = false
	}
	return review
}
