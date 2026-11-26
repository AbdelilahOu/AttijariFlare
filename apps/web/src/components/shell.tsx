import type { IconNode } from "lucide";
import {
  CircleUser,
  FileText,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  ReceiptText,
  Split,
  Sun,
  Tags,
  UserX,
} from "lucide";
import { useLocation, useNavigate } from "@solidjs/router";
import { createSignal, createUniqueId, type Element, For, onSettled, Show } from "solid-js";

import DeleteAccountDialog from "~/components/delete-account-dialog";
import Guilloche from "~/components/guilloche";
import Icon from "~/components/icon";
import { SignupPauseBanner } from "~/components/signup-pause";
import { authClient, useSession } from "~/lib/auth-client";
import { setTheme, syncTheme, theme, type ThemeChoice } from "~/lib/theme";

type NavItem = { href: string; label: string; short: string; icon: IconNode };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", short: "Dashboard", icon: LayoutDashboard },
  { href: "/upload", label: "Statements", short: "Statements", icon: FileText },
  { href: "/transactions", label: "Transactions", short: "Transactions", icon: ReceiptText },
  { href: "/withdrawals", label: "Split debits", short: "Splits", icon: Split },
  { href: "/categories", label: "Categories", short: "Categories", icon: Tags },
];

const PUBLIC_PATHS = new Set(["/", "/login", "/privacy"]);

export default function Shell(props: { children: Element }) {
  const location = useLocation();
  const isPublic = () => PUBLIC_PATHS.has(location.pathname);
  onSettled(() => syncTheme());

  return (
    <>
      <a
        href="#main"
        class="sr-only z-50 rounded-control bg-action px-4 py-2 text-action-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Show when={!isPublic()} fallback={<PublicLayout>{props.children}</PublicLayout>}>
        <AppLayout>{props.children}</AppLayout>
      </Show>
    </>
  );
}

function Wordmark(props: { class?: string }) {
  return (
    <a
      href="/"
      class={`inline-flex items-center gap-2.5 rounded-control font-semibold ${props.class ?? ""}`}
    >
      <span class="grid size-8 place-items-center rounded-full bg-flare/15 text-flare">
        <Guilloche class="size-7" />
      </span>
      <span class="text-[1.0625rem] tracking-[-0.01em] max-[379px]:text-[0.9375rem]">
        AttijariFlare
      </span>
    </a>
  );
}

function PublicLayout(props: { children: Element }) {
  const session = useSession();
  const location = useLocation();
  return (
    <div class="flex min-h-svh flex-col">
      <SignupPauseBanner />
      <header class="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-6">
        <Wordmark class="text-ink" />
        <div class="flex items-center gap-1">
          <ThemeCycleButton />
          <Show
            when={!session().isPending && session().data}
            fallback={
              <Show when={location.pathname !== "/login"}>
                <a href="/login?mode=signin" class="btn-quiet">
                  Sign in
                </a>
              </Show>
            }
          >
            <a href="/dashboard" class="btn-primary px-3 sm:px-4">
              <span class="sm:hidden">Dashboard</span>
              <span class="hidden sm:inline">Open dashboard</span>
            </a>
          </Show>
        </div>
      </header>
      <main id="main" class="flex-1">
        {props.children}
      </main>
    </div>
  );
}

function AppLayout(props: { children: Element }) {
  const location = useLocation();
  const isActive = (href: string) =>
    location.pathname === href || location.pathname.startsWith(`${href}/`);

  return (
    <div class="min-h-svh lg:pl-[var(--rail-width)]">
      <SignupPauseBanner />
      {/* Desktop rail */}
      <aside class="fixed inset-y-0 left-0 z-30 hidden w-[var(--rail-width)] flex-col overflow-hidden border-r border-sidebar-line bg-sidebar text-sidebar-ink lg:flex">
        <Guilloche
          draw
          class="pointer-events-none absolute -bottom-24 -left-28 size-[26rem] text-flare/25"
        />
        <div class="relative px-5 pt-6 pb-8">
          <Wordmark class="text-sidebar-ink" />
        </div>
        <nav aria-label="Main" class="relative flex-1 px-3">
          <ul class="space-y-1">
            <For each={NAV}>
              {(item) => (
                <li>
                  <a
                    href={item.href}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    class={[
                      "flex min-h-11 items-center gap-3 rounded-control px-3 text-[0.9375rem] transition-colors duration-150",
                      isActive(item.href)
                        ? "bg-sidebar-active font-medium text-sidebar-ink [&>svg]:text-flare"
                        : "text-sidebar-ink-soft hover:bg-sidebar-active hover:text-sidebar-ink",
                    ]}
                  >
                    <Icon icon={item.icon} />
                    {item.label}
                  </a>
                </li>
              )}
            </For>
          </ul>
        </nav>
        <div class="relative border-t border-sidebar-line bg-sidebar p-3">
          <AccountMenu placement="rail" />
        </div>
      </aside>

      {/* Phone and tablet top bar */}
      <header class="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-rule bg-paper/90 px-4 py-2 backdrop-blur-md sm:px-6 lg:hidden">
        <Wordmark class="text-ink" />
        <AccountMenu placement="bar" />
      </header>

      <main
        id="main"
        class="mx-auto w-full max-w-6xl px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-10 lg:pt-10 lg:pb-16"
      >
        {props.children}
      </main>

      {/* Phone and tablet tab bar */}
      <nav
        aria-label="Main"
        class="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <ul class="mx-auto grid max-w-2xl grid-cols-5">
          <For each={NAV}>
            {(item) => (
              <li>
                <a
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  class={[
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-[0.6875rem] leading-tight transition-colors duration-150",
                    isActive(item.href) ? "font-medium text-ink" : "text-ink-faint hover:text-ink",
                  ]}
                >
                  <span
                    class={[
                      "grid h-7 w-12 place-items-center rounded-full transition-colors duration-200",
                      { "bg-flare-tint text-flare": isActive(item.href) },
                    ]}
                  >
                    <Icon icon={item.icon} size={20} />
                  </span>
                  <span class="max-w-full truncate">{item.short}</span>
                </a>
              </li>
            )}
          </For>
        </ul>
      </nav>
    </div>
  );
}

const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: IconNode }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function ThemeCycleButton() {
  const next = (): ThemeChoice =>
    theme() === "system" ? "light" : theme() === "light" ? "dark" : "system";
  const current = () => THEME_OPTIONS.find((option) => option.value === theme())!;
  return (
    <button
      type="button"
      class="btn-icon btn-ghost"
      aria-label={`Theme: ${current().label}. Switch theme`}
      onClick={() => setTheme(next())}
    >
      <Icon icon={current().icon} />
    </button>
  );
}

function ThemePicker() {
  return (
    <fieldset>
      <legend class="mb-1.5 text-xs text-ink-faint">Theme</legend>
      <div class="grid grid-cols-3 gap-1 rounded-control bg-paper-sunken p-1">
        <For each={THEME_OPTIONS}>
          {(option) => (
            <button
              type="button"
              aria-pressed={theme() === option.value ? "true" : "false"}
              class={[
                "flex min-h-9 items-center justify-center gap-1.5 rounded-[0.5rem] text-xs transition-colors duration-150",
                theme() === option.value
                  ? "bg-paper-raised font-medium text-ink shadow-raised"
                  : "text-ink-soft hover:text-ink",
              ]}
              onClick={() => setTheme(option.value)}
            >
              <Icon icon={option.icon} size={15} />
              {option.label}
            </button>
          )}
        </For>
      </div>
    </fieldset>
  );
}

function AccountMenu(props: { placement: "rail" | "bar" }) {
  const navigate = useNavigate();
  const session = useSession();
  const menuId = createUniqueId();
  const [deleting, setDeleting] = createSignal(false);
  let menu: HTMLDivElement | undefined;

  const signOut = () => {
    menu?.hidePopover();
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          navigate("/", { replace: true });
        },
      },
    });
  };

  return (
    <>
      <Show
        when={!session().isPending}
        fallback={
          <div
            class={[
              "h-11 rounded-control motion-safe:animate-pulse",
              props.placement === "rail" ? "bg-sidebar-active" : "w-11 bg-paper-sunken",
            ]}
          />
        }
      >
        <Show
          when={session().data}
          fallback={
            <a
              href="/login"
              class={props.placement === "rail" ? "btn-primary w-full" : "btn-quiet"}
            >
              Sign in
            </a>
          }
        >
          {(data) => (
            <button
              type="button"
              popovertarget={menuId}
              aria-label={props.placement === "bar" ? `Account, ${data().user.name}` : undefined}
              class={
                props.placement === "rail"
                  ? "flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sidebar-ink-soft transition-colors hover:bg-sidebar-active hover:text-sidebar-ink"
                  : "btn-icon btn-ghost -mr-2"
              }
            >
              <Icon icon={CircleUser} size={props.placement === "rail" ? 20 : 24} />
              <Show when={props.placement === "rail"}>
                <span class="min-w-0 flex-1 truncate text-sm">{data().user.name}</span>
              </Show>
            </button>
          )}
        </Show>
      </Show>

      <div
        ref={(element) => {
          menu = element;
        }}
        id={menuId}
        popover="auto"
        class={[
          "popover-menu m-0 w-64 rounded-panel border border-rule bg-paper-raised p-3 text-ink shadow-overlay",
          props.placement === "rail"
            ? "fixed inset-auto bottom-[4.75rem] left-3"
            : "fixed inset-auto top-[3.5rem] right-3",
        ]}
      >
        <Show when={session().data}>
          {(data) => (
            <div class="mb-3 border-b border-rule px-1 pb-3">
              <p class="truncate font-medium">{data().user.name}</p>
              <p class="truncate text-sm text-ink-soft">{data().user.email}</p>
            </div>
          )}
        </Show>
        <ThemePicker />
        <button type="button" class="btn-ghost mt-3 w-full justify-start" onClick={signOut}>
          <Icon icon={LogOut} size={18} />
          Sign out
        </button>
        <a
          href="/privacy"
          class="btn-ghost w-full justify-start"
          onClick={() => menu?.hidePopover()}
        >
          Privacy
        </a>
        <button
          type="button"
          class="btn-ghost w-full justify-start hover:bg-garnet-tint hover:text-garnet"
          onClick={() => {
            menu?.hidePopover();
            setDeleting(true);
          }}
        >
          <Icon icon={UserX} size={18} />
          Delete my account
        </button>
      </div>
      <DeleteAccountDialog open={deleting()} onClose={() => setDeleting(false)} />
    </>
  );
}
