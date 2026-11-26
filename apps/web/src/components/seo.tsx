import { Link, Meta, Title } from "@solidjs/meta";
import { Show } from "solid-js";

import { canonicalUrl, isIndexableHost, OG_IMAGE, SITE_NAME } from "~/lib/seo";

/**
 * Per-page head tags: title, description, canonical, robots, Open Graph and Twitter card.
 * `noindex` marks app-only pages; every non-production host is noindex regardless.
 */
export default function Seo(props: {
  title: string;
  description?: string;
  path: string;
  noindex?: boolean;
}) {
  const robots = () =>
    props.noindex || !isIndexableHost() ? "noindex, nofollow" : "index, follow";
  const url = () => canonicalUrl(props.path);

  return (
    <>
      <Title>{props.title}</Title>
      <Meta name="robots" content={robots()} />
      <Link rel="canonical" href={url()} />
      <Show when={props.description}>
        {(description) => (
          <>
            <Meta name="description" content={description()} />
            <Meta property="og:type" content="website" />
            <Meta property="og:site_name" content={SITE_NAME} />
            <Meta property="og:title" content={props.title} />
            <Meta property="og:description" content={description()} />
            <Meta property="og:url" content={url()} />
            <Meta property="og:image" content={OG_IMAGE} />
            <Meta property="og:image:width" content="1200" />
            <Meta property="og:image:height" content="630" />
            <Meta
              property="og:image:alt"
              content="AttijariFlare dashboard with money in, money out and spending by category in MAD"
            />
            <Meta property="og:locale" content="en_US" />
            <Meta name="twitter:card" content="summary_large_image" />
            <Meta name="twitter:title" content={props.title} />
            <Meta name="twitter:description" content={description()} />
            <Meta name="twitter:image" content={OG_IMAGE} />
          </>
        )}
      </Show>
    </>
  );
}
