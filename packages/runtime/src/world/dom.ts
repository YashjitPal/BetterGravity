import type { PluginDom, WaitForOptions } from "@bettergravity/plugin-api";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Antigravity's interface is a single-page app that rebuilds its DOM as the
 * user moves around, so a plugin that queries once at startup finds nothing.
 * These helpers are the supported way to attach to elements as they appear.
 */
export function createDomUtilities(track: (dispose: () => void) => void): PluginDom {
  return {
    waitFor<Element_ extends Element = Element>(selector: string, options: WaitForOptions = {}): Promise<Element_> {
      const within = options.within ?? document;
      const existing = within.querySelector<Element_>(selector);
      if (existing) return Promise.resolve(existing);

      return new Promise<Element_>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          stop();
          reject(new Error(`Timed out after ${options.timeout ?? DEFAULT_TIMEOUT_MS}ms waiting for "${selector}".`));
        }, options.timeout ?? DEFAULT_TIMEOUT_MS);

        const observer = new MutationObserver(() => {
          const found = within.querySelector<Element_>(selector);
          if (!found) return;
          stop();
          resolve(found);
        });

        const stop = () => {
          window.clearTimeout(timeout);
          observer.disconnect();
        };

        observer.observe(document.documentElement, { childList: true, subtree: true });
        track(stop);
      });
    },

    observe<Element_ extends Element = Element>(selector: string, onMatch: (element: Element_) => void): () => void {
      // Elements are delivered once each; the SPA re-renders often enough that
      // a plugin would otherwise be called repeatedly for the same node.
      const seen = new WeakSet<Element>();

      const scan = () => {
        for (const element of document.querySelectorAll<Element_>(selector)) {
          if (seen.has(element)) continue;
          seen.add(element);
          try {
            onMatch(element);
          } catch (error) {
            console.error(`[BetterGravity] An observer for "${selector}" threw.`, error);
          }
        }
      };

      const observer = new MutationObserver(scan);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      scan();

      const stop = () => observer.disconnect();
      track(stop);
      return stop;
    }
  };
}
