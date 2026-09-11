import { randomUUID } from "node:crypto";
import { WebContentsView, type Session, type WebContents } from "electron";
import type { BrowserTabState } from "../../protocol.js";
import { annotationScript, browserDomDriver } from "./dom-driver.js";
import { browserUrl, finiteNumber } from "./url.js";

const WORLD = "bettergravity-browser-tools";
const MAX_EVENTS = 500;
const MAX_LOGS = 200;

export interface NativeTabOptions {
  session: Session;
  injected: string;
  changed(): void;
  popup(url: string): NativeBrowserTab;
  shortcut(action: string): void;
  selection(value: Record<string, unknown>): void;
  userInput(): void;
}

/** Each tab is a separate sandboxed renderer, never in the host's session. */
export class NativeBrowserTab {
  readonly id = randomUUID();
  readonly view: WebContentsView;
  readonly contents: WebContents;
  readonly logs: { level: string; message: string; timestamp: string; url?: string }[] = [];
  readonly events: { method: string; params: unknown; timestamp: number; sessionId?: string }[] = [];
  readonly children = new Map<string, string>();
  dialog: { id: string; type: string; message: string; defaultPrompt: string } | null = null;
  error: string | null = null;
  favicon: string | null = null;
  mark: string | null = null;
  private ready: Promise<void>;
  private readonly binding = `bg_annotation_${this.id.replace(/-/g, "")}`;
  private disposed = false;

  constructor(private readonly options: NativeTabOptions) {
    this.view = new WebContentsView({ webPreferences: {
      session: options.session, sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false,
      backgroundThrottling: true, spellcheck: true
    } });
    this.view.setBackgroundColor("#181818");
    this.contents = this.view.webContents;
    const contents = this.contents;
    const changed = () => options.changed();
    contents.on("page-title-updated", changed);
    contents.on("did-start-loading", changed);
    contents.on("did-stop-loading", changed);
    contents.on("did-navigate", () => { this.error = null; changed(); });
    contents.on("did-navigate-in-page", changed);
    contents.on("page-favicon-updated", (_event, icons) => { this.favicon = icons.find(url => /^https?:/i.test(url)) ?? null; changed(); });
    contents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) { this.error = description; changed(); }
    });
    contents.on("render-process-gone", (_event, details) => { this.error = `Page stopped (${details.reason}). Reload to try again.`; changed(); });
    contents.on("console-message", (...args: any[]) => {
      const detail = typeof args[1] === "object" ? args[1] : { level: ["debug", "info", "warn", "error"][args[1]] ?? "log", message: args[2], sourceId: args[4] };
      this.logs.push({ level: String(detail.level), message: String(detail.message).slice(0, 8000), timestamp: new Date().toISOString(), url: String(detail.sourceId ?? "") });
      if (this.logs.length > MAX_LOGS) this.logs.shift();
    });
    contents.on("will-navigate", (event: Electron.Event, url: string) => {
      try { browserUrl(url); } catch { event.preventDefault(); this.error = "This link uses an unsupported URL scheme."; changed(); }
    });
    contents.on("will-redirect", (event: Electron.Event, url: string) => {
      try { browserUrl(url); } catch { event.preventDefault(); this.error = "This link uses an unsupported URL scheme."; changed(); }
    });
    contents.setWindowOpenHandler(({ url }) => {
      try { browserUrl(url); } catch { return { action: "deny" }; }
      return { action: "allow", createWindow: () => options.popup(url).contents };
    });
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const modifier = input.control || input.meta;
      const key = input.key.toLowerCase();
      const action = modifier && input.shift && key === "b" ? "toggle" : modifier && !input.shift && key === "l" ? "address" :
        modifier && !input.shift && key === "t" ? "new-tab" : modifier && key === "w" ? "close-tab" :
        modifier && key === "f" ? "find" : key === "f12" ? "devtools" : null;
      if (action) { event.preventDefault(); options.shortcut(action); }
      // User Escape is a reliable stop signal even during model input.
      if (key === "escape" && !modifier) options.userInput();
    });
    contents.debugger.on("message", (_event, method, params, sessionId) => {
      this.events.push({ method, params, timestamp: Date.now(), ...(sessionId ? { sessionId } : {}) });
      if (this.events.length > MAX_EVENTS) this.events.shift();
      if (method === "Target.attachedToTarget") this.children.set(params.targetInfo.targetId, params.sessionId);
      if (method === "Target.detachedFromTarget") for (const [id, child] of this.children) if (child === params.sessionId) this.children.delete(id);
      if (method === "Page.javascriptDialogOpening") {
        this.dialog = { id: randomUUID(), type: params.type, message: params.message, defaultPrompt: params.defaultPrompt ?? "" }; changed();
      }
      if (method === "Page.javascriptDialogClosed") { this.dialog = null; changed(); }
      if (method === "Runtime.bindingCalled" && params.name === this.binding && typeof params.payload === "string" && params.payload.length < 32_000) {
        try { const selected = JSON.parse(params.payload); if (selected && typeof selected === "object") options.selection(selected); } catch { /* Ignore malformed page messages. */ }
      }
    });
    this.ready = this.initialize();
    void this.ready.catch(error => { this.error = error instanceof Error ? error.message : String(error); changed(); });
  }

  get destroyed(): boolean { return this.disposed || this.contents.isDestroyed(); }

  state(): BrowserTabState {
    if (this.destroyed) return { id: this.id, title: "Closed tab", url: "about:blank", loading: false, canGoBack: false, canGoForward: false, zoom: 1, error: this.error, favicon: null };
    return { id: this.id, title: this.contents.getTitle() || "New tab", url: this.contents.getURL() || "about:blank",
      loading: this.contents.isLoading(), canGoBack: this.contents.navigationHistory.canGoBack(), canGoForward: this.contents.navigationHistory.canGoForward(),
      zoom: this.contents.getZoomFactor(), error: this.error, favicon: this.favicon };
  }

  private async initialize(): Promise<void> {
    this.contents.debugger.attach("1.3");
    await this.contents.debugger.sendCommand("Page.enable");
    await this.contents.debugger.sendCommand("Runtime.enable");
    await this.contents.debugger.sendCommand("Network.enable", { maxTotalBufferSize: 8 * 1024 * 1024, maxResourceBufferSize: 1024 * 1024 });
    await this.contents.debugger.sendCommand("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await this.contents.debugger.sendCommand("Runtime.addBinding", { name: this.binding });
  }

  async cdp(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    if (this.destroyed) throw new Error("The browser tab is closed.");
    await this.ready;
    return this.contents.debugger.sendCommand(method, params, sessionId);
  }

  async navigate(url: string): Promise<void> {
    const target = browserUrl(url);
    this.error = null;
    try { await this.contents.loadURL(target); }
    catch (error) { if (!this.destroyed && !String(error).includes("ERR_ABORTED")) throw error; }
  }

  private async context(frameId?: string, sessionId?: string): Promise<number> {
    const root = frameId ?? (await this.cdp("Page.getFrameTree", {}, sessionId)).frameTree.frame.id;
    const result = await this.cdp("Page.createIsolatedWorld", { frameId: root, worldName: WORLD }, sessionId);
    return result.executionContextId;
  }

  async evaluate(expression: string, contextId?: number, sessionId?: string): Promise<any> {
    const result = await this.cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true,
      ...(contextId === undefined ? {} : { contextId }) }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Page evaluation failed.");
    return result.result?.value;
  }

  private async inject(contextId: number, sessionId?: string): Promise<void> {
    await this.evaluate(`(() => { if (!globalThis.__bgBrowserInjected) { ${this.options.injected}\n globalThis.__bgBrowserInjected = new PlaywrightInjected.InjectedScript(window, { isUnderTest:false,sdkLanguage:'javascript',testIdAttributeName:'data-testid',stableRafCount:1,browserName:'chromium',customEngines:[] }); } })()`, contextId, sessionId);
  }

  async driver(input: Record<string, unknown>): Promise<any> {
    // Playwright's frame-selector syntax is carried intact by the extracted client.
    const parts = typeof input.selector === "string" ? input.selector.split(/\s*>>\s*internal:control=enter-frame\s*>>\s*/) : [];
    let contextId = await this.context();
    let sessionId: string | undefined;
    let offsetX = 0, offsetY = 0;
    while (parts.length > 1) {
      await this.inject(contextId, sessionId);
      const selector = parts.shift()!;
      const frame = await this.cdp("Runtime.evaluate", { contextId, expression: `globalThis.__bgBrowserInjected.querySelector(globalThis.__bgBrowserInjected.parseSelector(${JSON.stringify(selector)}), document, true)`, returnByValue: false }, sessionId);
      if (!frame.result?.objectId) throw new Error("The selected frame is unavailable.");
      const description = await this.cdp("DOM.describeNode", { objectId: frame.result.objectId }, sessionId);
      const position = await this.evaluate(`(${browserDomDriver.toString()})(${JSON.stringify({ action: "bounds", selector })})`, contextId, sessionId);
      offsetX += position.boundingBox.x; offsetY += position.boundingBox.y;
      const frameId = description.node.frameId ?? description.node.contentDocument?.frameId;
      if (!frameId) throw new Error("The selected element is not a frame.");
      sessionId = this.children.get(frameId) ?? sessionId;
      contextId = await this.context(frameId, sessionId);
    }
    await this.inject(contextId, sessionId);
    const result = await this.evaluate(`(${browserDomDriver.toString()})(${JSON.stringify({ ...input, ...(parts.length ? { selector: parts[0] } : {}) })})`, contextId, sessionId);
    if (input.action === "bounds" && result) { result.x += offsetX; result.y += offsetY; }
    return result;
  }

  async click(x: unknown, y: unknown, button: "left" | "right" | "middle" = "left", count = 1, modifiers = 0): Promise<void> {
    const point = { x: finiteNumber(x, "x", 0, 20_000), y: finiteNumber(y, "y", 0, 20_000), button, modifiers, clickCount: count };
    await this.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    for (let click = 1; click <= count; click++) {
      await this.cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, clickCount: click });
      await this.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, clickCount: click });
    }
  }

  async keypress(keys: string[]): Promise<void> {
    const aliases: Record<string, string> = { CTRL: "Control", CONTROL: "Control", META: "Meta", CMD: "Meta", COMMAND: "Meta", SHIFT: "Shift", ALT: "Alt", ENTER: "Enter", RETURN: "Enter", ESC: "Escape", ESCAPE: "Escape", SPACE: " ", BACKSPACE: "Backspace", DELETE: "Delete", TAB: "Tab", ARROWUP: "ArrowUp", ARROWDOWN: "ArrowDown", ARROWLEFT: "ArrowLeft", ARROWRIGHT: "ArrowRight" };
    const normalized = keys.flatMap(key => key.split("+")).map(key => aliases[key.toUpperCase()] ?? key);
    let modifiers = 0;
    for (const key of normalized) modifiers |= key === "Alt" ? 1 : key === "Control" || key === "ControlOrMeta" ? (process.platform === "darwin" && key === "ControlOrMeta" ? 4 : 2) : key === "Meta" ? 4 : key === "Shift" ? 8 : 0;
    const key = normalized.filter(value => !["Control", "ControlOrMeta", "Meta", "Alt", "Shift"].includes(value)).at(-1);
    if (!key) throw new Error("Include a key to press, for example Control+L or Enter.");
    const codes: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34, " ": 32 };
    const keyCode = codes[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const text = !(modifiers & 7) && key.length === 1 ? key : key === "Enter" ? "\r" : undefined;
    await this.cdp("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, windowsVirtualKeyCode: keyCode, modifiers, ...(text ? { text } : {}) });
    await this.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: keyCode, modifiers });
  }

  async screenshot(args: Record<string, unknown> = {}): Promise<string> {
    if (args.fullPage !== true && args.cropWidth === undefined && args.cropHeight === undefined) {
      // Electron's capture path wakes hidden native views without showing a
      // window. A raw CDP capture can wait forever for a hidden compositor.
      const capture = await this.contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      return capture.toPNG().toString("base64");
    }
    try {
      let clip: Record<string, number> | undefined;
      if (args.fullPage === true) {
        const metrics = await this.cdp("Page.getLayoutMetrics");
        const size = metrics.cssContentSize ?? metrics.contentSize;
        clip = { x: 0, y: 0, width: Math.min(size.width, 16_384), height: Math.min(size.height, 16_384), scale: 1 };
      }
      if (args.cropWidth !== undefined || args.cropHeight !== undefined) clip = {
        x: finiteNumber(args.cropX ?? 0, "cropX", 0, 100_000), y: finiteNumber(args.cropY ?? 0, "cropY", 0, 100_000),
        width: finiteNumber(args.cropWidth, "cropWidth", 1, 16_384), height: finiteNumber(args.cropHeight, "cropHeight", 1, 16_384), scale: 1
      };
      if (clip && clip.width! * clip.height! > 40_000_000) clip.scale = Math.sqrt(40_000_000 / (clip.width! * clip.height!));
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("CDP screenshot timeout")), 12_000));
      const result = await Promise.race([
        this.cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, ...(clip ? { clip } : {}) }),
        timeout
      ]);
      return result.data;
    } catch {
      let rect: { x: number; y: number; width: number; height: number } | undefined;
      if (args.cropWidth !== undefined || args.cropHeight !== undefined) {
        rect = {
          x: finiteNumber(args.cropX ?? 0, "cropX", 0, 100_000),
          y: finiteNumber(args.cropY ?? 0, "cropY", 0, 100_000),
          width: finiteNumber(args.cropWidth, "cropWidth", 1, 16_384),
          height: finiteNumber(args.cropHeight, "cropHeight", 1, 16_384)
        };
      }
      const image = await this.contents.capturePage(rect);
      return image.toPNG().toString("base64");
    }
  }

  async annotate(enabled: boolean): Promise<void> {
    const contextId = await this.context();
    await this.inject(contextId);
    await this.evaluate(enabled ? annotationScript(this.binding) : "globalThis.__bgBrowserAnnotationStop?.()", contextId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.logs.length = 0; this.events.length = 0; this.children.clear();
    if (!this.contents.isDestroyed()) {
      try { this.contents.debugger.detach(); } catch { /* The renderer may already be gone. */ }
      this.contents.close({ waitForBeforeUnload: false });
    }
  }
}
