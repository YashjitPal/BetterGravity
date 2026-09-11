/**
 * Sky CUA (Computer Use Agent) Native Helper Bridge
 * Extracted from main-g2764IDy.js & src-CLzQUgbV.js
 */

import path from "node:path";
import fs from "node:fs";

export const CUA_ENV_KEYS = {
  SERVICE_PATH: "SKY_CUA_SERVICE_PATH",
  SERVICE_NATIVE_PIPE_PATH: "SKY_CUA_SERVICE_NATIVE_PIPE_PATH",
  NATIVE_PIPE_ENABLED: "SKY_CUA_NATIVE_PIPE",
  NATIVE_PIPE_DIRECTORY: "SKY_CUA_NATIVE_PIPE_DIRECTORY",
  HOST_SERVICES_PIPE_PATH: "NODE_REPL_HOST_SERVICES_PIPE_PATH",
};

export class CuaServiceBridge {
  constructor({
    codexHome = null,
    platform = process.platform,
    arch = process.arch,
    nativePipePath = null,
  } = {}) {
    this.codexHome = codexHome;
    this.platform = platform;
    this.arch = arch;
    this.nativePipePath = nativePipePath;
    this.helperProcess = null;
  }

  /**
   * Resolve platform-specific native CUA executable path
   */
  resolveHelperExecutable(baseDir = this.codexHome) {
    if (!baseDir) return null;

    if (this.platform === "darwin") {
      const candidates = [
        path.join(baseDir, "computer-use", "Codex Computer Use.app"),
        path.join(baseDir, "cua_node", "lib", "node_modules", "@oai", "sky", "Codex Computer Use.app"),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
    } else if (this.platform === "win32") {
      const exeName = this.arch === "arm64" ? "codex-computer-use-arm64.exe" : "codex-computer-use.exe";
      const candidates = [
        path.join(baseDir, "bin", "windows", exeName),
        path.join(baseDir, "bin", "windows", "swift", this.arch === "arm64" ? "arm64" : "x64", "codex-computer-use-swift.exe"),
        path.join(baseDir, "bin", "windows", "codex-computer-use.exe"),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
    }
    return null;
  }

  /**
   * Build environment dictionary for child process / node-repl execution
   */
  buildProcessEnv({ serviceAppPath = null, nativePipeDirectory = null, nativePipeEnabled = true } = {}) {
    const env = {};
    const appPath = serviceAppPath || this.resolveHelperExecutable();
    if (appPath) {
      env[CUA_ENV_KEYS.SERVICE_PATH] = appPath;
    }
    if (nativePipeEnabled) {
      env[CUA_ENV_KEYS.NATIVE_PIPE_ENABLED] = "1";
      if (nativePipeDirectory || this.nativePipePath) {
        env[CUA_ENV_KEYS.NATIVE_PIPE_DIRECTORY] = nativePipeDirectory || this.nativePipePath;
      }
    }
    return env;
  }

  /**
   * Check if native computer use addon is available
   */
  isAddonAvailable() {
    const candidates = [
      path.join(this.codexHome || "", "computer_use_app_icons.node"),
      path.join(this.codexHome || "", "node_modules", "computer_use_app_icons.node"),
    ];
    return candidates.some((c) => fs.existsSync(c));
  }
}
