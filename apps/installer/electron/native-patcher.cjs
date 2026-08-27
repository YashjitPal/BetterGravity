const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const asar = require("@electron/asar");

const BETTERGRAVITY_VERSION = require("../package.json").version;
const MARKER_NAME = ".bettergravity.json";

function installationPaths(installationPath) {
  const resources = path.join(installationPath, "resources");
  return {
    executable: path.join(installationPath, "Antigravity.exe"),
    resources,
    currentAsar: path.join(resources, "app.asar"),
    originalAsar: path.join(resources, "_app.asar"),
    backups: path.join(resources, ".bettergravity", "backups")
  };
}

function readAsarManifest(archivePath) {
  asar.uncache(archivePath);
  const manifest = JSON.parse(asar.extractFile(archivePath, "package.json").toString("utf8"));
  if (manifest.name !== "antigravity" || manifest.productName !== "Antigravity" || typeof manifest.main !== "string") {
    throw new Error("The selected application is not a supported Antigravity installation.");
  }
  return manifest;
}

function readBootstrapMarker(archivePath) {
  try { asar.uncache(archivePath); return JSON.parse(asar.extractFile(archivePath, MARKER_NAME).toString("utf8")); } catch { return undefined; }
}

function isBootstrapAsar(archivePath) {
  try { asar.uncache(archivePath); return JSON.parse(asar.extractFile(archivePath, "package.json").toString("utf8")).name === "bettergravity-bootstrap"; } catch { return false; }
}

function sha256(filePath) { return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); }
function isSupportedVersion(version) { return typeof version === "string" && version.startsWith("2."); }

function findAntigravityInstallation() {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Antigravity"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Antigravity"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Antigravity")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(installationPaths(candidate).executable));
}

function inspectInstallation(installationPath) {
  const paths = installationPaths(installationPath);
  if (!fs.existsSync(paths.executable) || !fs.existsSync(paths.currentAsar)) {
    return { kind: "not-found", patchState: "unknown", nativePatchAvailable: false };
  }
  try {
    const currentIsBootstrap = isBootstrapAsar(paths.currentAsar);
    if (!currentIsBootstrap) {
      const currentHost = readAsarManifest(paths.currentAsar);
      const previousMarker = fs.existsSync(paths.originalAsar) ? readBootstrapMarker(paths.currentAsar) : undefined;
      return {
        kind: fs.existsSync(paths.originalAsar) || previousMarker ? "needs-repatch" : "detected",
        patchState: fs.existsSync(paths.originalAsar) || previousMarker ? "needs-repatch" : "unpatched",
        path: installationPath,
        antigravityVersion: currentHost.version,
        nativePatchAvailable: isSupportedVersion(currentHost.version)
      };
    }

    const marker = readBootstrapMarker(paths.currentAsar);
    if (!marker || !fs.existsSync(paths.originalAsar)) {
      return { kind: "corrupted", patchState: "corrupted", path: installationPath, betterGravityVersion: marker?.betterGravityVersion, nativePatchAvailable: false };
    }
    const original = readAsarManifest(paths.originalAsar);
    const currentInstaller = marker.betterGravityVersion === BETTERGRAVITY_VERSION;
    return { kind: currentInstaller ? "patched" : "needs-repatch", patchState: currentInstaller ? "patched" : "needs-repatch", path: installationPath, antigravityVersion: original.version, betterGravityVersion: marker.betterGravityVersion, nativePatchAvailable: isSupportedVersion(original.version) };
  } catch (error) {
    return { kind: "corrupted", patchState: "corrupted", path: installationPath, nativePatchAvailable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function antigravityProcessIds(installationPath) {
  if (process.platform !== "win32") return [];
  try {
    const escaped = installationPath.replaceAll("'", "''");
    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${escaped}', [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -ExpandProperty ProcessId`], { encoding: "utf8", windowsHide: true });
    return output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).map(Number).filter((value) => Number.isInteger(value) && value > 0);
  } catch { return []; }
}

async function closeAntigravity(installationPath, onProgress) {
  const processIds = antigravityProcessIds(installationPath);
  if (processIds.length === 0) return;
  onProgress({ percent: 8, stage: "inspect", message: "Closing Antigravity safely…" });
  for (const processId of processIds) {
    try { execFileSync("taskkill.exe", ["/PID", String(processId), "/T"], { windowsHide: true, stdio: "ignore" }); } catch {}
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (antigravityProcessIds(installationPath).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  for (const processId of antigravityProcessIds(installationPath)) {
    try { execFileSync("taskkill.exe", ["/PID", String(processId), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
  }
  if (antigravityProcessIds(installationPath).length > 0) throw new Error("Antigravity could not be closed automatically. Close it from Task Manager and retry.");
}

function timestamp() { return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"); }
function snapshotFile(source, backupDirectory, label) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(backupDirectory, { recursive: true });
  fs.copyFileSync(source, path.join(backupDirectory, `${label}-${timestamp()}.asar`));
}

function loaderSource() {
  return `"use strict";\nconst path=require("node:path");\nconst{app}=require("electron");\nconst originalAsar=path.join(__dirname,"..","_app.asar");\nconst originalPackage=require(path.join(originalAsar,"package.json"));\nconst originalMain=path.join(originalAsar,originalPackage.main);\nglobal.BetterGravity=Object.freeze({version:"${BETTERGRAVITY_VERSION}",hostVersion:originalPackage.version});\nrequire.main.filename=originalMain;\napp.setAppPath(originalAsar);\nrequire(originalMain);\n`;
}

async function createBootstrapAsar(destination, hostManifest, originalHash) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bettergravity-bootstrap-"));
  try {
    fs.writeFileSync(path.join(temporaryDirectory, "package.json"), JSON.stringify({ name: "bettergravity-bootstrap", version: BETTERGRAVITY_VERSION, private: true, main: "index.js" }, null, 2));
    fs.writeFileSync(path.join(temporaryDirectory, "index.js"), loaderSource());
    fs.writeFileSync(path.join(temporaryDirectory, MARKER_NAME), JSON.stringify({ schemaVersion: 1, betterGravityVersion: BETTERGRAVITY_VERSION, antigravityVersion: hostManifest.version, originalAsarSha256: originalHash, installedAt: new Date().toISOString() }, null, 2));
    await asar.createPackage(temporaryDirectory, destination);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function runOperation(operation, installationPath, onProgress = () => undefined) {
  const paths = installationPaths(installationPath);
  const before = inspectInstallation(installationPath);
  if (before.kind === "not-found") throw new Error("Antigravity could not be found at the selected location.");
  if (!before.nativePatchAvailable) throw new Error(`Antigravity ${before.antigravityVersion ?? "unknown"} has not been marked compatible yet.`);
  await closeAntigravity(installationPath, onProgress);
  onProgress({ percent: 16, stage: "inspect", message: `Detected Antigravity ${before.antigravityVersion}.` });

  snapshotFile(paths.currentAsar, paths.backups, "app");
  snapshotFile(paths.originalAsar, paths.backups, "original-app");
  onProgress({ percent: 34, stage: "backup", message: "Created a recoverable snapshot of the host bundle." });

  if (!isBootstrapAsar(paths.currentAsar)) {
    readAsarManifest(paths.currentAsar);
    fs.copyFileSync(paths.currentAsar, paths.originalAsar);
  }
  const hostManifest = readAsarManifest(paths.originalAsar);
  const replacement = path.join(paths.resources, "app.asar.bettergravity-new");
  fs.rmSync(replacement, { force: true });
  await createBootstrapAsar(replacement, hostManifest, sha256(paths.originalAsar));
  if (!isBootstrapAsar(replacement)) throw new Error("The BetterGravity bootstrap could not be verified before installation.");
  fs.rmSync(paths.currentAsar, { force: true });
  fs.renameSync(replacement, paths.currentAsar);
  asar.uncacheAll();
  onProgress({ percent: 70, stage: "apply", message: "Installed the BetterGravity bootstrap." });

  const after = inspectInstallation(installationPath);
  if (after.kind !== "patched") throw new Error("Verification failed. The original Antigravity bundle and backup were kept.");
  onProgress({ percent: 94, stage: "verify", message: "Verified app.asar, _app.asar, and the BetterGravity marker." });
  onProgress({ percent: 100, stage: "complete", message: "BetterGravity is patched. Antigravity can be reopened." });
  return { installation: after, message: operation === "install" ? "BetterGravity patched successfully." : "BetterGravity repatched successfully." };
}

module.exports = { closeAntigravity, findAntigravityInstallation, inspectInstallation, runOperation };
