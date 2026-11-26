import { useLocation } from "@solidjs/router";
import { createSignal, Match, Switch } from "solid-js";

import Guilloche from "~/components/guilloche";
import Seo from "~/components/seo";
import SignInForm from "~/components/sign-in-form";
import SignUpForm from "~/components/sign-up-form";

export default function Login() {
  // "/login?mode=signin" opens the sign-in form; the default is sign-up.
  const location = useLocation();
  const [showSignIn, setShowSignIn] = createSignal(
    new URLSearchParams(location.search).get("mode") === "signin",
  );

  return (
    <>
      <Seo
        title="Sign in or create an account - AttijariFlare"
        description="Create a free AttijariFlare account to track spending from your Attijariwafa bank PDF statements in MAD, or sign in to your dashboard."
        path="/login"
      />
      <div class="mx-auto grid w-full max-w-6xl gap-8 px-4 pt-4 pb-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16 lg:pt-10">
        <aside class="relative hidden overflow-hidden rounded-[1.25rem] bg-rail p-10 text-rail-ink lg:flex lg:min-h-[32rem] lg:flex-col lg:justify-end">
          <Guilloche
            draw
            class="pointer-events-none absolute -top-24 -right-24 size-[30rem] text-flare/35"
          />
          <p class="relative max-w-[18ch] text-3xl leading-tight font-semibold">
            Every dirham from your statements, in its place.
          </p>
          <p class="relative mt-4 max-w-[44ch] text-rail-ink-soft">
            Upload the monthly Attijari PDF, check the few lines the app is unsure about, and read
            where the money went.
          </p>
        </aside>
        <div class="flex items-center lg:py-10">
          <Switch>
            <Match when={showSignIn()}>
              <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
            </Match>
            <Match when={!showSignIn()}>
              <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
            </Match>
          </Switch>
        </div>
      </div>
    </>
  );
}
