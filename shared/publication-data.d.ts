declare module '#publication-data' {
  import type { PublicSnapshot, PublicationContext } from '#shared/publication'
  export const snapshot: PublicSnapshot | null
  export const publication: PublicationContext | null
}
