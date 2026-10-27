import { pageSeo } from '#shared/seo'
import { assetURL, mediaURL, snapshot } from '#shared/content'
import { publicOrigin } from '#shared/publication'

export function useSiteSeo(page: keyof typeof pageSeo) {
  const config = useRuntimeConfig()
  const defaults = pageSeo[page]
  const configured = snapshot?.siteSettings.pages[page]
  const metadata = {
    ...defaults,
    title: configured?.title || snapshot?.siteSettings.siteTitle || defaults.title,
    description:
      configured?.description ||
      snapshot?.siteSettings.defaultSeoDescription ||
      defaults.description,
  }
  const origin = snapshot ? publicOrigin : config.public.siteUrl
  const canonical = origin ? `${origin}${metadata.path}` : undefined
  const image =
    mediaURL(configured?.shareAssetId ?? snapshot?.siteSettings.defaultShareAssetId ?? null) ??
    assetURL('/images/social/xiaowork-share.png')
  const imageURL = origin ? `${origin}${image}` : undefined
  const shareId = configured?.shareAssetId ?? snapshot?.siteSettings.defaultShareAssetId
  const imageMedia = snapshot?.mediaManifest.find((item) => item.id === shareId)

  useSeoMeta({
    title: metadata.title,
    description: metadata.description,
    ogTitle: metadata.title,
    ogDescription: metadata.description,
    ogType: 'website',
    ogSiteName: snapshot?.siteProfile.name ?? 'XiaoWork',
    ogLocale: 'zh_CN',
    ogUrl: canonical,
    ogImage: imageURL,
    ogImageWidth: origin ? (imageMedia?.width ?? 1200) : undefined,
    ogImageHeight: origin ? (imageMedia?.height ?? 630) : undefined,
    ogImageAlt: origin
      ? imageMedia?.alt ||
        `${snapshot?.siteProfile.name ?? 'XiaoWork'} — ${snapshot?.siteProfile.role ?? 'Developer & Creator'}`
      : undefined,
    twitterCard: 'summary_large_image',
    twitterTitle: metadata.title,
    twitterDescription: metadata.description,
    twitterImage: imageURL,
  })
  useHead({ link: canonical ? [{ rel: 'canonical', href: canonical }] : [] })
}
