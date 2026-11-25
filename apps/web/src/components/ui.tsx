import type { IconNode } from "lucide";
import {
  CircleCheck,
  CircleX,
  Clock,
  FileSearch,
  LoaderCircle,
  TriangleExclamationPoint,
} from "lucide";
import { useNavigate } from "@solidjs/router";
import { createEffect, type Element, For, Show } from "solid-js";

import Icon from "~/components/icon";
import { formatMad, formatSignedMad } from "~/lib/format";
import { useSession } from "~/lib/auth-client";

/* Money */

/**
 * A MAD amount in tabular figures. `signed` shows "+" on credits and colors them mint;
 * debits keep the ink color with a minus sign.
 */
export function Money(props: {
  centimes: number;
  signed?: boolean;
  currency?: boolean;
  class?: string;
}) {
  const text = () =>
    props.signed
      ? formatSignedMad(props.centimes, { currency: props.currency })
      : formatMad(props.centimes, { currency: props.currency });
  return (
    <span
      class={[
        "figures whitespace-nowrap",
        { "text-mint": !!props.signed && props.centimes > 0 },
        props.class ?? "",
      ]}
    >
      {text()}
    </span>
  );
}

/* Statement status */

export type StatementStatus = "uploaded" | "extracting" | "parsed" | "needs_review" | "failed";

const statusMeta: Record<StatementStatus, { label: string; icon: IconNode; class: string }> = {
  uploaded: { label: "Queued", icon: Clock, class: "bg-paper-sunken text-ink-soft" },
  extracting: {
    label: "Extracting",
    icon: LoaderCircle,
    class: "bg-action-tint text-action",
  },
  parsed: { label: "Parsed", icon: CircleCheck, class: "bg-mint-tint text-mint" },
  needs_review: {
    label: "Needs review",
    icon: FileSearch,
    class: "bg-saffron-tint text-saffron",
  },
  failed: { label: "Failed", icon: CircleX, class: "bg-garnet-tint text-garnet" },
};

export function StatusBadge(props: { status: StatementStatus }) {
  const meta = () => statusMeta[props.status];
  return (
    <span
      class={`inline-flex items-center gap-1 rounded-full py-0.5 pr-2.5 pl-1.5 text-xs font-medium whitespace-nowrap transition-colors duration-300 ${meta().class}`}
    >
      <Icon
        icon={meta().icon}
        size={14}
        strokeWidth={2}
        class={props.status === "extracting" ? "motion-safe:animate-spin" : ""}
      />
      {meta().label}
    </span>
  );
}

/* Page structure */

export function PageHeader(props: { title: string; description?: string; actions?: Element }) {
  return (
    <header class="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold lg:text-3xl">{props.title}</h1>
        <Show when={props.description}>
          <p class="mt-2 max-w-[62ch] text-sm text-ink-soft">{props.description}</p>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="flex flex-wrap items-center gap-2">{props.actions}</div>
      </Show>
    </header>
  );
}

export function Section(props: {
  title: string;
  titleId?: string;
  action?: Element;
  class?: string;
  children: Element;
}) {
  return (
    <section class={props.class ?? ""} aria-labelledby={props.titleId}>
      <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={props.titleId} class="text-lg font-semibold">
          {props.title}
        </h2>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

export function EmptyState(props: {
  icon: IconNode;
  title: string;
  children?: Element;
  action?: Element;
}) {
  return (
    <div class="flex flex-col items-start gap-3 rounded-panel border border-dashed border-rule-strong px-5 py-8 sm:items-center sm:text-center">
      <span class="grid size-11 place-items-center rounded-full bg-action-tint text-action">
        <Icon icon={props.icon} size={22} />
      </span>
      <div>
        <p class="font-medium">{props.title}</p>
        <Show when={props.children}>
          <p class="mt-1 max-w-[52ch] text-sm text-ink-soft">{props.children}</p>
        </Show>
      </div>
      {props.action}
    </div>
  );
}

export function ErrorNotice(props: { title: string; message?: string; action?: Element }) {
  return (
    <div
      role="alert"
      class="flex items-start gap-3 rounded-panel border border-garnet/30 bg-garnet-tint p-4 text-sm"
    >
      <Icon icon={TriangleExclamationPoint} class="mt-0.5 text-garnet" />
      <div class="min-w-0 flex-1">
        <p class="font-medium text-ink">{props.title}</p>
        <Show when={props.message}>
          <p class="mt-0.5 break-words text-ink-soft">{props.message}</p>
        </Show>
      </div>
      {props.action}
    </div>
  );
}

export function FieldError(props: { message: string | undefined }) {
  return (
    <Show when={props.message}>
      {(message) => (
        <p role="alert" class="arrive flex items-center gap-1.5 text-sm text-garnet">
          <Icon icon={TriangleExclamationPoint} size={16} />
          {message()}
        </p>
      )}
    </Show>
  );
}

/* Loading */

export function Spinner(props: { class?: string; label?: string }) {
  return (
    <Icon
      icon={LoaderCircle}
      class={`motion-safe:animate-spin ${props.class ?? ""}`}
      label={props.label}
    />
  );
}

/** Placeholder rows while a list loads. */
export function SkeletonRows(props: { rows?: number; class?: string }) {
  return (
    <div role="status" class={`space-y-2 ${props.class ?? ""}`}>
      <span class="sr-only">Loading</span>
      <For each={Array.from({ length: props.rows ?? 4 }, (_, index) => index)}>
        {(index) => (
          <div
            class="h-14 rounded-control bg-paper-sunken motion-safe:animate-pulse"
            style={{ opacity: String(1 - index * 0.18) }}
          />
        )}
      </For>
    </div>
  );
}

export function PageLoader() {
  return (
    <div class="grid min-h-[50vh] place-items-center text-ink-faint" role="status">
      <Spinner class="size-6" />
      <span class="sr-only">Loading</span>
    </div>
  );
}

/** Short-lived confirmation shown after a save. */
export function SavedStamp(props: { label?: string }) {
  return (
    <span
      role="status"
      class="stamp inline-flex items-center gap-1 rounded-full bg-mint-tint px-2 py-0.5 text-xs font-medium text-mint"
    >
      <Icon icon={CircleCheck} size={14} strokeWidth={2} />
      {props.label ?? "Saved"}
    </span>
  );
}

/* Session gate */

/** Renders children for a signed-in owner and sends everyone else to /login. */
export function RequireSession(props: { children: Element }) {
  const navigate = useNavigate();
  const session = useSession();

  createEffect(
    () => !session().isPending && !session().data,
    (shouldRedirect) => {
      if (shouldRedirect) navigate("/login", { replace: true });
    },
  );

  return (
    <Show when={!session().isPending && session().data} fallback={<PageLoader />}>
      {props.children}
    </Show>
  );
}
