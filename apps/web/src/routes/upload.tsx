import type { StatementSummary } from "@finance-ttijari/api/statements";
import { useNavigate } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, createStore, For, Show } from "solid-js";

import { ENV } from "~/env.public";
import { useSession } from "~/lib/auth-client";
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

function formatPeriod(statement: StatementSummary): string {
  if (!statement.periodStart && !statement.periodEnd) return "-";
  return `${statement.periodStart ?? "?"} to ${statement.periodEnd ?? "?"}`;
}

const statusLabels: Record<StatementSummary["status"], string> = {
  uploaded: "Queued",
  extracting: "Extracting",
  parsed: "Parsed",
  needs_review: "Needs review",
  failed: "Failed",
};

const statusClasses: Record<StatementSummary["status"], string> = {
  uploaded: "bg-gray-200 text-gray-800",
  extracting: "bg-blue-100 text-blue-800",
  parsed: "bg-green-100 text-green-800",
  needs_review: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

function StatusBadge(props: { status: StatementSummary["status"] }) {
  return (
    <span class={`rounded px-2 py-0.5 text-xs font-medium ${statusClasses[props.status]}`}>
      {statusLabels[props.status]}
    </span>
  );
}

export default function Upload() {
  const navigate = useNavigate();
  const session = useSession();

  createEffect(
    () => !session().isPending && !session().data,
    (shouldRedirect) => {
      if (shouldRedirect) navigate("/login", { replace: true });
    },
  );

  return (
    <Show when={!session().isPending && session().data} fallback={<p>Loading...</p>}>
      <UploadPage />
    </Show>
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

  const remove = useMutation(() =>
    orpc.statements.delete.mutationOptions({ onSuccess: () => refreshStatements() }),
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

  function confirmDelete(statement: StatementSummary) {
    const ok = window.confirm(
      `Delete "${statement.fileName}" and its ${statement.transactionCount} transactions? This cannot be undone.`,
    );
    if (ok) remove.mutate({ id: statement.id });
  }

  return (
    <div class="container mx-auto max-w-4xl space-y-6 px-4 py-4">
      <h1 class="text-2xl font-semibold">Statements</h1>

      <div
        role="button"
        tabindex="0"
        class={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center ${dragging() ? "border-blue-500 bg-blue-50" : "border-gray-300"}`}
        onClick={() => fileInput?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") fileInput?.click();
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
        <p class="font-medium">Drop Attijari PDF statements here</p>
        <p class="text-sm text-gray-500">or click to choose files (PDF, up to 10 MB each)</p>
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
        <section class="space-y-2">
          <h2 class="font-medium">Uploads</h2>
          <ul class="space-y-2">
            <For each={uploads.items}>
              {(item) => (
                <li class="rounded border p-3">
                  <div class="flex items-center justify-between gap-4 text-sm">
                    <span class="truncate font-medium">{item.name}</span>
                    <span class="shrink-0 text-gray-500">{formatSize(item.size)}</span>
                  </div>
                  <div class="mt-2 h-2 w-full overflow-hidden rounded bg-gray-200">
                    <div
                      class={`h-full ${item.state === "error" ? "bg-red-500" : "bg-blue-500"}`}
                      style={{ width: `${item.state === "error" ? 100 : item.progress}%` }}
                    />
                  </div>
                  <div class="mt-1 flex items-center gap-2 text-xs text-gray-600">
                    <Show when={item.state === "queued"}>Waiting</Show>
                    <Show when={item.state === "uploading"}>Uploading {item.progress}%</Show>
                    <Show when={item.state === "error"}>
                      <span class="text-red-700">{item.error}</span>
                    </Show>
                    <Show when={statementById(item.statementId)}>
                      {(statement) => <StatusBadge status={statement().status} />}
                    </Show>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <section class="space-y-2">
        <h2 class="font-medium">All statements</h2>
        <Show when={statements.isError}>
          <p class="text-sm text-red-700">Could not load statements: {statements.error?.message}</p>
        </Show>
        <Show
          when={statements.data && statements.data.length > 0}
          fallback={
            <p class="text-sm text-gray-500">
              {statements.isPending ? "Loading..." : "No statements yet."}
            </p>
          }
        >
          <table class="w-full text-left text-sm">
            <thead class="border-b text-gray-500">
              <tr>
                <th class="py-2 pr-2 font-medium">File</th>
                <th class="py-2 pr-2 font-medium">Period</th>
                <th class="py-2 pr-2 font-medium">Status</th>
                <th class="py-2 pr-2 text-right font-medium">Transactions</th>
                <th class="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              <For each={statements.data}>
                {(statement) => (
                  <tr class="border-b align-top">
                    <td class="py-2 pr-2">
                      <div class="max-w-xs truncate">{statement.fileName}</div>
                      <Show when={statement.error}>
                        <div class="text-xs text-red-700">{statement.error}</div>
                      </Show>
                    </td>
                    <td class="py-2 pr-2 whitespace-nowrap">{formatPeriod(statement)}</td>
                    <td class="py-2 pr-2">
                      <StatusBadge status={statement.status} />
                    </td>
                    <td class="py-2 pr-2 text-right">{statement.transactionCount}</td>
                    <td class="py-2 text-right whitespace-nowrap">
                      <a
                        class="mr-3 underline"
                        href={`${SERVER_URL}/api/statements/${statement.id}/original`}
                        target="_blank"
                        rel="noopener"
                      >
                        View PDF
                      </a>
                      <button
                        type="button"
                        class="text-red-700 underline disabled:opacity-50"
                        disabled={remove.isPending}
                        onClick={() => confirmDelete(statement)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </section>
    </div>
  );
}
