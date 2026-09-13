import { AsyncLocalStorage } from "node:async_hooks";

const execution = new AsyncLocalStorage<AbortSignal>();

export function isBrowserOperation(): boolean { return execution.getStore() !== undefined; }

export function browserOperation<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  return execution.run(signal, operation);
}

export function browserCleanup<T>(operation: () => Promise<T>): Promise<T> { return execution.exit(operation); }

/** Bound native calls as well as polling, including scripts awaiting forever. */
export function browserDeadline<T>(operation: () => Promise<T>, label: string, timeout = 15_000, cancel?: () => void): Promise<T> {
  const signal = execution.getStore();
  if (signal?.aborted) return Promise.reject(new Error("The browser action was cancelled."));
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown, value?: T) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value as T);
    };
    const abort = () => { cancel?.(); finish(new Error("The browser action was cancelled.")); };
    const timer = setTimeout(() => { cancel?.(); finish(new Error(`${label} timed out after ${timeout} ms.`)); }, timeout);
    signal?.addEventListener("abort", abort, { once: true });
    try { operation().then(value => finish(undefined, value), error => finish(error)); }
    catch (error) { finish(error); }
  });
}
