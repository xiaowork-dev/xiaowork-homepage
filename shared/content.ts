import { snapshot as rawSnapshot, publication as rawPublication } from '#publication-data'
import { publicAsset, resolvePublicAsset } from './publication'
import type { PublicSnapshot, PublicationContext } from './publication'

export const snapshot: PublicSnapshot | null = rawSnapshot
export const publication: PublicationContext | null = rawPublication
export function assetURL(path: string): string {
  return publicAsset(path.replace(/^\//, ''), publication)
}
export function mediaURL(id: string | null): string | undefined {
  return id && snapshot && publication ? resolvePublicAsset(id, snapshot, publication) : undefined
}
