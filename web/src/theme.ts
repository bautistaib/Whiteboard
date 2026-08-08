export type Theme = "dark" | "light";

const KEY = "ttrpg:theme";

/** Tema actual (preferencia local, nunca se sincroniza). Default: dark. */
export function getTheme(): Theme {
  return localStorage.getItem(KEY) === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}
