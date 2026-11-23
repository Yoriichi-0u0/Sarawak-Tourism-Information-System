export type ThemeChoice = "auto" | "light" | "dark";
type ThemeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ThemeRoot = { setAttribute(name: string, value: string): void; removeAttribute(name: string): void };

export const themeChoices = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]] as const;
const key = "stis-theme";

export function browserStorage(): ThemeStorage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

export function readTheme(storage: ThemeStorage | undefined): ThemeChoice {
  try {
    const saved = storage?.getItem(key);
    return saved === "light" || saved === "dark" ? saved : "auto";
  } catch { return "auto"; }
}

export function saveTheme(choice: ThemeChoice, storage: ThemeStorage | undefined) {
  try {
    if (choice === "auto") storage?.removeItem(key);
    else storage?.setItem(key, choice);
  } catch { return; }
}

export function applyTheme(choice: ThemeChoice, root: ThemeRoot) {
  if (choice === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}
