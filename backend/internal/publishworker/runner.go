package publishworker

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

type Runner struct {
	Control        Control
	Store          *publishfs.Store
	Builder        Builder
	SourceRevision string
	BuilderID      string
	Now            func() time.Time
}

func (r *Runner) now() string {
	if r.Now != nil {
		return r.Now().UTC().Format(time.RFC3339)
	}
	return time.Now().UTC().Format(time.RFC3339)
}

// Run keeps the kernel publisher lock for the worker's entire lifetime. An
// uncertain activation exits with the gate closed; it is never retried as a new
// build. The API must return a recovery assignment for the same task.
func (r *Runner) Run(ctx context.Context) error {
	unlock, err := r.Store.Lock()
	if err != nil {
		return err
	}
	defer unlock()
	if _, fixed := r.Builder.(FixedBuilder); fixed {
		if err = checkOrphanBuild(WorkRoot); err != nil {
			return err
		}
	}
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		processed, err := r.RunNext(ctx)
		if err != nil {
			return err
		}
		if !processed {
			timer := time.NewTimer(2 * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
	}
}

// RunNext is also used by fault-injection tests, which explicitly hold Lock.
func (r *Runner) RunNext(ctx context.Context) (bool, error) {
	job, err := r.Control.Claim(ctx)
	if err != nil {
		return false, err
	}
	if job == nil {
		return false, nil
	}
	snapshot, err := ValidateAssignment(*job, r.SourceRevision, r.BuilderID)
	if err != nil {
		return true, r.fail(ctx, *job, "INVALID_ASSIGNMENT")
	}
	if job.RecoveryRequired {
		return true, r.reconcile(ctx, *job)
	}
	if job.Kind == "rollback" {
		return true, r.rollback(ctx, *job)
	}
	buildCtx, cancel := context.WithCancel(ctx)
	var leasePhase atomic.Value
	leasePhase.Store("building")
	stopHeartbeat := r.heartbeat(buildCtx, cancel, *job, &leasePhase)
	defer func() { cancel(); stopHeartbeat() }()
	output, cleanup, buildErr := r.Builder.Build(buildCtx, *job)
	if cleanup != nil {
		defer cleanup()
	}
	if buildErr != nil {
		return true, r.fail(ctx, *job, "BUILD_FAILED")
	}
	leasePhase.Store("validating")
	if err = r.phase(ctx, *job, "validating"); err != nil {
		return true, err
	}
	if err = writeMarker(output, *job); err != nil {
		return true, r.fail(ctx, *job, "MARKER_WRITE_FAILED")
	}
	if err = ValidateOutput(output, *job, snapshot); err != nil {
		return true, r.fail(ctx, *job, "ARTIFACT_VALIDATION_FAILED")
	}
	if buildCtx.Err() != nil {
		return true, r.fail(ctx, *job, "LEASE_LOST")
	}
	m := publishmodel.Manifest{SchemaVersion: 1, JobID: job.ID, ReleaseID: job.ReleaseID, SnapshotID: job.SnapshotID, SnapshotSHA256: job.SnapshotSHA256, WorkspaceRevision: job.WorkspaceRevision, SourceRevision: job.SourceRevision, BuilderID: job.BuilderID, Kind: job.Kind, Origin: "https://xiaoworks.com", CreatedAt: r.now()}
	if job.Kind == "preview" {
		m.PreviewID = job.ReleaseID
	}
	digest, err := r.Store.Prepare(job.ID, m, output)
	if err != nil {
		return true, r.fail(ctx, *job, "ARTIFACT_PREPARE_FAILED")
	}
	if buildCtx.Err() != nil {
		return true, r.fail(ctx, *job, "LEASE_LOST")
	}
	cancel()
	stopHeartbeat()
	if job.Kind == "preview" {
		if _, err = r.Control.Prepared(ctx, job.ID, publishmodel.PreparedRequest{LeaseToken: job.LeaseToken, ManifestSHA256: digest}); err != nil {
			return true, err
		}
		receipt := r.receipt(*job, digest, "", "preview-ready", "")
		if err = r.Store.WritePreviewReceipt(receipt); err != nil {
			return true, r.fail(ctx, *job, "PREVIEW_RECEIPT_FAILED")
		}
		response, err := r.Control.Result(ctx, job.ID, publishmodel.ResultRequest{LeaseToken: job.LeaseToken, Outcome: "preview-ready"})
		if err != nil {
			return true, err
		}
		if response.Status != "succeeded" || response.Action != "none" {
			return true, publishfs.ErrRecoveryRequired
		}
		return true, nil
	}
	return true, r.activate(ctx, *job, digest)
}

func (r *Runner) heartbeat(ctx context.Context, cancel context.CancelFunc, job publishmodel.Assignment, phase *atomic.Value) func() {
	stop := make(chan struct{})
	done := make(chan struct{})
	var once sync.Once
	go func() {
		defer close(done)
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-stop:
				return
			case <-ticker.C:
				if r.phase(ctx, job, phase.Load().(string)) != nil {
					cancel()
					return
				}
			}
		}
	}()
	return func() { once.Do(func() { close(stop) }); <-done }
}

func (r *Runner) phase(ctx context.Context, job publishmodel.Assignment, phase string) error {
	return r.Control.Heartbeat(ctx, job.ID, publishmodel.HeartbeatRequest{LeaseToken: job.LeaseToken, Phase: phase})
}
func (r *Runner) fail(ctx context.Context, job publishmodel.Assignment, code string) error {
	response, err := r.Control.Result(ctx, job.ID, publishmodel.ResultRequest{LeaseToken: job.LeaseToken, Outcome: "failed", ErrorCode: code, ErrorSummary: "Offline publication did not complete; active filesystem state is unchanged or requires reconciliation."})
	if err != nil {
		return err
	}
	if response.Action != "none" || response.Status != "failed" {
		return publishfs.ErrRecoveryRequired
	}
	return nil
}

func (r *Runner) receipt(job publishmodel.Assignment, digest, token, outcome, previous string) publishmodel.Receipt {
	return publishmodel.Receipt{SchemaVersion: 1, JobID: job.ID, ReleaseID: job.ReleaseID, PreviousReleaseID: previous, ActivationToken: token, SnapshotID: job.SnapshotID, SnapshotSHA256: job.SnapshotSHA256, ManifestSHA256: digest, ActivatedAt: r.now(), Outcome: outcome}
}

func (r *Runner) rollback(ctx context.Context, job publishmodel.Assignment) error {
	if err := r.phase(ctx, job, "validating"); err != nil {
		return err
	}
	m, digest, err := r.Store.VerifyRelease(job.ReleaseID)
	if err != nil || m.SnapshotID != job.SnapshotID || m.SnapshotSHA256 != job.SnapshotSHA256 || m.SourceRevision != job.SourceRevision || m.BuilderID != job.BuilderID {
		return r.fail(ctx, job, "ROLLBACK_TARGET_INVALID")
	}
	return r.activate(ctx, job, digest)
}

func (r *Runner) activate(ctx context.Context, job publishmodel.Assignment, digest string) error {
	prepared, err := r.Control.Prepared(ctx, job.ID, publishmodel.PreparedRequest{LeaseToken: job.LeaseToken, ManifestSHA256: digest})
	if err != nil {
		return err
	}
	if !publishfs.ValidHash(prepared.ActivationToken) || prepared.ExpectedPreviousReleaseID != job.ExpectedPreviousReleaseID {
		return publishfs.ErrRecoveryRequired
	}
	receipt := r.receipt(job, digest, prepared.ActivationToken, "activated", prepared.ExpectedPreviousReleaseID)
	intent := publishmodel.Intent{Receipt: receipt, Phase: "prepared"}
	if err = r.phase(ctx, job, "activating"); err != nil {
		return err
	}
	err = r.Store.Activate(intent, receipt)
	if err != nil && !errors.Is(err, publishfs.ErrRecoveryRequired) {
		return r.fail(ctx, job, "ACTIVATION_NOT_COMPLETED")
	}
	if err != nil {
		if _, repairErr := r.Store.CompleteActivationReceipt(job.ID); repairErr != nil {
			return publishfs.ErrRecoveryRequired
		}
	}
	return r.reportActivation(ctx, job, receipt)
}

func (r *Runner) reportActivation(ctx context.Context, job publishmodel.Assignment, receipt publishmodel.Receipt) error {
	response, err := r.Control.Result(ctx, job.ID, publishmodel.ResultRequest{LeaseToken: job.LeaseToken, Outcome: "activated"})
	if err != nil {
		return publishfs.ErrRecoveryRequired
	}
	if response.Action == "restore" {
		if response.ExpectedPreviousReleaseID != receipt.PreviousReleaseID {
			return publishfs.ErrRecoveryRequired
		}
		recovery := receipt
		recovery.ReleaseID = receipt.PreviousReleaseID
		recovery.PreviousReleaseID = job.ReleaseID
		recovery.Outcome = "restored"
		recovery.ActivatedAt = r.now()
		if recovery.ReleaseID != "" {
			m, digest, err := r.Store.VerifyRelease(recovery.ReleaseID)
			if err != nil {
				return publishfs.ErrRecoveryRequired
			}
			recovery.ManifestSHA256 = digest
			recovery.SnapshotID = m.SnapshotID
			recovery.SnapshotSHA256 = m.SnapshotSHA256
		} else {
			recovery.SnapshotID = ""
			recovery.SnapshotSHA256 = ""
			recovery.ManifestSHA256 = ""
		}
		if err = r.Store.Restore(job.ID, receipt.ActivationToken, recovery); err != nil {
			return publishfs.ErrRecoveryRequired
		}
		result, err := r.Control.Result(ctx, job.ID, publishmodel.ResultRequest{LeaseToken: job.LeaseToken, Outcome: "restored", ErrorCode: "GATEWAY_VERIFICATION_FAILED"})
		if err != nil || result.Status != "failed" || result.Action != "none" {
			return publishfs.ErrRecoveryRequired
		}
		return nil
	}
	if response.Status != "succeeded" || response.Action != "none" {
		return publishfs.ErrRecoveryRequired
	}
	return nil
}

func (r *Runner) reconcile(ctx context.Context, job publishmodel.Assignment) error {
	if job.Kind == "preview" {
		if _, _, err := r.Store.VerifyRelease(job.ReleaseID); err != nil {
			return r.fail(ctx, job, "INTERRUPTED_PREVIEW")
		}
		if _, _, err := r.Store.ReadReceipt(job.ID); err != nil {
			return r.fail(ctx, job, "INTERRUPTED_PREVIEW")
		}
		result, err := r.Control.Result(ctx, job.ID, publishmodel.ResultRequest{LeaseToken: job.LeaseToken, Outcome: "preview-ready"})
		if err != nil || result.Status != "succeeded" {
			return publishfs.ErrRecoveryRequired
		}
		return nil
	}
	intent, err := r.Store.ReadIntent(job.ID)
	if errors.Is(err, os.ErrNotExist) {
		return r.fail(ctx, job, "INTERRUPTED_BEFORE_ACTIVATION")
	}
	if err != nil {
		return publishfs.ErrRecoveryRequired
	}
	if intent.ReleaseID != job.ReleaseID || intent.SnapshotID != job.SnapshotID || intent.SnapshotSHA256 != job.SnapshotSHA256 || intent.PreviousReleaseID != job.ExpectedPreviousReleaseID {
		return publishfs.ErrRecoveryRequired
	}
	current, err := r.Store.Current()
	if err != nil {
		return publishfs.ErrRecoveryRequired
	}
	if current == intent.ReleaseID {
		receipt, err := r.Store.CompleteActivationReceipt(job.ID)
		if err != nil {
			return publishfs.ErrRecoveryRequired
		}
		return r.reportActivation(ctx, job, receipt)
	}
	if current == intent.PreviousReleaseID {
		if _, _, receiptErr := r.Store.ReadReceipt(job.ID); errors.Is(receiptErr, os.ErrNotExist) {
			return r.fail(ctx, job, "INTERRUPTED_BEFORE_ACTIVATION")
		}
		recovery, _, err := r.Store.ReadRecoveryReceipt(job.ID)
		if errors.Is(err, os.ErrNotExist) {
			recovery = intent.Receipt
			recovery.ReleaseID = intent.PreviousReleaseID
			recovery.PreviousReleaseID = job.ReleaseID
			recovery.Outcome = "restored"
			if recovery.ReleaseID != "" {
				m, digest, err := r.Store.VerifyRelease(recovery.ReleaseID)
				if err != nil {
					return publishfs.ErrRecoveryRequired
				}
				recovery.ManifestSHA256 = digest
				recovery.SnapshotID = m.SnapshotID
				recovery.SnapshotSHA256 = m.SnapshotSHA256
			} else {
				recovery.SnapshotID = ""
				recovery.SnapshotSHA256 = ""
				recovery.ManifestSHA256 = ""
			}
			if err = r.Store.Restore(job.ID, intent.ActivationToken, recovery); err != nil {
				return publishfs.ErrRecoveryRequired
			}
		} else if err != nil {
			return publishfs.ErrRecoveryRequired
		}
		result, err := r.Control.Result(ctx, job.ID, publishmodel.ResultRequest{LeaseToken: job.LeaseToken, Outcome: "restored", ErrorCode: "INTERRUPTED_RECOVERY"})
		if err != nil || result.Status != "failed" {
			return publishfs.ErrRecoveryRequired
		}
		return nil
	}
	return publishfs.ErrRecoveryRequired
}
