import { createSignal } from "solid-js";

// Theme preference: "system" follows prefers-color-scheme; "light" and "dark" pin it.
// The choice is stored in localStorage and applied as data-theme on <html>. THEME_SCRIPT
// runs before first paint (see Document.tsx) so a pinned theme never flashes.

export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "theme";

export const THEME_SCRIPT = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function readChoice(): ThemeChoice {
  if (typeof document === "undefined") return "system";
  const value = document.documentElement.dataset.theme;
  return value === "light" || value === "dark" ? value : "system";
}

const [theme, setThemeSignal] = createSignal<ThemeChoice>("system");

/** Syncs the signal with what THEME_SCRIPT applied. Call once on the client after hydration. */
export function syncTheme() {
  setThemeSignal(readChoice());
}

export { theme };

export function setTheme(choice: ThemeChoice) {
  setThemeSignal(choice);
  const root = document.documentElement;
  try {
    if (choice === "system") {
      delete root.dataset.theme;
      localStorage.removeItem(STORAGE_KEY);
    } else {
      root.dataset.theme = choice;
      localStorage.setItem(STORAGE_KEY, choice);
    }
  } catch {
    // Storage can be unavailable (private mode); the choice still applies to this page.
  }
}
