import type { InstallOperation, InstallationState, OperationProgress, Patcher } from "@bettergravity/patcher";
import { operationLabels } from "../domain/installer";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing installer element: ${id}`);
  return element as T;
}

export class InstallerController {
  private installation: InstallationState = { kind: "not-found" };
  private busy = false;
  private toastTimer?: number;

  public constructor(private readonly patcher: Patcher) {}

  public async start(): Promise<void> {
    byId<HTMLButtonElement>("chooseFolderButton").addEventListener("click", () => void this.chooseFolder());
    byId<HTMLInputElement>("folderPicker").addEventListener("change", (event) => this.onFolderChosen(event));
    document.querySelectorAll<HTMLButtonElement>("[data-operation]").forEach((button) => {
      button.addEventListener("click", () => void this.run(button.dataset.operation as InstallOperation));
    });
    this.installation = await this.patcher.detect();
    this.renderInstallation();
  }

  private async chooseFolder(): Promise<void> {
    const selectedPath = await window.betterGravityDesktop?.chooseDirectory();
    if (selectedPath) {
      this.installation = { kind: "detected", path: selectedPath, antigravityVersion: "Unknown" };
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
    this.installation = { kind: "detected", path: selectedFolder, antigravityVersion: "Unknown" };
    this.renderInstallation();
    this.showToast("Antigravity folder selected.");
  }

  private async run(operation: InstallOperation): Promise<void> {
    if (this.busy) return;
    if (this.installation.kind === "not-found") {
      this.showToast("Choose the Antigravity installation folder first.");
      void this.chooseFolder();
      return;
    }
    this.busy = true;
    this.setActionsDisabled(true);
    byId<HTMLElement>("progressPanel").hidden = false;
    try {
      const result = await this.patcher.run(operation, this.installation.path ?? "", (progress) => this.renderProgress(operation, progress));
      this.installation = result.installation;
      this.renderInstallation();
      this.showToast(result.message);
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : "The operation could not be completed.");
    } finally {
      this.busy = false;
      this.setActionsDisabled(false);
    }
  }

  private renderInstallation(): void {
    const pill = byId<HTMLElement>("installationPill");
    const summary = byId<HTMLElement>("installationSummary");
    const path = byId<HTMLElement>("installPath");
    pill.classList.toggle("ready", this.installation.kind !== "not-found");
    if (this.installation.kind === "not-found") {
      summary.textContent = "Antigravity not selected";
      path.textContent = "No installation selected";
      return;
    }
    path.textContent = this.installation.path ?? "Selected Antigravity folder";
    summary.textContent = this.installation.kind === "patched" ? `BetterGravity ${this.installation.betterGravityVersion} installed` : "Antigravity detected";
    byId<HTMLButtonElement>("chooseFolderButton").textContent = "Change";
  }

  private renderProgress(operation: InstallOperation, progress: OperationProgress): void {
    byId<HTMLElement>("progressEyebrow").textContent = progress.stage.toUpperCase();
    byId<HTMLElement>("progressTitle").textContent = operationLabels[operation];
    byId<HTMLElement>("progressPercent").textContent = `${progress.percent}%`;
    byId<HTMLElement>("progressBar").style.width = `${progress.percent}%`;
    byId<HTMLElement>("progressMessage").textContent = progress.message;
  }

  private setActionsDisabled(disabled: boolean): void {
    document.querySelectorAll<HTMLButtonElement>("[data-operation]").forEach((button) => { button.disabled = disabled; });
    byId<HTMLButtonElement>("chooseFolderButton").disabled = disabled;
  }

  private showToast(message: string): void {
    const toast = byId<HTMLElement>("toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3000);
  }
}
