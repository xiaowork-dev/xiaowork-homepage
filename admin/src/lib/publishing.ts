import type { PublicationJob, PublishingStatus } from './types.ts'

export function canCreatePublication(status: PublishingStatus | null): boolean {
  return (
    status?.enabled === true &&
    status.localOnly === true &&
    status.workerAvailable === true &&
    (status.storage?.state === 'ok' || status.storage?.state === 'warning') &&
    status.blockingJob === null &&
    (status.activeReleaseId === null ||
      (typeof status.activeReleaseId === 'string' &&
        /^rel_[0-9a-f]{32}$/.test(status.activeReleaseId) &&
        status.activeVerified === true))
  )
}
export function isReviewCurrent(
  review: PublishingStatus['review'],
  revision: string | undefined,
): boolean {
  return (
    review?.available === true &&
    review.revision === revision &&
    typeof revision === 'string' &&
    /^ws-\d+$/.test(revision) &&
    ['added', 'modified', 'hidden', 'archived'].every((key) =>
      Array.isArray(review[key as 'added']),
    ) &&
    [
      review.profileChanged,
      review.settingsChanged,
      review.categoriesChanged,
      review.mediaChanged,
    ].every((value) => typeof value === 'boolean')
  )
}
export function isActiveReviewCurrent(
  reviewed: string | null | undefined,
  status: PublishingStatus | null,
): boolean {
  return (
    reviewed !== undefined &&
    status !== null &&
    reviewed === status.activeReleaseId &&
    (reviewed === null || /^rel_[0-9a-f]{32}$/.test(reviewed))
  )
}
export function safePreviewURL(value: unknown): string | null {
  return typeof value === 'string' && /^\/api\/admin\/v1\/previews\/pre_[0-9a-f]{32}\/$/.test(value)
    ? value
    : null
}
export function pendingJob(job: PublicationJob): boolean {
  return ['queued', 'running', 'reconciling'].includes(job.status)
}
export function publicationJobLabel(job: PublicationJob): string {
  if (job.status === 'succeeded')
    return job.kind === 'preview'
      ? '预览构建完成'
      : job.activeVerified
        ? '任务完成，当前版本已核验'
        : '任务已完成，活动状态另行核验'
  return (
    (
      {
        queued: '已排队，尚未生效',
        running: '正在处理，尚未确认生效',
        reconciling: '正在核对，需要等待',
        failed: '任务失败',
        canceled: '任务已取消',
        cancelled: '任务已取消',
      } as Record<string, string>
    )[job.status] ?? '状态未知，请重新核对'
  )
}
