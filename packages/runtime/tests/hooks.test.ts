// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPatcher } from "../src/world/hooks/patcher.js";
import { byTestId, createReactTools } from "../src/world/hooks/react.js";
import { createNetworkTools, installNetworkHooks, resetNetworkHandlers } from "../src/world/hooks/net.js";

let disposers: (() => void)[] = [];
const track = (dispose: () => void) => void disposers.push(dispose);
const disposeAll = () => {
  while (disposers.length > 0) disposers.pop()?.();
};

beforeEach(() => {
  disposers = [];
});

afterEach(() => {
  disposeAll();
  resetNetworkHandlers();
});

describe("patcher", () => {
  const subject = () => ({ greet: (name: string) => `hello ${name}` });

  it("runs a hook before the original and can change its arguments", () => {
    const target = subject();
    createPatcher(track).before(target, "greet", (context) => {
      context.args[0] = "world";
    });

    expect(target.greet("nobody")).toBe("hello world");
  });

  it("runs a hook after the original and can replace the result", () => {
    const target = subject();
    createPatcher(track).after(target, "greet", (context) => `${String(context.result)}!`);

    expect(target.greet("you")).toBe("hello you!");
  });

  it("lets a hook see the original result without changing it", () => {
    const target = subject();
    const seen: unknown[] = [];
    createPatcher(track).after(target, "greet", (context) => void seen.push(context.result));

    expect(target.greet("you")).toBe("hello you");
    expect(seen).toEqual(["hello you"]);
  });

  it("replaces the original entirely, but can still call it", () => {
    const target = subject();
    createPatcher(track).instead(target, "greet", (context, original) => `[${String(original(...context.args))}]`);

    expect(target.greet("you")).toBe("[hello you]");
  });

  it("can skip the original completely", () => {
    const target = subject();
    createPatcher(track).instead(target, "greet", () => "nothing happened");

    expect(target.greet("you")).toBe("nothing happened");
  });

  it("preserves the receiver", () => {
    const target = { name: "counter", describe(this: { name: string }) { return this.name; } };
    createPatcher(track).after(target, "describe", (context) => `${String(context.result)}!`);

    expect(target.describe()).toBe("counter!");
  });

  it("applies hooks from several plugins to the same method", () => {
    const target = subject();
    const patcher = createPatcher(track);
    patcher.after(target, "greet", (context) => `${String(context.result)} one`);
    patcher.after(target, "greet", (context) => `${String(context.result)} two`);

    expect(target.greet("x")).toBe("hello x one two");
  });

  it("restores the original once the last hook is removed", () => {
    const target = subject();
    const original = target.greet;
    const unpatch = createPatcher(track).before(target, "greet", () => undefined);

    expect(target.greet).not.toBe(original);
    unpatch();
    expect(target.greet).toBe(original);
  });

  it("leaves the method patched while another hook remains", () => {
    const target = subject();
    const original = target.greet;
    const patcher = createPatcher(track);
    const first = patcher.before(target, "greet", () => undefined);
    patcher.before(target, "greet", () => undefined);

    first();
    expect(target.greet).not.toBe(original);
  });

  it("contains a throwing hook so the original still runs", () => {
    const silenced = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const target = subject();
    createPatcher(track).before(target, "greet", () => {
      throw new Error("nope");
    });

    expect(target.greet("you")).toBe("hello you");
    silenced.mockRestore();
  });

  it("refuses to patch something that is not a function", () => {
    expect(() => createPatcher(track).before({ value: 1 }, "value", () => undefined)).toThrow(/not a function/);
  });

  it("removes every patch when the plugin is disposed", () => {
    const target = subject();
    const original = target.greet;
    createPatcher(track).after(target, "greet", () => "changed");

    disposeAll();
    expect(target.greet).toBe(original);
  });
});

describe("react tools", () => {
  const tools = createReactTools();

  /** Mimics how React attaches its internals: plain assignment, random suffix. */
  function attachFiber(node: Element, props: Record<string, unknown>, parent?: object) {
    const fiber = { type: "div", key: null, stateNode: node, return: parent ?? null, child: null, sibling: null, memoizedProps: props, memoizedState: null };
    (node as unknown as Record<string, unknown>)["__reactFiber$abc123"] = fiber;
    (node as unknown as Record<string, unknown>)["__reactProps$abc123"] = props;
    return fiber;
  }

  it("finds the fiber and props React attached to a node", () => {
    const node = document.createElement("div");
    attachFiber(node, { "data-testid": "send-button" });

    expect(tools.getFiber(node)).toBeDefined();
    expect(tools.getProps(node)).toEqual({ "data-testid": "send-button" });
  });

  it("returns nothing for a node React never touched", () => {
    expect(tools.getFiber(document.createElement("div"))).toBeUndefined();
    expect(tools.getProps(document.createElement("div"))).toBeUndefined();
  });

  it("walks up to an ancestor by its props", () => {
    const grandparent = { type: "div", key: null, stateNode: null, return: null, child: null, sibling: null, memoizedProps: { "data-testid": "composer" }, memoizedState: null };
    const node = document.createElement("input");
    attachFiber(node, { placeholder: "Ask anything" }, grandparent);

    expect(tools.findOwner(node, byTestId("composer"))).toBe(grandparent);
  });

  it("gives up after the depth limit rather than walking forever", () => {
    const node = document.createElement("div");
    attachFiber(node, {}, { type: "div", key: null, stateNode: null, return: null, child: null, sibling: null, memoizedProps: { "data-testid": "far" }, memoizedState: null });

    expect(tools.findOwner(node, byTestId("far"), 0)).toBeUndefined();
  });

  it("matches on a subset of props", () => {
    const fiber = { memoizedProps: { a: 1, b: 2 } } as never;
    expect(tools.hasProps(fiber, { a: 1 })).toBe(true);
    expect(tools.hasProps(fiber, { a: 2 })).toBe(false);
  });

  it("finds the nearest descendant, breadth first", () => {
    const deep = { type: "span", key: null, stateNode: null, return: null, child: null, sibling: null, memoizedProps: { "data-testid": "target" }, memoizedState: null };
    const near = { type: "span", key: null, stateNode: null, return: null, child: null, sibling: null, memoizedProps: { "data-testid": "target" }, memoizedState: null };
    const middle = { type: "div", key: null, stateNode: null, return: null, child: deep, sibling: near, memoizedProps: {}, memoizedState: null };
    const root = { type: "div", key: null, stateNode: null, return: null, child: middle, sibling: null, memoizedProps: {}, memoizedState: null };

    expect(tools.findChild(root as never, byTestId("target"))).toBe(near);
  });

  it("calls forceUpdate on a class component instance", () => {
    const forceUpdate = vi.fn();
    const fiber = { stateNode: { forceUpdate } } as never;

    expect(tools.forceUpdate(fiber)).toBe(true);
    expect(forceUpdate).toHaveBeenCalled();
  });

  it("reports when there is nothing to force-update", () => {
    expect(tools.forceUpdate({ stateNode: document.createElement("div") } as never)).toBe(false);
  });
});

describe("network hooks", () => {
  // Typed with its argument so assertions can inspect what the wrapper passed.
  const native = vi.fn(async (_input?: RequestInfo | URL) => new Response("original"));

  // The hooks install once per page, as they do in the application, wrapping
  // whatever fetch exists at that moment. Replacing window.fetch afterwards
  // would throw the wrapper away, so the mock goes in first and stays.
  beforeAll(() => {
    window.fetch = native as unknown as typeof fetch;
    installNetworkHooks();
  });

  beforeEach(() => {
    native.mockClear();
    resetNetworkHandlers();
  });

  it("passes traffic through untouched when nothing is registered", async () => {
    const response = await window.fetch("https://127.0.0.1:1234/rpc");
    expect(await response.text()).toBe("original");
  });

  it("lets a plugin see every request", async () => {
    const seen: string[] = [];
    createNetworkTools(track).onFetch(async (request, next) => {
      seen.push(request.url);
      return next(request);
    });

    await window.fetch("https://127.0.0.1:1234/rpc");
    expect(seen).toEqual(["https://127.0.0.1:1234/rpc"]);
  });

  it("lets a plugin rewrite the request before it goes out", async () => {
    createNetworkTools(track).onFetch(async (request, next) =>
      next(new Request("https://127.0.0.1:1234/elsewhere", { method: request.method }))
    );

    await window.fetch("https://127.0.0.1:1234/rpc");
    expect((native.mock.calls[0]?.[0] as Request).url).toBe("https://127.0.0.1:1234/elsewhere");
  });

  it("lets a plugin answer without touching the network", async () => {
    createNetworkTools(track).onFetch(async () => new Response("intercepted"));

    const response = await window.fetch("https://127.0.0.1:1234/rpc");
    expect(await response.text()).toBe("intercepted");
    expect(native).not.toHaveBeenCalled();
  });

  it("lets a plugin rewrite the response", async () => {
    createNetworkTools(track).onFetch(async (request, next) => {
      const response = await next(request);
      return new Response(`${await response.text()} + extra`);
    });

    expect(await (await window.fetch("https://x/")).text()).toBe("original + extra");
  });

  it("chains middleware from several plugins", async () => {
    const order: string[] = [];
    const tools = createNetworkTools(track);
    tools.onFetch(async (request, next) => {
      order.push("first");
      return next(request);
    });
    tools.onFetch(async (request, next) => {
      order.push("second");
      return next(request);
    });

    await window.fetch("https://x/");
    expect(order).toEqual(["first", "second"]);
  });

  it("continues the request when middleware throws", async () => {
    const silenced = vi.spyOn(console, "error").mockImplementation(() => undefined);
    createNetworkTools(track).onFetch(() => {
      throw new Error("nope");
    });

    expect(await (await window.fetch("https://x/")).text()).toBe("original");
    silenced.mockRestore();
  });

  it("stops intercepting once the plugin is disposed", async () => {
    createNetworkTools(track).onFetch(async () => new Response("intercepted"));
    disposeAll();

    expect(await (await window.fetch("https://x/")).text()).toBe("original");
  });

  it("reports XMLHttpRequest opens", () => {
    const seen: string[] = [];
    createNetworkTools(track).onRequest((method, url) => void seen.push(`${method} ${url}`));

    const request = new XMLHttpRequest();
    request.open("POST", "https://127.0.0.1:1234/rpc");

    expect(seen).toEqual(["POST https://127.0.0.1:1234/rpc"]);
  });
});
