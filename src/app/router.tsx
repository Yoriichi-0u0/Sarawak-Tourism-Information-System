import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

type Location = { path: string; search: URLSearchParams; hash: string };
const read = (): Location => ({ path: window.location.pathname, search: new URLSearchParams(window.location.search), hash: window.location.hash });
const listeners = new Set<() => void>();

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (to === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history[options.replace ? "replaceState" : "pushState"](null, "", to);
  listeners.forEach((listener) => listener());
  if (!to.includes("#")) window.scrollTo(0, 0);
}

export function useLocation(): Location {
  const [location, setLocation] = useState(read);
  useEffect(() => {
    const update = () => setLocation(read());
    listeners.add(update);
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    update();
    return () => { listeners.delete(update); window.removeEventListener("popstate", update); window.removeEventListener("hashchange", update); };
  }, []);
  return location;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return <a href={to} {...rest} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || rest.target) return;
    event.preventDefault();
    navigate(to);
  }} />;
}

export function match(pattern: string, path: string): Record<string, string> | undefined {
  const keys: string[] = [];
  const source = pattern.replace(/:(\w+)/g, (_, key: string) => { keys.push(key); return "([^/]+)"; });
  const found = new RegExp(`^${source}/?$`).exec(path);
  if (!found) return undefined;
  return Object.fromEntries(keys.map((key, index) => [key, decodeURIComponent(found[index + 1])]));
}
