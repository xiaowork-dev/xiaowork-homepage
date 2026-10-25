import { pageSeo } from '#shared/seo'

export function useSiteSeo(page: keyof typeof pageSeo) {
  const config = useRuntimeConfig()
  const metadata = pageSeo[page]
  const origin = config.public.siteUrl
  const canonical = origin ? `${origin}${metadata.path}` : undefined

  useSeoMeta({
    title: metadata.title,
    description: metadata.description,
    ogTitle: metadata.title,
    ogDescription: metadata.description,
    ogType: 'website',
    ogSiteName: 'XiaoWork',
    ogLocale: 'zh_CN',
    ogUrl: canonical,
    ogImage: origin ? `${origin}/images/social/xiaowork-share.png` : undefined,
    ogImageWidth: origin ? 1200 : undefined,
    ogImageHeight: origin ? 630 : undefined,
    ogImageAlt: origin ? 'XiaoWork — Developer & Creator，网站、应用与实用工具' : undefined,
    twitterCard: 'summary_large_image',
    twitterTitle: metadata.title,
    twitterDescription: metadata.description,
    twitterImage: origin ? `${origin}/images/social/xiaowork-share.png` : undefined,
  })
  useHead({ link: canonical ? [{ rel: 'canonical', href: canonical }] : [] })
}
