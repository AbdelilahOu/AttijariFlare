import { ShieldAlert } from "lucide";
import { Show } from "solid-js";

import Icon from "~/components/icon";
import { SELF_HOST_URL, SIGNUPS_ENABLED } from "~/lib/signups";

/** Site-wide notice while sign-ups are paused for the CNDP declaration. Not dismissible. */
export function SignupPauseBanner() {
  return (
    <Show when={!SIGNUPS_ENABLED}>
      <div role="status" class="border-b border-saffron/40 bg-saffron-tint text-ink">
        <div class="mx-auto flex w-full max-w-6xl items-start gap-2.5 px-4 py-2.5 text-sm sm:px-6">
          <Icon icon={ShieldAlert} size={18} class="mt-0.5 text-saffron" />
          <p>
            New sign-ups are paused while we complete our declaration with the CNDP (Morocco's data
            protection authority).{" "}
            <a href={SELF_HOST_URL} class="font-medium underline underline-offset-2" rel="noopener">
              Want to use AttijariFlare now? Fork it and self-host it on your own Cloudflare
              account.
            </a>
          </p>
        </div>
      </div>
    </Show>
  );
}

/** Shown on the sign-up page in place of the form. */
export function SignupPausedPanel(props: { onSwitchToSignIn: () => void }) {
  return (
    <div class="w-full">
      <h1 class="text-2xl font-semibold lg:text-3xl">Sign-ups are paused</h1>
      <p class="mt-3 text-ink-soft">
        We are completing our declaration with the CNDP, Morocco's data protection authority, under
        law 09-08. Until it is done, no new accounts can be created here. Existing accounts can
        still sign in.
      </p>
      <p class="mt-3 text-ink-soft">
        Want to use AttijariFlare now? It is open source: fork it and self-host it on your own
        Cloudflare account, on the free tier.
      </p>
      <div class="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" class="btn-primary" onClick={props.onSwitchToSignIn}>
          Sign in
        </button>
        <a href={SELF_HOST_URL} class="btn-quiet" rel="noopener">
          Self-host it
        </a>
      </div>
    </div>
  );
}
