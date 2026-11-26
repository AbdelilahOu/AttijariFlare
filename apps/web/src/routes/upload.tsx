import Seo from "~/components/seo";
import type { StatementSummary } from "@attijari-flare/api/statements";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { CircleCheck, CloudUpload, ExternalLink, FileText, Trash } from "lucide";
import { createSignal, createStore, For, Show } from "solid-js";

import { ENV } from "~/env.public";
import { ConfirmDialog } from "~/components/dialog";
import Icon from "~/components/icon";
import {
  EmptyState,
  ErrorNotice,
  PageHeader,
  RequireSession,
  SkeletonRows,
  StatusBadge,
} from "~/components/ui";
import { formatPeriod, plural } from "~/lib/format";
import { orpc } from "~/utils/orpc";

const SERVER_URL = ENV.VITE_SERVER_URL.replace(/\/$/, "");
const MAX_BYTES = 10 * 1024 * 1024;
const POLL_MS = 3000;
const PENDING_STATUSES = new Set(["uploaded", "extracting"]);

type UploadState = "queued" | "uploading" | "done" | "error";

type UploadItem = {
  key: string;
  name: string;
  size: number;
  progress: number;
  state: UploadState;
  error?: string;
  statementId?: string;
};

type UploadResult = { ok: true; id: string } | { ok: false; message: string; existingId?: string };

function uploadFile(file: File, onProgress: (percent: number) => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SERVER_URL}/api/statements`);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const body = xhr.response as { id?: string; message?: string; existingId?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.id) {
        resolve({ ok: true, id: body.id });
      } else {
        resolve({
          ok: false,
          message: body?.message ?? `Upload failed (HTTP ${xhr.status}).`,
          existingId: body?.existingId,
        });
      }
    };
    xhr.onerror = () => resolve({ ok: false, message: "Network error during upload." });
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Upload() {
  return (
    <>
      <Seo title="Statements - AttijariFlare" path="/upload" noindex />
      <RequireSession>
        <UploadPage />
      </RequireSession>
    </>
  );
}

function UploadPage() {
  const queryClient = useQueryClient();
  const [uploads, setUploads] = createStore<{ items: UploadItem[] }>({ items: [] });
  const [dragging, setDragging] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;
  let nextKey = 0;

  const statements = useQuery(() =>
    orpc.statements.list.queryOptions({
      refetchInterval: (query) =>
        query.state.data?.some((statement) => PENDING_STATUSES.has(statement.status))
          ? POLL_MS
          : false,
    }),
  );

  const refreshStatements = () =>
    queryClient.invalidateQueries({ queryKey: orpc.statements.list.key() });

  const [pendingDelete, setPendingDelete] = createSignal<StatementSummary | null>(null);
  const remove = useMutation(() =>
    orpc.statements.delete.mutationOptions({
      onSuccess: () => refreshStatements(),
      onSettled: () => setPendingDelete(null),
    }),
  );

  const statementById = (id: string | undefined) =>
    id ? statements.data?.find((statement) => statement.id === id) : undefined;

  const updateItem = (key: string, patch: Partial<UploadItem>) =>
    setUploads((draft) => {
      const item = draft.items.find((candidate) => candidate.key === key);
      if (item) Object.assign(item, patch);
    });

  async function startUploads(files: File[]) {
    const queued = files.map((file) => {
      const item: UploadItem = {
        key: `upload-${nextKey++}`,
        name: file.name,
        size: file.size,
        progress: 0,
        state: "queued",
      };
      if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
        item.state = "error";
        item.error = "Not a PDF file.";
      } else if (file.size > MAX_BYTES) {
        item.state = "error";
        item.error = `Larger than ${formatSize(MAX_BYTES)}.`;
      }
      return { file, item };
    });
    setUploads((draft) => {
      draft.items.unshift(...queued.map(({ item }) => item));
    });

    // Upload one file at a time so each request stays small and progress is easy to follow.
    for (const { file, item } of queued) {
      if (item.state === "error") continue;
      updateItem(item.key, { state: "uploading" });
      const result = await uploadFile(file, (progress) => updateItem(item.key, { progress }));
      if (result.ok) {
        updateItem(item.key, { state: "done", progress: 100, statementId: result.id });
      } else {
        updateItem(item.key, {
          state: "error",
          error: result.message,
          statementId: result.existingId,
        });
      }
      await refreshStatements();
    }
  }

  function onFiles(list: FileList | null | undefined) {
    if (list && list.length > 0) void startUploads(Array.from(list));
  }

  function confirmDelete() {
    const statement = pendingDelete();
    if (!statement) return;
    remove.mutate({ id: statement.id });
  }

  const pdfUrl = (id: string) => `${SERVER_URL}/api/statements/${id}/original`;

  return (
    <div class="space-y-10">
      <PageHeader
        title="Statements"
        description="Upload your monthly Attijari PDF statements. Transactions are extracted and categorized in the background."
      />

      <section aria-labelledby="upload-title" class="-mt-4 space-y-4">
        <h2 id="upload-title" class="sr-only">
          Upload statements
        </h2>
        <div
          role="button"
          tabindex="0"
          aria-describedby="upload-hint"
          class={[
            "group relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-panel border-2 border-dashed px-6 py-10 text-center transition-[background-color,border-color] duration-200 sm:py-14",
            dragging()
              ? "border-action bg-action-tint"
              : "border-rule-strong bg-paper-raised hover:border-action/60",
          ]}
          onClick={() => fileInput?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileInput?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            onFiles(event.dataTransfer?.files);
          }}
        >
          <span
            class={[
              "grid size-14 place-items-center rounded-full bg-flare text-flare-ink transition-transform duration-300",
              dragging() ? "-translate-y-1 scale-110" : "group-hover:-translate-y-0.5",
            ]}
          >
            <Icon icon={CloudUpload} size={26} />
          </span>
          <div>
            <p class="text-lg font-semibold">
              {dragging() ? "Drop to upload" : "Drop Attijari PDF statements here"}
            </p>
            <p id="upload-hint" class="mt-1 text-sm text-ink-soft">
              or <span class="font-medium text-action underline">choose files</span>. PDF, up to 10
              MB each.
            </p>
          </div>
          <input
            ref={(element) => {
              fileInput = element;
            }}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            class="hidden"
            onChange={(event) => {
              onFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </div>

        <Show when={uploads.items.length > 0}>
          <ul class="space-y-2" aria-label="Uploads">
            <For each={uploads.items}>
              {(item) => (
                <li class="arrive panel p-3.5">
                  <div class="flex items-center gap-3 text-sm">
                    <span
                      class={[
                        "grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-300",
                        item.state === "error"
                          ? "bg-garnet-tint text-garnet"
                          : item.state === "done"
                            ? "bg-mint-tint text-mint"
                            : "bg-action-tint text-action",
                      ]}
                    >
                      <Icon icon={item.state === "done" ? CircleCheck : FileText} size={18} />
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-baseline justify-between gap-3">
                        <span class="truncate font-medium">{item.name}</span>
                        <span class="figures shrink-0 text-xs text-ink-faint">
                          {formatSize(item.size)}
                        </span>
                      </div>
                      <div
                        class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-paper-sunken"
                        role="progressbar"
                        aria-label={`Upload of ${item.name}`}
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-valuenow={item.state === "error" ? 0 : item.progress}
                      >
                        <div
                          class={[
                            "meter h-full w-full rounded-full",
                            item.state === "error"
                              ? "bg-garnet"
                              : item.state === "done"
                                ? "bg-mint"
                                : "bg-flare",
                          ]}
                          style={{
                            transform: `scaleX(${item.state === "error" ? 1 : item.progress / 100})`,
                          }}
                        />
                      </div>
                      <div class="mt-1.5 flex min-h-6 flex-wrap items-center gap-2 text-xs text-ink-soft">
                        <Show when={item.state === "queued"}>Waiting</Show>
                        <Show when={item.state === "uploading"}>
                          <span class="figures">Uploading {item.progress}%</span>
                        </Show>
                        <Show when={item.state === "done" && !statementById(item.statementId)}>
                          Uploaded
                        </Show>
                        <Show when={item.state === "error"}>
                          <span class="text-garnet">{item.error}</span>
                        </Show>
                        <Show when={statementById(item.statementId)}>
                          {(statement) => <StatusBadge status={statement().status} />}
                        </Show>
                      </div>
                    </div>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section aria-labelledby="all-statements-title">
        <h2 id="all-statements-title" class="mb-3 text-lg font-semibold">
          All statements
        </h2>
        <Show when={statements.isError}>
          <ErrorNotice title="Could not load statements" message={statements.error?.message} />
        </Show>
        <Show when={remove.isError}>
          <div class="mb-3">
            <ErrorNotice title="Could not delete the statement" message={remove.error?.message} />
          </div>
        </Show>
        <Show
          when={statements.data && statements.data.length > 0}
          fallback={
            <Show when={!statements.isPending} fallback={<SkeletonRows rows={3} />}>
              <EmptyState icon={FileText} title="No statements yet">
                Your first upload appears here with its extraction status.
              </EmptyState>
            </Show>
          }
        >
          <div class="overflow-hidden rounded-panel border border-rule bg-paper-raised">
            <div
              class="hidden grid-cols-[minmax(0,1fr)_15rem_9rem_7rem_12rem] gap-4 border-b border-rule bg-paper-sunken/60 px-4 py-2.5 text-xs font-medium text-ink-soft xl:grid"
              aria-hidden="true"
            >
              <span>File</span>
              <span>Period</span>
              <span>Status</span>
              <span class="text-right">Transactions</span>
              <span />
            </div>
            <ul class="divide-y divide-rule">
              <For each={statements.data}>
                {(statement) => (
                  <li class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-4 py-3.5 xl:grid-cols-[minmax(0,1fr)_15rem_9rem_7rem_12rem] xl:items-center">
                    <div class="min-w-0">
                      <p class="truncate font-medium">{statement.fileName}</p>
                      <p class="figures mt-0.5 text-xs text-ink-soft xl:hidden">
                        {formatPeriod(statement.periodStart, statement.periodEnd)}
                        {", "}
                        {plural(statement.transactionCount, "transaction")}
                      </p>
                      <Show when={statement.error}>
                        <p class="mt-1 text-xs break-words text-garnet">{statement.error}</p>
                      </Show>
                    </div>
                    <div class="figures hidden text-sm xl:block">
                      {formatPeriod(statement.periodStart, statement.periodEnd)}
                    </div>
                    <div class="col-start-2 row-start-1 justify-self-end xl:col-start-auto xl:row-start-auto xl:justify-self-start">
                      <StatusBadge status={statement.status} />
                    </div>
                    <div class="figures hidden text-right text-sm xl:block">
                      {statement.transactionCount}
                    </div>
                    <div class="col-span-2 -mb-1 -ml-3 flex gap-1 xl:col-span-1 xl:ml-0 xl:justify-end">
                      <a
                        class="btn-ghost min-h-10 px-3"
                        href={pdfUrl(statement.id)}
                        target="_blank"
                        rel="noopener"
                      >
                        <Icon icon={ExternalLink} size={16} />
                        View PDF
                        <span class="sr-only">(opens in a new tab)</span>
                      </a>
                      <button
                        type="button"
                        class="btn-ghost min-h-10 px-3 hover:bg-garnet-tint hover:text-garnet"
                        disabled={remove.isPending}
                        onClick={() => setPendingDelete(statement)}
                      >
                        <Icon icon={Trash} size={16} />
                        Delete
                      </button>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </section>

      <ConfirmDialog
        open={pendingDelete() !== null}
        title="Delete this statement?"
        message={
          pendingDelete()
            ? `"${pendingDelete()?.fileName}" and its ${plural(pendingDelete()?.transactionCount ?? 0, "transaction")} will be deleted. This cannot be undone.`
            : ""
        }
        confirmLabel={remove.isPending ? "Deleting" : "Delete statement"}
        pending={remove.isPending}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
