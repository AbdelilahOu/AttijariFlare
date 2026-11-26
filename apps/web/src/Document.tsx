import { HydrationScript } from "@solidjs/web";
import type { ParentProps } from "solid-js";

import latinFont from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";

import { THEME_SCRIPT } from "~/lib/theme";

export default function Document(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f7f7f7" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#141414" media="(prefers-color-scheme: dark)" />
        <link rel="preload" href={latinFont} as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <script innerHTML={THEME_SCRIPT} />
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
