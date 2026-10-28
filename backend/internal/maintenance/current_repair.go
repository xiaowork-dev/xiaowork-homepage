package maintenance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
)

// CurrentRepairPlan is a read-only, content-addressed maintenance proposal. It
// is not an activation operation: the retained artifact and current stay intact.
type CurrentRepairPlan struct {
	Format     int                `json:"format"`
	State      State              `json:"state"`
	Candidates []CurrentCandidate `json:"candidates"`
	Files      []File             `json:"files"`
	SHA256     string             `json:"sha256"`
}
type CurrentCandidate struct {
	Name                string `json:"name"`
	Target              string `json:"target"`
	JobID               string `json:"jobId"`
	Status              string `json:"status"`
	Operation           string `json:"operation"`
	ManifestSHA256      string `json:"manifestSha256"`
	IntentSHA256        string `json:"intentSha256"`
	ReceiptSHA256       string `json:"receiptSha256,omitempty"`
	RecoverySHA256      string `json:"recoverySha256,omitempty"`
	ReferencedByHistory bool   `json:"referencedByHistory"`
}
type CurrentRepairRecord struct {
	Format      int               `json:"format"`
	ID          string            `json:"id"`
	CreatedAt   string            `json:"createdAt"`
	Reason      string            `json:"reason"`
	Plan        CurrentRepairPlan `json:"plan"`
	Selected    CurrentCandidate  `json:"selected"`
	Outcome     string            `json:"outcome"`
	AfterFiles  []File            `json:"afterFiles,omitempty"`
	AfterSHA256 string            `json:"afterSha256,omitempty"`
}

func repairRoots(root string) error {
	for _, name := range []string{"", "db", "uploads", "publications", "secrets"} {
		i, err := os.Lstat(filepath.Join(root, name))
		if err != nil || !i.IsDir() || i.Mode()&os.ModeSymlink != 0 {
			return errors.New("repair requires real, stopped-writer data directories")
		}
	}
	return nil
}

// InspectCurrentRepair never changes a pointer, task, receipt or database. A
// live/non-terminal task, ambiguous association or damaged history fails closed.
func InspectCurrentRepair(ctx context.Context, root string) (CurrentRepairPlan, error) {
	return inspectCurrentRepair(ctx, root, "")
}

func inspectCurrentRepair(ctx context.Context, root, allowedRepair string) (CurrentRepairPlan, error) {
	var p CurrentRepairPlan
	if err := repairRoots(root); err != nil {
		return p, err
	}
	state, err := inspectWithRepair(ctx, root, allowedRepair)
	if err != nil {
		return p, err
	}
	p = CurrentRepairPlan{Format: 1, State: state, Candidates: []CurrentCandidate{}}
	pubdir := filepath.Join(root, "publications")
	pub, err := publishfs.OpenReadOnly(pubdir)
	if err != nil {
		return p, err
	}
	defer pub.Close()
	db, err := openReadOnly(filepath.Join(root, "db", "content.sqlite"))
	if err != nil {
		return p, err
	}
	defer db.Close()
	entries, err := os.ReadDir(pubdir)
	if err != nil {
		return p, err
	}
	for _, e := range entries {
		if !strings.HasPrefix(e.Name(), "current.next.") {
			continue
		}
		token := strings.TrimPrefix(e.Name(), "current.next.")
		if !publishfs.ValidHash(token) || e.Type()&os.ModeSymlink == 0 {
			return p, errors.New("unknown current.next member requires manual investigation")
		}
		target, err := os.Readlink(filepath.Join(pubdir, e.Name()))
		if err != nil || !strings.HasPrefix(target, "releases/") || !publishfs.ValidID(strings.TrimPrefix(target, "releases/"), "rel") {
			return p, errors.New("unsafe current.next target")
		}
		candidate := CurrentCandidate{Name: e.Name(), Target: target}
		activationEntries, err := os.ReadDir(filepath.Join(pubdir, "activations"))
		if err != nil {
			return p, err
		}
		matches := 0
		for _, activation := range activationEntries {
			if !activation.IsDir() || activation.Type()&os.ModeSymlink != 0 || !publishfs.ValidID(activation.Name(), "job") {
				return p, errors.New("unsafe activation directory")
			}
			intent, err := pub.ReadIntent(activation.Name())
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			if err != nil {
				return p, err
			}
			operation := ""
			if token == intent.ActivationToken && target == "releases/"+intent.ReleaseID {
				operation = "activation"
			}
			if token == publishfs.Hash([]byte(intent.ActivationToken+"/restore")) && intent.PreviousReleaseID != "" && target == "releases/"+intent.PreviousReleaseID {
				operation = "recovery"
			}
			if operation == "" {
				continue
			}
			matches++
			if intent.Phase != "prepared" || !publishfs.ValidHash(intent.ActivationToken) || intent.Outcome != "activated" {
				return p, errors.New("invalid activation intent")
			}
			var status, kind, snapshot, snapshotHash, sealed, activationHash, assignedRelease, previous, manifestHash string
			var completed int64
			err = db.QueryRowContext(ctx, `SELECT j.status,j.kind,j.snapshot_id,s.content_sha256,coalesce(s.sealed_at,''),coalesce(j.activation_token_hash,''),d.release_id,coalesce(d.previous_release_id,''),coalesce(d.manifest_sha256,''),coalesce(j.completed_at,0) FROM publish_jobs j JOIN snapshots s ON s.id=j.snapshot_id JOIN publication_job_details d ON d.job_id=j.id WHERE j.id=?`, intent.JobID).Scan(&status, &kind, &snapshot, &snapshotHash, &sealed, &activationHash, &assignedRelease, &previous, &manifestHash, &completed)
			if err != nil {
				return p, err
			}
			if (status != "failed" && status != "succeeded") || completed == 0 || kind == "preview" || sealed == "" || activationHash != publishfs.Hash([]byte(intent.ActivationToken)) || assignedRelease != intent.ReleaseID || previous != intent.PreviousReleaseID || snapshot != intent.SnapshotID || snapshotHash != intent.SnapshotSHA256 || manifestHash != intent.ManifestSHA256 {
				return p, errors.New("candidate has no matching terminal, sealed database task")
			}
			m, digest, err := pub.VerifyRelease(intent.ReleaseID)
			if err != nil || digest != intent.ManifestSHA256 || m.SnapshotID != snapshot || m.SnapshotSHA256 != snapshotHash {
				return p, errors.New("candidate activation artifact is damaged")
			}
			candidate.JobID = intent.JobID
			candidate.Status = status
			candidate.Operation = operation
			intentFile, intentErr := hashFile(filepath.Join(pubdir, "activations", intent.JobID, "intent.json"))
			if intentErr != nil {
				return p, intentErr
			}
			candidate.IntentSHA256 = intentFile.SHA256
			receipt, receiptHash, receiptErr := pub.ReadReceipt(intent.JobID)
			if receiptErr == nil {
				if receipt != intent.Receipt {
					return p, errors.New("activation receipt differs from intent")
				}
				candidate.ReceiptSHA256 = receiptHash
			} else if !errors.Is(receiptErr, os.ErrNotExist) {
				return p, receiptErr
			}
			recovery, recoveryHash, recoveryErr := pub.ReadRecoveryReceipt(intent.JobID)
			if recoveryErr == nil {
				if recovery.Outcome != "restored" || recovery.ActivationToken != intent.ActivationToken || recovery.ReleaseID != previous || recovery.PreviousReleaseID != assignedRelease {
					return p, errors.New("recovery receipt differs from intent")
				}
				if previous != "" {
					old, oldHash, e := pub.VerifyRelease(previous)
					if e != nil || oldHash != recovery.ManifestSHA256 || old.SnapshotID != recovery.SnapshotID || old.SnapshotSHA256 != recovery.SnapshotSHA256 {
						return p, errors.New("recovery proof is damaged")
					}
				}
				candidate.RecoverySHA256 = recoveryHash
			} else if !errors.Is(recoveryErr, os.ErrNotExist) {
				return p, recoveryErr
			}
			if operation == "recovery" && recoveryErr != nil {
				return p, errors.New("recovery candidate needs a completed recovery receipt")
			}
			if status == "succeeded" {
				if state.ActiveRelease != assignedRelease || receiptErr != nil || operation != "activation" {
					return p, errors.New("successful task/current disagreement")
				}
			} else if state.ActiveRelease != previous || (receiptErr == nil && recoveryErr != nil) {
				return p, errors.New("failed task has uncertain active state")
			}
			targetID := strings.TrimPrefix(target, "releases/")
			_, targetHash, err := pub.VerifyRelease(targetID)
			if err != nil {
				return p, err
			}
			var historical int
			if err = db.QueryRowContext(ctx, "SELECT count(*) FROM releases WHERE id=? AND manifest_sha256=?", targetID, targetHash).Scan(&historical); err != nil || historical != 1 {
				return p, errors.New("candidate is not retained in release history")
			}
			candidate.ManifestSHA256 = targetHash
			candidate.ReferencedByHistory = true
		}
		if matches != 1 {
			return p, errors.New("candidate must match exactly one retained activation or recovery intent")
		}
		p.Candidates = append(p.Candidates, candidate)
	}
	if err = db.Close(); err != nil {
		return p, err
	}
	p.Files, err = repairInventory(root, p.Candidates)
	if err != nil {
		return p, err
	}
	p.SHA256 = mustJSONHash(p)
	return p, nil
}

func mustJSONHash(v any) string { data, _ := json.Marshal(v); return publishfs.Hash(data) }

func repairInventory(root string, candidates []CurrentCandidate) ([]File, error) {
	allowed := map[string]string{}
	for _, c := range candidates {
		allowed["publications/"+c.Name] = c.Target
	}
	var files []File
	err := filepath.WalkDir(root, func(path string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		name, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		name = filepath.ToSlash(name)
		if e.Type()&os.ModeSymlink != 0 {
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			if name == "publications/current" {
				if !strings.HasPrefix(link, "releases/") || !publishfs.ValidID(strings.TrimPrefix(link, "releases/"), "rel") {
					return errors.New("unsafe active link")
				}
			} else if allowed[name] != link || allowed[name] == "" {
				return errors.New("unrecognized symbolic link in data set")
			}
			files = append(files, File{Path: name, Link: link})
			return nil
		}
		if e.IsDir() {
			return nil
		}
		if !publishfs.SafePath(name) {
			return errors.New("unsafe maintenance file name")
		}
		f, err := hashFile(path)
		if err != nil {
			return err
		}
		f.Path = name
		files = append(files, f)
		return nil
	})
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return files, err
}

// RepairCurrent removes one verified redundant symlink only. It never changes
// current or deletes an artifact, history record, task or media file. The host
// operator must stop every writer; the kernel publication lock is also held.
func RepairCurrent(ctx context.Context, root, member, expectedHash, reason string) (CurrentRepairRecord, error) {
	var record CurrentRepairRecord
	if runtime.GOOS != "linux" {
		return record, errors.New("repair mutation requires Linux durable directory fsync")
	}
	if !strings.HasPrefix(member, "current.next.") || !publishfs.ValidHash(strings.TrimPrefix(member, "current.next.")) || !publishfs.ValidHash(expectedHash) || len(strings.TrimSpace(reason)) < 8 || len(reason) > 500 || strings.ContainsAny(reason, "\r\n\x00") {
		return record, errors.New("exact candidate, plan SHA256 and a non-secret audit reason are required")
	}
	if err := repairRoots(root); err != nil {
		return record, err
	}
	pubdir := filepath.Join(root, "publications")
	if lock, err := os.Lstat(filepath.Join(pubdir, "publisher.lock")); err != nil || !lock.Mode().IsRegular() {
		return record, errors.New("existing publisher kernel-lock file is required")
	}
	pub, err := publishfs.Open(pubdir)
	if err != nil {
		return record, err
	}
	defer pub.Close()
	unlock, err := pub.Lock()
	if err != nil {
		return record, err
	}
	defer unlock()
	p, err := InspectCurrentRepair(ctx, root)
	if err != nil {
		return record, err
	}
	if p.SHA256 != expectedHash {
		return record, errors.New("maintenance plan changed; inspect again")
	}
	var selected CurrentCandidate
	for _, candidate := range p.Candidates {
		if candidate.Name == member {
			selected = candidate
		}
	}
	if selected.Name == "" {
		return record, errors.New("candidate not present in verified plan")
	}
	r, err := os.OpenRoot(pubdir)
	if err != nil {
		return record, err
	}
	defer r.Close()
	if err = r.Mkdir("maintenance-repairs", 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return record, err
	}
	dir, err := r.Lstat("maintenance-repairs")
	if err != nil || !dir.IsDir() || dir.Mode()&os.ModeSymlink != 0 {
		return record, errors.New("unsafe maintenance audit directory")
	}
	audit, err := r.OpenRoot("maintenance-repairs")
	if err != nil {
		return record, err
	}
	defer audit.Close()
	auditEntries, err := fs.ReadDir(audit.FS(), ".")
	if err != nil {
		return record, err
	}
	for _, entry := range auditEntries {
		if strings.HasSuffix(entry.Name(), ".intent.json") {
			if _, e := audit.Lstat(strings.TrimSuffix(entry.Name(), ".intent.json") + ".result.json"); e != nil {
				return record, errors.New("incomplete prior repair requires manual audit reconciliation")
			}
		}
	}
	now := time.Now().UTC()
	id := fmt.Sprintf("repair-%d", now.UnixNano())
	record = CurrentRepairRecord{Format: 1, ID: id, CreatedAt: now.Format(time.RFC3339Nano), Reason: reason, Plan: p, Selected: selected, Outcome: "prepared"}
	if err = writeRepairRecord(audit, id+".intent.json", record); err != nil {
		return record, err
	}
	// A changed link or directory at the last checkpoint is never followed.
	info, err := r.Lstat(member)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		return record, errors.New("candidate changed after audit intent")
	}
	link, err := r.Readlink(member)
	if err != nil || link != selected.Target {
		return record, errors.New("candidate target changed after audit intent")
	}
	if err = r.Remove(member); err != nil {
		return record, err
	}
	if err = syncRepairRoot(r); err != nil {
		return record, err
	}
	after, err := inspectCurrentRepair(ctx, root, id)
	if err != nil {
		return record, err
	}
	var beforeFiles, afterFiles []File
	for _, f := range p.Files {
		if f.Path != "publications/"+member {
			beforeFiles = append(beforeFiles, f)
		}
	}
	for _, f := range after.Files {
		if f.Path != "publications/maintenance-repairs/"+id+".intent.json" {
			afterFiles = append(afterFiles, f)
		}
	}
	if !reflect.DeepEqual(p.State, after.State) || !reflect.DeepEqual(beforeFiles, afterFiles) {
		return record, errors.New("post-repair data/current hashes changed; manual intervention required")
	}
	record.Outcome = "verified-redundant-link-removed"
	record.AfterFiles = afterFiles
	record.AfterSHA256 = mustJSONHash(afterFiles)
	if err = writeRepairRecord(audit, id+".result.json", record); err != nil {
		return record, err
	}
	return record, nil
}

func writeRepairRecord(root *os.Root, name string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if len(data) > 32<<20 {
		return errors.New("repair audit exceeds bounded record size")
	}
	f, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(append(data, '\n'))
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return syncRepairRoot(root)
}

// An interrupted repair is a maintenance stop condition for backup/upgrade as
// well as later repairs. Operators must preserve the intent and inspect hashes;
// no command guesses whether a missing result means the unlink was committed.
func checkRepairJournal(root, allowed string) error {
	directory := filepath.Join(root, "publications", "maintenance-repairs")
	info, err := os.Lstat(directory)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("unsafe repair journal")
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			return errors.New("unsafe repair journal member")
		}
		if !strings.HasSuffix(entry.Name(), ".intent.json") && !strings.HasSuffix(entry.Name(), ".result.json") {
			return errors.New("unknown repair journal member")
		}
		if !strings.HasSuffix(entry.Name(), ".intent.json") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".intent.json")
		var intent CurrentRepairRecord
		if err = readRepairRecord(filepath.Join(directory, entry.Name()), &intent); err != nil {
			return err
		}
		if intent.ID != id || intent.Format != 1 || intent.Outcome != "prepared" {
			return errors.New("invalid repair intent")
		}
		var result CurrentRepairRecord
		err = readRepairRecord(filepath.Join(directory, id+".result.json"), &result)
		if errors.Is(err, os.ErrNotExist) && allowed == id {
			continue
		}
		if err != nil {
			return errors.New("incomplete prior repair requires manual audit reconciliation")
		}
		if result.ID != id || result.Format != 1 || result.Outcome != "verified-redundant-link-removed" || !reflect.DeepEqual(result.Plan, intent.Plan) || result.Selected != intent.Selected || result.Reason != intent.Reason || result.AfterSHA256 != mustJSONHash(result.AfterFiles) {
			return errors.New("repair audit result mismatch")
		}
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".result.json") {
			if _, err = os.Lstat(filepath.Join(directory, strings.TrimSuffix(entry.Name(), ".result.json")+".intent.json")); err != nil {
				return errors.New("orphan repair result")
			}
		}
	}
	return nil
}

func readRepairRecord(path string, v any) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > 32<<20 {
		return errors.New("unsafe repair record")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	d := json.NewDecoder(strings.NewReader(string(data)))
	d.DisallowUnknownFields()
	if err = d.Decode(v); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing repair audit content")
	}
	return nil
}
