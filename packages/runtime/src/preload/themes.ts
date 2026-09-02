import type { ThemeRecord } from "../protocol.js";

export const STYLE_ATTRIBUTE = "data-bettergravity-theme";

/**
 * Themes are re-applied wholesale on every state change. Replacing the full set
 * keeps disabling and live editing correct without tracking per-theme diffs.
 */
export function applyThemes(themes: readonly ThemeRecord[]): number {
  for (const stale of document.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`)) stale.remove();

  const enabled = themes.filter((theme) => theme.enabled);
  for (const theme of enabled) {
    const style = document.createElement("style");
    style.setAttribute(STYLE_ATTRIBUTE, theme.id);
    style.textContent = theme.css;
    document.head.appendChild(style);
  }
  return enabled.length;
}
