/**
 * Function patching, the way BetterDiscord's patcher works.
 *
 * Antigravity's bundle is compiled with Closure Compiler, so there is no module
 * registry to search and identifiers are mangled. What is still reachable is any
 * object a plugin can get hold of — through the fiber tree, a global, or another
 * patch — and this makes those methods interceptable.
 */

export type Unpatch = () => void;

export interface PatchContext {
  /** The object the method was called on. */
  readonly self: unknown;
  /** Mutable: changing entries changes what the original receives. */
  readonly args: unknown[];
}

export interface AfterContext extends PatchContext {
  /** What the original returned. Replace by returning a value from the hook. */
  readonly result: unknown;
}

interface PatchedFunction {
  (...args: unknown[]): unknown;
  __betterGravityOriginal?: (...args: unknown[]) => unknown;
  __betterGravityHooks?: HookSet;
}

interface HookSet {
  before: ((context: PatchContext) => void)[];
  instead: ((context: PatchContext, original: (...args: unknown[]) => unknown) => unknown)[];
  after: ((context: AfterContext) => unknown)[];
}

type Target = Record<string, unknown>;

function ensurePatched(target: Target, method: string): HookSet {
  const current = target[method] as PatchedFunction | undefined;
  if (typeof current !== "function") throw new Error(`"${method}" is not a function on that object.`);
  if (current.__betterGravityHooks) return current.__betterGravityHooks;

  const original = current as (...args: unknown[]) => unknown;
  const hooks: HookSet = { before: [], instead: [], after: [] };

  const replacement = function patched(this: unknown, ...args: unknown[]): unknown {
    const context: PatchContext = { self: this, args };

    for (const hook of [...hooks.before]) {
      try {
        hook(context);
      } catch (error) {
        console.error("[BetterGravity] A before-hook threw.", error);
      }
    }

    // The last `instead` wins and is handed the original to call or ignore.
    let result: unknown;
    const override = hooks.instead.at(-1);
    if (override) {
      try {
        result = override(context, original.bind(this));
      } catch (error) {
        console.error("[BetterGravity] An instead-hook threw; falling back to the original.", error);
        result = original.apply(this, context.args);
      }
    } else {
      result = original.apply(this, context.args);
    }

    for (const hook of [...hooks.after]) {
      try {
        const replaced = hook({ self: this, args: context.args, result });
        if (replaced !== undefined) result = replaced;
      } catch (error) {
        console.error("[BetterGravity] An after-hook threw.", error);
      }
    }

    return result;
  } as PatchedFunction;

  replacement.__betterGravityOriginal = original;
  replacement.__betterGravityHooks = hooks;
  Object.defineProperty(replacement, "name", { value: original.name, configurable: true });

  target[method] = replacement;
  return hooks;
}

function restoreIfUnused(target: Target, method: string): void {
  const patched = target[method] as PatchedFunction | undefined;
  const hooks = patched?.__betterGravityHooks;
  if (!hooks || !patched?.__betterGravityOriginal) return;
  if (hooks.before.length + hooks.instead.length + hooks.after.length > 0) return;
  target[method] = patched.__betterGravityOriginal;
}

export interface Patcher {
  /** Runs before the original. Mutate `context.args` to change its input. */
  before(target: object, method: string, hook: (context: PatchContext) => void): Unpatch;
  /** Runs after the original. Return a value to replace its result. */
  after(target: object, method: string, hook: (context: AfterContext) => unknown): Unpatch;
  /** Replaces the original. Call the supplied function to run it anyway. */
  instead(
    target: object,
    method: string,
    hook: (context: PatchContext, original: (...args: unknown[]) => unknown) => unknown
  ): Unpatch;
}

/** Every patch is tracked so a plugin's are all removed when it stops. */
export function createPatcher(track: (dispose: () => void) => void): Patcher {
  const add = <Hook>(target: object, method: string, list: Hook[], hook: Hook): Unpatch => {
    const owner = target as Target;
    ensurePatched(owner, method);
    list.push(hook);

    let removed = false;
    const unpatch = () => {
      if (removed) return;
      removed = true;
      const index = list.indexOf(hook);
      if (index >= 0) list.splice(index, 1);
      restoreIfUnused(owner, method);
    };
    track(unpatch);
    return unpatch;
  };

  return {
    before: (target, method, hook) => add(target, method, ensurePatched(target as Target, method).before, hook),
    after: (target, method, hook) => add(target, method, ensurePatched(target as Target, method).after, hook),
    instead: (target, method, hook) => add(target, method, ensurePatched(target as Target, method).instead, hook)
  };
}
