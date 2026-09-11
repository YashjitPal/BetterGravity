import { pathToFileURL } from "node:url";

export function browserUrl(input: string, search = false): string {
  const value = input.trim();
  if (!value || value === "about:blank") return "about:blank";
  if (/^[a-z]:[\\/]/i.test(value)) return browserUrl(pathToFileURL(value).href);
  if (/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?=[:/]|$)/i.test(value)) return browserUrl(`http://${value}`);
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) {
    if (!/\s/.test(value) && (/^[^/]+\.[^/]+/.test(value) || /^[^/]+:\d+/.test(value))) return browserUrl(`https://${value}`);
    if (search) return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
    throw new Error("Enter an http, https, localhost, or file URL.");
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("The browser URL is invalid."); }
  if (!["https:", "http:", "file:"].includes(url.protocol)) throw new Error("This URL scheme cannot be opened in the browser.");
  if (url.username || url.password) throw new Error("Sign in on the website instead of putting credentials in its URL.");
  if (url.protocol === "file:" && /(?:^|[\\/])\.env(?:[./\\]|$)/i.test(decodeURIComponent(url.pathname))) throw new Error("Environment files cannot be opened in the browser.");
  return url.href;
}

export function browserOrigin(url: string): string {
  if (url === "about:blank") return "about:blank";
  const parsed = new URL(url);
  return parsed.protocol === "file:" ? "file://" : parsed.origin;
}

export function finiteNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
}
