/** Light or dark. The choice lives on <html data-theme> and, once made, in this browser's local storage. */
export type Theme = "dark" | "light";

export const THEME_EVENT = "spondon-theme";
const KEY = "spondon-theme";

/** Runs in <head> before first paint, so the page never flashes the wrong theme. */
export const THEME_BOOT = `(function(){var d=document.documentElement;try{var t=localStorage.getItem("${KEY}");d.dataset.theme=t==="light"?"light":"dark"}catch(e){d.dataset.theme="dark"}d.classList.add("js")})()`;

export function getTheme(): Theme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the choice simply lasts for this page */
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function subscribeTheme(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}
