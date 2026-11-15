/** Light or dark. The choice lives on <html data-theme> and, once made, in this browser's local storage. */
export type Theme = "dark" | "light";

export const THEME_EVENT = "spondon-theme";
const KEY = "spondon-theme";

/**
 * Runs in <head> before first paint, so the page never flashes the wrong theme.
 * A choice made with the toggle wins; until then the page follows the system setting, dark by default.
 */
export const THEME_BOOT = `(function(){var d=document.documentElement,t=null;try{t=localStorage.getItem("${KEY}")}catch(e){}if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";d.dataset.theme=t;d.classList.add("js")})()`;

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
