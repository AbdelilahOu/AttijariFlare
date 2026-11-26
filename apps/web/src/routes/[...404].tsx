import { Meta, Title } from "@solidjs/meta";
import type { RouteDefinition } from "@solidjs/router";
import { httpStatus } from "@solidjs/web";

import Guilloche from "~/components/guilloche";

export const route = {
  preload: () => httpStatus(404),
} satisfies RouteDefinition;

export default function NotFound() {
  return (
    <div class="flex min-h-[60vh] flex-col items-start justify-center gap-6 sm:items-center sm:text-center">
      <Title>Page not found - AttijariFlare</Title>
      <Meta name="robots" content="noindex, nofollow" />
      <Guilloche class="size-28 text-flare/60" />
      <div>
        <h1 class="text-2xl font-semibold lg:text-3xl">Page not found</h1>
        <p class="mt-2 max-w-[44ch] text-ink-soft">
          This address does not match any page. Check the link, or go back to your dashboard.
        </p>
      </div>
      <a href="/dashboard" class="btn-primary">
        Go to the dashboard
      </a>
    </div>
  );
}
