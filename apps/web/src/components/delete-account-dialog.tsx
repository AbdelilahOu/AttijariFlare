import { useNavigate } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, createUniqueId, Show } from "solid-js";

import { Sheet } from "~/components/dialog";
import { FieldError, Spinner } from "~/components/ui";
import { authClient } from "~/lib/auth-client";

/**
 * "Delete my account": better-auth checks the password, the server deletes every PDF,
 * embedding and finance row of the user (packages/api/src/privacy.ts purgeUserData), then
 * the user, its sessions and credentials.
 */
export default function DeleteAccountDialog(props: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = createSignal<string>();
  const [pending, setPending] = createSignal(false);
  const formId = createUniqueId();
  const passwordId = createUniqueId();

  const close = () => {
    if (pending()) return;
    setError();
    props.onClose();
  };

  const submit = async (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (data.get("confirm") !== "on") {
      setError("Tick the box to confirm.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setPending(true);
    setError();
    const result = await authClient.deleteUser({ password });
    setPending(false);
    if (result.error) {
      setError(result.error.message || "Could not delete the account. Try again.");
      return;
    }
    queryClient.clear();
    await authClient.useSession.get().refetch();
    navigate("/", { replace: true });
  };

  return (
    <Sheet
      open={props.open}
      title="Delete my account"
      onClose={close}
      footer={
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" class="btn-quiet" onClick={close} disabled={pending()}>
            Cancel
          </button>
          <button type="submit" form={formId} class="btn-danger" disabled={pending()}>
            <Show when={pending()}>
              <Spinner class="size-[18px]" />
            </Show>
            {pending() ? "Deleting everything" : "Delete my account"}
          </button>
        </div>
      }
    >
      <form id={formId} method="post" onSubmit={submit} class="space-y-4">
        <p class="text-sm text-ink-soft">
          This permanently deletes every statement PDF, all transactions, categories, splits and
          merchant data, then your account and sessions. It cannot be undone. Database backups kept
          by Cloudflare expire within 7 days.
        </p>
        <div>
          <label for={passwordId} class="field-label">
            Password
          </label>
          <input
            id={passwordId}
            name="password"
            type="password"
            required
            autocomplete="current-password"
            class="field"
          />
        </div>
        <label class="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" name="confirm" class="mt-0.5 size-5 shrink-0 accent-garnet" />
          <span>I understand that my data and my account will be deleted.</span>
        </label>
        <FieldError message={error()} />
      </form>
    </Sheet>
  );
}
