import { HydrationScript } from "@solidjs/web";
import type { ParentProps } from "solid-js";

import { THEME_SCRIPT } from "~/lib/theme";

export default function Document(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f1f4f1" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0d1226" media="(prefers-color-scheme: dark)" />
        <script innerHTML={THEME_SCRIPT} />
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
