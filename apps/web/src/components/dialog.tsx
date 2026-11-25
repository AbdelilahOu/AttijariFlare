import { X } from "lucide";
import { createEffect, createUniqueId, type Element, Show } from "solid-js";

import Icon from "~/components/icon";

// Native <dialog> wrappers: focus is trapped and restored by the browser, Escape closes.

function useDialog(open: () => boolean) {
  let element: HTMLDialogElement | undefined;
  createEffect(open, (isOpen) => {
    if (!element) return;
    if (isOpen && !element.open) element.showModal();
    if (!isOpen && element.open) element.close();
  });
  return {
    ref: (el: HTMLDialogElement) => {
      element = el;
    },
    /** Closes when the click lands on the backdrop (the dialog box itself, outside its body). */
    onBackdrop: (event: MouseEvent, close: () => void) => {
      if (event.target === element) close();
    },
  };
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialog = useDialog(() => props.open);
  const titleId = createUniqueId();
  return (
    <dialog
      ref={dialog.ref}
      class="modal m-auto w-[min(28rem,calc(100vw-2rem))] rounded-panel bg-paper-raised p-0 text-ink shadow-overlay"
      aria-labelledby={titleId}
      onClose={() => props.onClose()}
      onClick={(event) => dialog.onBackdrop(event, props.onClose)}
    >
      <div class="p-5">
        <h2 id={titleId} class="text-lg font-semibold">
          {props.title}
        </h2>
        <p class="mt-2 text-sm break-words text-ink-soft">{props.message}</p>
        <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" class="btn-quiet" onClick={() => props.onClose()}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-danger"
            disabled={props.pending}
            onClick={() => props.onConfirm()}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** Bottom sheet on phones, centered panel from the sm breakpoint. */
export function Sheet(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: Element;
  children: Element;
}) {
  const dialog = useDialog(() => props.open);
  const titleId = createUniqueId();
  return (
    <dialog
      ref={dialog.ref}
      class="sheet mx-0 mt-auto mb-0 max-h-[85svh] w-full max-w-none rounded-t-[1.25rem] bg-paper-raised p-0 text-ink shadow-overlay sm:m-auto sm:w-[min(32rem,calc(100vw-2rem))] sm:rounded-panel"
      aria-labelledby={titleId}
      onClose={() => props.onClose()}
      onClick={(event) => dialog.onBackdrop(event, props.onClose)}
    >
      <div class="flex items-center justify-between border-b border-rule px-5 py-3">
        <h2 id={titleId} class="text-lg font-semibold">
          {props.title}
        </h2>
        <button
          type="button"
          class="btn-icon btn-ghost -mr-2"
          aria-label="Close"
          onClick={() => props.onClose()}
        >
          <Icon icon={X} />
        </button>
      </div>
      <div class="overflow-y-auto px-5 py-4">{props.children}</div>
      <Show when={props.footer}>
        <div class="border-t border-rule px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {props.footer}
        </div>
      </Show>
    </dialog>
  );
}
