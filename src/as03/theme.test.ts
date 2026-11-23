import assert from "node:assert/strict";
import { test } from "node:test";

import { applyTheme, readTheme, saveTheme, themeChoices } from "./theme.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

function element() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    removeAttribute: (name: string) => { attributes.delete(name); },
  };
}

test("three theme choices are offered, with Auto first", () => {
  assert.deepEqual(themeChoices.map(([value, label]) => `${value}:${label}`), ["auto:Auto", "light:Light", "dark:Dark"]);
});

test("the saved theme is read back, and anything else means Auto", () => {
  assert.equal(readTheme(memoryStorage()), "auto");
  assert.equal(readTheme(memoryStorage({ "stis-theme": "light" })), "light");
  assert.equal(readTheme(memoryStorage({ "stis-theme": "dark" })), "dark");
  assert.equal(readTheme(memoryStorage({ "stis-theme": "sepia" })), "auto");
  assert.equal(readTheme(undefined), "auto");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => {}, removeItem: () => {} };
  assert.equal(readTheme(broken), "auto");
});

test("saving stores only the theme key, and Auto removes it", () => {
  const storage = memoryStorage({ unrelated: "kept" });
  saveTheme("dark", storage);
  assert.deepEqual([...storage.data], [["unrelated", "kept"], ["stis-theme", "dark"]]);
  saveTheme("auto", storage);
  assert.deepEqual([...storage.data], [["unrelated", "kept"]]);
  const broken = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => saveTheme("light", broken));
  assert.doesNotThrow(() => saveTheme("light", undefined));
});

test("applying a theme sets or clears the root data-theme attribute", () => {
  const root = element();
  applyTheme("dark", root);
  assert.equal(root.attributes.get("data-theme"), "dark");
  applyTheme("light", root);
  assert.equal(root.attributes.get("data-theme"), "light");
  applyTheme("auto", root);
  assert.equal(root.attributes.has("data-theme"), false);
});
