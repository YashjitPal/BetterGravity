import type { InstallOperation, InstallationState, OperationProgress, Patcher } from "@bettergravity/patcher";
import { operationLabels } from "../domain/installer";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing installer element: ${id}`);
  return element as T;
}

const decisions: Record<string, { operation: InstallOperation; label: string; hint: string; icon: string; title: string; description: string }> = {
  unpatched: { operation: "install", label: "Install BetterGravity", hint: "Create a backup and patch Antigravity.", icon: "↓", title: "Antigravity is ready.", description: "We found a supported Antigravity installation. BetterGravity is not installed yet." },
  patched: { operation: "update", label: "Already up to date", hint: "No changes are needed.", icon: "✓", title: "BetterGravity is already installed.", description: "Your installation is healthy and already uses the current BetterGravity bootstrap." },
  "needs-repatch": { operation: "update", label: "Repatch BetterGravity", hint: "Refresh the patch for this Antigravity version.", icon: "↻", title: "A repatch is available.", description: "Antigravity changed since the last patch. You can leave it alone or repatch it now." },
  corrupted: { operation: "repair", label: "Repair BetterGravity", hint: "Restore the backup and rebuild the bootstrap.", icon: "◇", title: "The installation needs repair.", description: "BetterGravity found an incomplete or corrupted patch. Your backup will be kept." }
};

export class InstallerController {
  private installation: InstallationState = { kind: "not-found" };
  private busy = false;
  private toastTimer?: number;
  private secondaryMode: "choose" | "leave" = "choose";

  public constructor(private readonly patcher: Patcher) {}

  public async start(): Promise<void> {
    byId<HTMLButtonElement>("primaryAction").addEventListener("click", () => void this.runPrimary());
    byId<HTMLButtonElement>("secondaryAction").addEventListener("click", () => this.runSecondary());
    byId<HTMLButtonElement>("changeLocationButton").addEventListener("click", () => void this.chooseFolder());
    byId<HTMLInputElement>("folderPicker").addEventListener("change", (event) => this.onFolderChosen(event));
    this.installation = await this.patcher.detect();
    this.renderInstallation();
  }

  private runSecondary(): void {
    if (this.secondaryMode === "leave") window.betterGravityDesktop?.closeInstaller();
    else void this.chooseFolder();
  }

  private async chooseFolder(): Promise<void> {
    const selectedPath = await window.betterGravityDesktop?.chooseDirectory();
    if (selectedPath) {
      this.installation = await (window.betterGravityDesktop?.inspectInstallation(selectedPath) ?? Promise.resolve({ kind: "detected", path: selectedPath, patchState: "unpatched" }));
      this.renderInstallation();
      this.showToast("Antigravity folder selected.");
      return;
    }
    if (!window.betterGravityDesktop) byId<HTMLInputElement>("folderPicker").click();
  }

  private onFolderChosen(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const firstFile = input.files?.item(0);
    if (!firstFile) return;
    const selectedFolder = firstFile.webkitRelativePath.split("/")[0] || "Selected Antigravity folder";
    this.installation = { kind: "detected", path: selectedFolder, antigravityVersion: "Unknown", patchState: "unpatched" };
    this.renderInstallation();
  }

  private async runPrimary(): Promise<void> {
    const state = this.installation.patchState ?? "unknown";
    if (state === "patched") { this.showToast("BetterGravity is already current. Nothing changed."); return; }
    if (state === "unknown" || this.installation.kind === "not-found") { this.showToast("Antigravity was not found. Choose its installation folder."); void this.chooseFolder(); return; }
    await this.run(decisions[state]?.operation ?? "install");
  }

  private async run(operation: InstallOperation): Promise<void> {
    if (this.busy || !this.installation.path) return;
    this.busy = true;
    this.setBusy(true);
    byId<HTMLElement>("progressPanel").hidden = false;
    try {
      const result = await this.patcher.run(operation, this.installation.path, (progress) => this.renderProgress(operation, progress));
      this.installation = result.installation;
      this.renderInstallation();
      this.showToast(result.message);
      window.setTimeout(() => window.betterGravityDesktop?.closeInstaller(), 1100);
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : "The operation could not be completed.");
    } finally {
      this.busy = false;
      this.setBusy(false);
    }
  }

  private renderInstallation(): void {
    const patchState = this.installation.patchState ?? (this.installation.kind === "detected" ? "unpatched" : "unknown");
    const decision = decisions[patchState];
    const pill = byId<HTMLElement>("statePill");
    pill.classList.toggle("good", patchState === "patched");
    pill.classList.toggle("bad", patchState === "corrupted");
    byId<HTMLElement>("stateLabel").textContent = patchState === "unknown" ? "Not found" : patchState.replace("-", " ");
    byId<HTMLElement>("hostVersion").textContent = this.installation.antigravityVersion ? `Version ${this.installation.antigravityVersion}` : "Antigravity not detected";
    byId<HTMLElement>("hostPath").textContent = this.installation.path ?? "Looking in standard Windows locations";
    byId<HTMLElement>("stateTitle").textContent = decision?.title ?? "Antigravity was not found.";
    byId<HTMLElement>("stateDescription").textContent = decision?.description ?? "Choose the Antigravity installation folder to continue.";
    byId<HTMLElement>("stateEyebrow").textContent = patchState === "unknown" ? "READY FOR A LOCATION" : "AUTOMATIC CHECK COMPLETE";
    byId<HTMLElement>("decisionPanel").hidden = !decision;
    if (decision) {
      byId<HTMLElement>("primaryIcon").textContent = decision.icon;
      byId<HTMLElement>("primaryLabel").textContent = decision.label;
      byId<HTMLElement>("primaryHint").textContent = decision.hint;
      this.secondaryMode = patchState === "needs-repatch" ? "leave" : "choose";
      byId<HTMLButtonElement>("secondaryAction").textContent = this.secondaryMode === "leave" ? "Leave it alone" : "Choose a different location";
    }
    byId<HTMLButtonElement>("primaryAction").disabled = patchState === "patched";
  }

  private renderProgress(operation: InstallOperation, progress: OperationProgress): void {
    byId<HTMLElement>("progressEyebrow").textContent = progress.stage.toUpperCase();
    byId<HTMLElement>("progressTitle").textContent = operationLabels[operation];
    byId<HTMLElement>("progressPercent").textContent = `${progress.percent}%`;
    byId<HTMLElement>("progressBar").style.width = `${progress.percent}%`;
    byId<HTMLElement>("progressMessage").textContent = progress.message;
  }

  private setBusy(disabled: boolean): void {
    document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = disabled; });
  }

  private showToast(message: string): void {
    const toast = byId<HTMLElement>("toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3000);
  }
}
