import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";

for (const scope of ["full", "agent"] as const) {
it.runIf(process.platform === "win32")(scope === "full" ? "runs the extracted browser client and native pane, then revokes every tool and renderer on disable" : "keeps the Willow browser controls visible during a task and ends them on completion", async () => {
  const require = createRequire(import.meta.url);
  const electron = process.env.BETTERGRAVITY_TEST_ELECTRON ?? require("electron") as string;
  if (basename(electron).toLowerCase() !== "electron.exe") throw new Error("Use standalone test Electron, never Antigravity.");
  const directory = await mkdtemp(join(tmpdir(), "bettergravity-browser-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    await build({ entryPoints: [resolve("packages/runtime/src/main/browser/index.ts")], outfile: join(directory, "browser.cjs"), bundle: true, minify: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "silent" });
    try {
      await promisify(execFile)(electron, [resolve("packages/runtime/tests/fixtures/browser-electron.cjs"), directory, resolve("community/plugins"), scope], { env, windowsHide: true, timeout: 165_000 });
    } catch (error) { throw new Error(await readFile(join(directory, "result.json"), "utf8").catch(() => "No browser test report was written."), { cause: error }); }
    const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
    expect(result).toMatchObject({ coldAutoOpen: true, collapsedAutoOpen: true, nativeTabAutoOpen: true, unmountedAutoOpen: true, agentCursor: true, activityBorder: true, takeOverControl: true, cursorScreenshotClean: true, cursorCancellation: true, dragCancellation: true });
    expect(result).toMatchObject({ agentIndicatorsPersist: true, agentIndicatorsClearOnClose: true, agentIndicatorsEndWithTask: true });
    expect(result).toMatchObject({ disabledInitially: true, registered: true, toolsRevoked: true, cancelledAction: true, errors: [] });
    if (scope === "agent") {
      expect(result).toMatchObject({ agentBackgroundTabs: true, independentUserInput: true, composerCompletion: true, agentTabIndicators: true, agentResponseIsolation: true });
      return;
    }
    expect(result).toMatchObject({ paneTabs: true, leftResize: true, resizeHover: true, animationAlignment: true, reopenAlignment: true, overlayCompositing: true, willowTooltip: true, remountAlignment: true, sustainedPlayback: true });
    expect(result).toMatchObject({ sharedPageTabs: true, nativePlusMenu: true, tabHoverStable: true, metadataAutoOpen: true, legacyActivityAutoOpen: true, cursorOnClick: true, codexInstructions: true });
    expect(result).toMatchObject({ disabledInitially: true, registered: true, extractedClient: true, trustedClick: true, localhost: true, screenshot: true, fullScreenshot: true, freshScreenshot: true, concurrentWaits: true, fileUpload: true, framesAndPopups: true, dialogs: true, annotations: true, cdpAndViewport: true, pausedAction: true, tabsRestored: true, uninstallRevokes: true, nativeViewAttached: true, layoutPreserved: true, toolsRevoked: true, cancelledAction: true, reenabled: true, errors: [] });
  } finally {
    if (process.env.BETTERGRAVITY_BROWSER_QA_DIRECTORY) {
      const destination = resolve(process.env.BETTERGRAVITY_BROWSER_QA_DIRECTORY, scope);
      await mkdir(destination, { recursive: true });
      for (const file of ["browser-empty.png", "browser-page.png", "browser-chrome.png", "browser-full.png", "browser-overlay.png", "browser-agent-cursor.png", "browser-agent-idle.png", "result.json"]) {
        await copyFile(join(directory, file), join(destination, file)).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
    }
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("bettergravity-browser-")) throw new Error("Unexpected browser test directory.");
    await rm(directory, { recursive: true, force: true });
  }
}, 175_000);
}
