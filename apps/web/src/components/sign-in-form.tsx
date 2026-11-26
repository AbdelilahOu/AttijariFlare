import { useNavigate } from "@solidjs/router";
import { createSignal, onSettled, Show } from "solid-js";
import z from "zod";

import { FieldError, Spinner } from "~/components/ui";
import { authClient } from "~/lib/auth-client";
import { SELF_HOST_URL, SIGNUPS_ENABLED } from "~/lib/signups";

const signInSchema = z.object({
  email: z.email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export default function SignInForm({ onSwitchToSignUp }: { onSwitchToSignUp: () => void }) {
  const navigate = useNavigate();
  const [error, setError] = createSignal<string>();
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [hydrated, setHydrated] = createSignal(false);
  onSettled(() => {
    setHydrated(true);
  });

  const submit = async (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
    event.preventDefault();
    const result = signInSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }

    setIsSubmitting(true);
    setError();
    try {
      await authClient.signIn.email(result.data, {
        onSuccess: async () => {
          await authClient.useSession.get().refetch();
          const session = authClient.useSession.get();
          if (!session.data) {
            setError(
              session.error?.message || "Unable to load your session. Please sign in again.",
            );
            return;
          }
          navigate("/dashboard");
        },
        onError: ({ error }) => {
          setError(error.message);
        },
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div class="w-full">
      <h1 class="text-2xl font-semibold lg:text-3xl">Welcome back</h1>
      <p class="mt-2 text-sm text-ink-soft">Sign in to review your statements.</p>
      <form method="post" onSubmit={submit} class="mt-8 space-y-4">
        <div>
          <label for="email" class="field-label">
            Email
          </label>
          <input id="email" name="email" type="email" required autocomplete="email" class="field" />
        </div>
        <div>
          <label for="password" class="field-label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            minlength="8"
            required
            autocomplete="current-password"
            class="field"
          />
        </div>
        <FieldError message={error()} />
        <button type="submit" class="btn-primary w-full" disabled={!hydrated() || isSubmitting()}>
          <Show when={isSubmitting()}>
            <Spinner class="size-[18px]" />
          </Show>
          {isSubmitting() ? "Signing in" : "Sign in"}
        </button>
      </form>
      <p class="mt-6 text-sm text-ink-soft">
        Need an account?{" "}
        <Show
          when={SIGNUPS_ENABLED}
          fallback={
            <>
              Sign-ups are paused here, but you can{" "}
              <a href={SELF_HOST_URL} class="link min-h-11" rel="noopener">
                self-host it
              </a>
              .
            </>
          }
        >
          <button type="button" onClick={onSwitchToSignUp} class="link min-h-11">
            Create one
          </button>
        </Show>
      </p>
    </div>
  );
}
