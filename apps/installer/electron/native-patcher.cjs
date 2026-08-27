const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const asar = require("@electron/asar");

const installerPackage = require("../package.json");
const BETTERGRAVITY_VERSION = installerPackage.version;
const MARKER_NAME = ".bettergravity.json";

function installationPaths(installationPath) {
  const resources = path.join(installationPath, "resources");
  return {
    executable: path.join(installationPath, "Antigravity.exe"),
    resources,
    currentAsar: path.join(resources, "app.asar"),
    originalAsar: path.join(resources, "_app.asar"),
    loader: path.join(resources, "app"),
    marker: path.join(resources, "app", MARKER_NAME),
    backups: path.join(resources, ".bettergravity", "backups")
  };
}

function readAsarManifest(archivePath) {
  const manifest = JSON.parse(asar.extractFile(archivePath, "package.json").toString("utf8"));
  if (manifest.name !== "antigravity" || manifest.productName !== "Antigravity" || typeof manifest.main !== "string") {
    throw new Error("The selected application is not a supported Antigravity installation.");
  }
  return manifest;
}

function safeReadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return undefined; }
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isSupportedVersion(version) { return typeof version === "string" && version.startsWith("2."); }

function findAntigravityInstallation() {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Antigravity"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Antigravity"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Antigravity")
  ].filter(Boolean);
  return candidates.find((candidate) => {
    const paths = installationPaths(candidate);
    return fs.existsSync(paths.executable) && (fs.existsSync(paths.currentAsar) || fs.existsSync(paths.originalAsar));
  });
}

function inspectInstallation(installationPath) {
  const paths = installationPaths(installationPath);
  if (!fs.existsSync(paths.executable) || (!fs.existsSync(paths.currentAsar) && !fs.existsSync(paths.originalAsar))) {
    return { kind: "not-found", patchState: "unknown", nativePatchAvailable: false };
  }
  try {
    const activeAsar = fs.existsSync(paths.currentAsar) ? paths.currentAsar : paths.originalAsar;
    const host = readAsarManifest(activeAsar);
    const marker = safeReadJson(paths.marker);
    const hasCurrent = fs.existsSync(paths.currentAsar);
    const hasOriginal = fs.existsSync(paths.originalAsar);
    const hasLoader = fs.existsSync(path.join(paths.loader, "index.js"));
    const nativePatchAvailable = isSupportedVersion(host.version);
    if (!hasOriginal && hasCurrent && !marker) return { kind: "detected", patchState: "unpatched", path: installationPath, antigravityVersion: host.version, nativePatchAvailable };
    if (hasOriginal && hasCurrent && marker) return { kind: "needs-repatch", patchState: "needs-repatch", path: installationPath, antigravityVersion: host.version, betterGravityVersion: marker.betterGravityVersion, nativePatchAvailable };
    if (hasOriginal && !hasCurrent && hasLoader && marker) {
      const original = readAsarManifest(paths.originalAsar);
      const currentInstaller = marker.betterGravityVersion === BETTERGRAVITY_VERSION;
      return { kind: currentInstaller ? "patched" : "needs-repatch", patchState: currentInstaller ? "patched" : "needs-repatch", path: installationPath, antigravityVersion: original.version, betterGravityVersion: marker.betterGravityVersion, nativePatchAvailable: isSupportedVersion(original.version) };
    }
    return { kind: "corrupted", patchState: "corrupted", path: installationPath, antigravityVersion: host.version, betterGravityVersion: marker?.betterGravityVersion, nativePatchAvailable };
  } catch (error) {
    return { kind: "corrupted", patchState: "corrupted", path: installationPath, nativePatchAvailable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function isAntigravityRunning(installationPath) {
  if (process.platform !== "win32") return false;
  try {
    const escaped = installationPath.replaceAll("'", "''");
    const result = execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${escaped}', [System.StringComparison]::OrdinalIgnoreCase) } | Measure-Object).Count`], { encoding: "utf8", windowsHide: true }).trim();
    return Number(result) > 0;
  } catch { return false; }
}

function timestamp() { return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"); }

function snapshotFile(source, backupDirectory, label) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(backupDirectory, { recursive: true });
  fs.copyFileSync(source, path.join(backupDirectory, `${label}-${timestamp()}.asar`));
}

function loaderSource() {
  return `"use strict";\nconst path = require("node:path");\nconst { app } = require("electron");\nconst originalAsar = path.join(__dirname, "..", "_app.asar");\nconst originalPackage = require(path.join(originalAsar, "package.json"));\nconst originalMain = path.join(originalAsar, originalPackage.main);\nglobal.BetterGravity = Object.freeze({ version: "${BETTERGRAVITY_VERSION}", hostVersion: originalPackage.version });\nrequire.main.filename = originalMain;\napp.setAppPath(originalAsar);\nrequire(originalMain);\n`;
}

function replaceOriginalAsar(paths) {
  if (!fs.existsSync(paths.currentAsar)) return;
  readAsarManifest(paths.currentAsar);
  if (!fs.existsSync(paths.originalAsar)) {
    fs.renameSync(paths.currentAsar, paths.originalAsar);
    return;
  }
  const incoming = `${paths.originalAsar}.incoming`;
  fs.copyFileSync(paths.currentAsar, incoming);
  readAsarManifest(incoming);
  fs.rmSync(paths.originalAsar, { force: true });
  fs.renameSync(incoming, paths.originalAsar);
  fs.rmSync(paths.currentAsar, { force: true });
}

async function runOperation(operation, installationPath, onProgress = () => undefined) {
  const paths = installationPaths(installationPath);
  const before = inspectInstallation(installationPath);
  if (before.kind === "not-found") throw new Error("Antigravity could not be found at the selected location.");
  if (!before.nativePatchAvailable) throw new Error(`Antigravity ${before.antigravityVersion ?? "unknown"} has not been marked compatible yet.`);
  if (isAntigravityRunning(installationPath)) throw new Error("Close Antigravity completely, then try again.");
  onProgress({ percent: 12, stage: "inspect", message: `Detected Antigravity ${before.antigravityVersion}.` });
  snapshotFile(paths.currentAsar, paths.backups, "app");
  snapshotFile(paths.originalAsar, paths.backups, "original-app");
  onProgress({ percent: 32, stage: "backup", message: "Created a recoverable snapshot of the host bundle." });
  replaceOriginalAsar(paths);
  const hostManifest = readAsarManifest(paths.originalAsar);
  fs.rmSync(paths.loader, { recursive: true, force: true });
  fs.mkdirSync(paths.loader, { recursive: true });
  fs.writeFileSync(path.join(paths.loader, "package.json"), JSON.stringify({ name: "bettergravity-bootstrap", version: BETTERGRAVITY_VERSION, private: true, main: "index.js" }, null, 2));
  fs.writeFileSync(path.join(paths.loader, "index.js"), loaderSource());
  fs.writeFileSync(paths.marker, JSON.stringify({ schemaVersion: 1, betterGravityVersion: BETTERGRAVITY_VERSION, antigravityVersion: hostManifest.version, originalAsarSha256: sha256(paths.originalAsar), installedAt: new Date().toISOString() }, null, 2));
  onProgress({ percent: 65, stage: "apply", message: "Installed the BetterGravity bootstrap." });
  const after = inspectInstallation(installationPath);
  if (after.kind !== "patched") throw new Error("Verification failed. The backup was kept for recovery.");
  onProgress({ percent: 92, stage: "verify", message: "Verified the loader, marker, and original Antigravity bundle." });
  onProgress({ percent: 100, stage: "complete", message: "BetterGravity is patched. You can reopen Antigravity." });
  return { installation: after, message: operation === "install" ? "BetterGravity patched successfully." : "BetterGravity repatched successfully." };
}

module.exports = { findAntigravityInstallation, inspectInstallation, runOperation };
