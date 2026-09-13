import type { NativeBrowserTab } from "./tab.js";
import { finiteNumber } from "./url.js";
import { browserCleanup } from "./execution.js";

export const TAB_COMMANDS = [
  "navigate_tab_back", "navigate_tab_forward", "navigate_tab_reload", "tab_dev_logs", "tab_get_js_dialog", "tab_handle_js_dialog",
  "tab_screenshot", "tab_ax_get_state", "tab_ax_action", "playwright_evaluate", "cua_click", "cua_double_click", "cua_keypress", "cua_drag", "cua_move", "cua_scroll", "cua_type",
  "dom_cua_click", "dom_cua_double_click", "dom_cua_get_visible_dom", "dom_cua_keypress", "dom_cua_scroll", "dom_cua_type",
  "playwright_locator_click", "playwright_locator_dblclick", "playwright_locator_fill", "playwright_locator_press", "playwright_locator_press_sequentially",
  "playwright_locator_wait_for", "playwright_locator_count", "playwright_locator_select_option", "playwright_locator_set_checked", "playwright_locator_is_visible",
  "playwright_locator_is_enabled", "playwright_locator_all_text_contents", "playwright_locator_text_content", "playwright_locator_inner_text", "playwright_locator_get_attribute", "playwright_locator_read_all",
  "playwright_wait_for_url", "playwright_wait_for_load_state", "playwright_wait_for_timeout", "playwright_dom_snapshot", "playwright_element_info", "playwright_element_screenshot",
  "tab_clipboard_read_text", "tab_clipboard_write_text"
] as const;

export function validateSchema(schema: any, value: unknown, name = "arguments"): void {
  if (schema.anyOf) {
    if (!schema.anyOf.some((candidate: any) => { try { validateSchema(candidate, value, name); return true; } catch { return false; } })) throw new Error(`${name} does not match the command contract.`);
    return;
  }
  if (schema.allOf) for (const member of schema.allOf) validateSchema(member, value, name);
  if (schema.const !== undefined && value !== schema.const) throw new Error(`${name} must equal ${String(schema.const)}.`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${name} must be one of ${schema.enum.join(", ")}.`);
  switch (schema.type) {
    case "object":
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
      for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) throw new Error(`${name}.${required} is required.`);
      for (const [key, entry] of Object.entries(value)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Invalid argument key.");
        if (schema.properties?.[key]) validateSchema(schema.properties[key], entry, `${name}.${key}`);
        else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validateSchema(schema.additionalProperties, entry, `${name}.${key}`);
        else if (schema.additionalProperties === false) throw new Error(`Unknown argument ${name}.${key}.`);
      }
      break;
    case "array":
      if (!Array.isArray(value) || value.length > 10_000 || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 10_000)) throw new Error(`${name} must be an array of the expected length.`);
      value.forEach((entry, index) => validateSchema(Array.isArray(schema.items) ? schema.items[index] ?? {} : schema.items ?? {}, entry, `${name}[${index}]`));
      break;
    case "string":
      if (typeof value !== "string" || value.length < (schema.minLength ?? 0) || value.length > Math.min(schema.maxLength ?? 200_000, 200_000)) throw new Error(`${name} must be a string of the expected length.`);
      break;
    case "number": case "integer":
      if (typeof value !== "number" || !Number.isFinite(value) || schema.type === "integer" && !Number.isInteger(value) ||
          value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity) || value <= (schema.exclusiveMinimum ?? -Infinity) || value >= (schema.exclusiveMaximum ?? Infinity)) throw new Error(`${name} must be a valid ${schema.type}.`);
      break;
    case "boolean": if (typeof value !== "boolean") throw new Error(`${name} must be a boolean.`); break;
    case "null": if (value !== null) throw new Error(`${name} must be null.`); break;
  }
}

export async function until<T>(operation: () => Promise<T>, assertActive: () => void, timeout: unknown = 10_000): Promise<T> {
  const duration = finiteNumber(timeout, "timeout_ms", 0, 60_000);
  const deadline = Date.now() + duration;
  let problem: unknown;
  do {
    assertActive();
    try { const result = await operation(); assertActive(); return result; } catch (error) { problem = error; }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 80));
  } while (Date.now() <= deadline);
  throw problem instanceof Error ? problem : new Error("The browser operation timed out.");
}

function modifiers(keys: unknown): number {
  if (!Array.isArray(keys)) return 0;
  return keys.reduce((flags, key) => flags | (/^(ctrl|control|controlormeta)$/i.test(key) ? 2 : /^(cmd|meta|command)$/i.test(key) ? 4 : /^alt$/i.test(key) ? 1 : /^shift$/i.test(key) ? 8 : 0), 0);
}

function mouseButton(value: unknown): "left" | "right" | "middle" {
  return value === "right" || value === "r" || value === 2 ? "right" : value === "middle" || value === "m" || value === 1 ? "middle" : "left";
}

export async function executeTabCommand(command: string, args: Record<string, any>, tab: NativeBrowserTab, assertActive: () => void): Promise<any> {
  const timeout = args.timeout_ms ?? 10_000;
  const selector = String(args.selector ?? "");
  const query = (action: string, extra: Record<string, unknown> = {}) => tab.driver({ action, selector, ...extra });
  const point = () => until(() => query("bounds", { force: args.force === true }), assertActive, timeout);
  const pointAtSelector = async () => { const box = await point(); assertActive(); await tab.moveAgentCursor(box.x, box.y); assertActive(); return box; };
  const keypress = (value: string | string[]) => tab.keypress(Array.isArray(value) ? value : [value]);
  const clickSelector = async (count = 1) => { const box = await pointAtSelector(); assertActive(); await tab.click(box.x, box.y, mouseButton(args.button), count, modifiers(args.modifiers)); };
  switch (command) {
    case "navigate_tab_back": if (tab.contents.navigationHistory.canGoBack()) tab.contents.navigationHistory.goBack(); return {};
    case "navigate_tab_forward": if (tab.contents.navigationHistory.canGoForward()) tab.contents.navigationHistory.goForward(); return {};
    case "navigate_tab_reload": tab.contents.reload(); return {};
    case "tab_dev_logs": return { logs: tab.logs.filter(log => (!args.filter || log.message.includes(args.filter)) && (!args.levels || args.levels.includes(log.level))).slice(-Math.min(args.limit ?? 100, 200)) };
    case "tab_get_js_dialog": return { dialog: tab.dialog ? { id: tab.dialog.id, type: tab.dialog.type } : null };
    case "tab_handle_js_dialog":
      if (!tab.dialog || args.dialog_id !== tab.dialog.id) throw new Error("That JavaScript dialog is no longer open.");
      await tab.cdp("Page.handleJavaScriptDialog", { accept: args.action === "accept", promptText: args.prompt_text ?? "" }); return {};
    case "tab_screenshot": return { data: await tab.screenshot(args) };
    case "tab_ax_get_state": return {
      ...(args.content !== "screenshot" ? { state: String(await tab.driver({ action: "snapshot" })).replace(/\[ref=e(\d+)\]/g, "[$1]").slice(0, 120_000) } : {}),
      ...(args.content !== "axState" ? { data: await tab.screenshot() } : {})
    };
    case "playwright_dom_snapshot": return { dom_snapshot: String(await tab.driver({ action: "snapshot" })).slice(0, 120_000) };
    case "dom_cua_get_visible_dom": return String(await tab.driver({ action: "snapshot" })).slice(0, 120_000);
    case "playwright_locator_count": return { count: await query("count") };
    case "playwright_locator_is_visible": return { value: await query("visible") };
    case "playwright_locator_is_enabled": return { value: await query("enabled") };
    case "playwright_locator_all_text_contents": return { values: await query("text", { all: true }) };
    case "playwright_locator_text_content": return { value: await query("text") };
    case "playwright_locator_inner_text": return { value: await query("innerText") };
    case "playwright_locator_get_attribute": return { value: await query("attribute", { name: args.name }) };
    case "playwright_locator_read_all": return { values: await query("readAll", { relative_selector: args.relative_selector }) };
    case "playwright_locator_click": await clickSelector(); return {};
    case "playwright_locator_dblclick": await clickSelector(2); return {};
    case "playwright_locator_fill": {
      await pointAtSelector();
      if (args.replace === false) {
        await query("focus"); await keypress("End"); await tab.cdp("Input.insertText", { text: args.value });
      } else {
        const result = await query("fill", { value: args.value });
        assertActive();
        if (result === "needsinput") await tab.cdp("Input.insertText", { text: args.value });
        else if (result !== "done") throw new Error(String(result));
      }
      return {};
    }
    case "playwright_locator_press": await pointAtSelector(); await query("focus"); await keypress(args.value); return {};
    case "playwright_locator_press_sequentially":
      await pointAtSelector(); await query("focus"); for (const character of args.value) { assertActive(); await keypress(character); } return {};
    case "playwright_locator_select_option": await pointAtSelector(); await query("select", { selections: args.selections }); return {};
    case "playwright_locator_set_checked": {
      const checked = await query("checked");
      if (checked !== args.checked) await clickSelector();
      if (await query("checked") !== args.checked) throw new Error("The checkbox did not reach the requested state.");
      return {};
    }
    case "playwright_locator_wait_for":
      await until(async () => {
        const count = await query("count");
        const visible = count ? await query("visible") : false;
        if (!(args.state === "attached" ? count > 0 : args.state === "detached" ? !count : args.state === "hidden" ? !visible : visible)) throw new Error(`Waiting for element to be ${args.state}.`);
        return true;
      }, assertActive, timeout); return {};
    case "playwright_wait_for_url": {
      const pattern = String(args.url).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
      const match = new RegExp(`^${pattern}$`);
      await until(async () => { if (!match.test(tab.contents.getURL())) throw new Error(`Waiting for URL ${args.url}.`); return true; }, assertActive, timeout);
      return { url: tab.contents.getURL() };
    }
    case "playwright_wait_for_load_state":
      await until(async () => {
        const state = await tab.evaluate("document.readyState");
        if (args.state === "domcontentloaded" ? state === "loading" : state !== "complete" || tab.contents.isLoading()) throw new Error("The page is still loading.");
        return true;
      }, assertActive, timeout); return {};
    case "playwright_wait_for_timeout": {
      const end = Date.now() + finiteNumber(args.timeout_ms, "timeout_ms", 0, 60_000);
      while (Date.now() < end) { assertActive(); await new Promise(resolve => setTimeout(resolve, Math.min(80, end - Date.now()))); }
      return {};
    }
    case "playwright_element_info": return tab.driver({ action: "info", x: args.x, y: args.y });
    case "playwright_element_screenshot": {
      const [element] = await tab.driver({ action: "info", x: args.x, y: args.y });
      if (!element) throw new Error("No element is visible at that position.");
      const box = element.boundingBox;
      return { data: await tab.screenshot({ cropX: box.x, cropY: box.y, cropWidth: box.width, cropHeight: box.height }) };
    }
    case "playwright_evaluate": {
      const script = String(args.script);
      if (script.length > 100_000) throw new Error("The page script is too large.");
      if (!args.selector) return { value: await tab.evaluate(`(async () => {\n${script}\n})()`, undefined, undefined, finiteNumber(args.timeout_ms ?? 15_000, "timeout_ms", 1, 60_000)) };
      // Selector-bound evaluation stays in the DOM world and uses the same engine.
      return { value: await tab.driver({ action: "evaluate", selector, script, all: args.selector_mode === "all" }) };
    }
    case "cua_click": await tab.click(args.x, args.y, mouseButton(args.button), 1, modifiers(args.keys)); return {};
    case "cua_double_click": await tab.click(args.x, args.y, "left", 2, modifiers(args.keys)); return {};
    case "cua_move": await tab.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: args.x, y: args.y, modifiers: modifiers(args.keys) }); return {};
    case "cua_scroll": await tab.cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: args.x, y: args.y, deltaX: args.scroll_x, deltaY: args.scroll_y, modifiers: modifiers(args.keys) }); return {};
    case "cua_keypress": case "dom_cua_keypress": await keypress(args.keys); return {};
    case "cua_type": case "dom_cua_type": await tab.cdp("Input.insertText", { text: args.text }); return {};
    case "cua_drag": {
      const points = args.path as { x: number; y: number }[];
      if (points.length < 2) throw new Error("A drag needs at least two points.");
      const first = points[0]!;
      await tab.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...first });
      await tab.cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...first, button: "left", buttons: 1, clickCount: 1 });
      let position = first;
      try { for (const p of points.slice(1)) { assertActive(); await tab.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...p, button: "left", buttons: 1 }); position = p; } }
      finally { if (!tab.destroyed) await browserCleanup(() => tab.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...position, button: "left", buttons: 0, clickCount: 1 })); }
      return {};
    }
    case "dom_cua_click": case "dom_cua_double_click":
      return executeTabCommand(command === "dom_cua_click" ? "playwright_locator_click" : "playwright_locator_dblclick", { selector: `aria-ref=${args.node_id}` }, tab, assertActive);
    case "dom_cua_scroll": {
      const p = args.node_id ? await tab.driver({ action: "bounds", selector: `aria-ref=${args.node_id}` }) : { x: 20, y: 20 };
      return executeTabCommand("cua_scroll", { x: p.x, y: p.y, scroll_x: args.scroll_x, scroll_y: args.scroll_y }, tab, assertActive);
    }
    case "tab_clipboard_read_text": return { text: await tab.evaluate("navigator.clipboard.readText()") };
    case "tab_clipboard_write_text": await tab.evaluate(`navigator.clipboard.writeText(${JSON.stringify(args.text)})`); return {};
    case "tab_ax_action": {
      const action = args.action;
      const target = Array.isArray(action.target) ? { x: action.target[0], y: action.target[1] } : null;
      const ref = `aria-ref=e${action.element_index ?? action.target}`;
      switch (action.kind) {
        case "click": return executeTabCommand(target ? "cua_click" : action.click_count === 2 ? "playwright_locator_dblclick" : "playwright_locator_click", { ...target, selector: ref, button: action.mouse_button }, tab, assertActive);
        case "drag": return executeTabCommand("cua_drag", { path: [{ x: action.from[0], y: action.from[1] }, { x: action.to[0], y: action.to[1] }] }, tab, assertActive);
        case "press_key": await keypress(action.key); return {};
        case "type_text": await tab.cdp("Input.insertText", { text: action.text }); return {};
        case "set_value": return executeTabCommand("playwright_locator_fill", { selector: ref, value: action.value, replace: true }, tab, assertActive);
        case "select_text": await tab.driver({ action: "selection", selector: ref, ...action }); return {};
        case "scroll": {
          const p = target ?? await tab.driver({ action: "bounds", selector: ref });
          const amount = (action.pages ?? 1) * 600;
          const direction = action.direction[0];
          return executeTabCommand("cua_scroll", { x: p.x, y: p.y, scroll_x: direction === "l" ? -amount : direction === "r" ? amount : 0, scroll_y: direction === "u" ? -amount : direction === "d" ? amount : 0 }, tab, assertActive);
        }
        case "perform_secondary_action": if (action.action === "contextmenu") return executeTabCommand("playwright_locator_click", { selector: ref, button: "right" }, tab, assertActive);
      }
      throw new Error("That accessibility action is not available on this element.");
    }
    default: throw new Error(`Unsupported browser command: ${command}`);
  }
}
