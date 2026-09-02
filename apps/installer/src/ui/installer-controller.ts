import {
  availableOperations,
  type InstallOperation,
  type InstallationState,
  type OperationProgress,
  type Patcher
} from "@bettergravity/patcher";
import { operations, patchStateOf, states } from "../domain/installer";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing installer element: ${id}`);
  return element as T;
}

/** Electron wraps handler failures; the original message is the useful part. */
function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : "The operation could not be completed.";
  return message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

export class InstallerController {
  private installation: InstallationState = { kind: "not-found" };
  private busy = false;
  private toastTimer?: number;

  public constructor(private readonly patcher: Patcher) {}

  public async start(): Promise<void> {
    byId<HTMLButtonElement>("chooseLocation").addEventListener("click", () => void this.chooseFolder());
    byId<HTMLButtonElement>("closeButton").addEventListener("click", () => window.betterGravityDesktop?.closeInstaller());
    byId<HTMLButtonElement>("openLogButton").addEventListener("click", () => void this.openLog());
    byId<HTMLInputElement>("folderPicker").addEventListener("change", (event) => this.onFolderChosen(event));

    this.installation = await this.patcher.detect();
    this.render();
  }

  private async openLog(): Promise<void> {
    const failure = await window.betterGravityDesktop?.openRuntimeLog(this.installation.path ?? "");
    if (failure) this.showToast("No runtime log yet. It appears once Antigravity has run with BetterGravity.");
  }

  private async chooseFolder(): Promise<void> {
    const desktop = window.betterGravityDesktop;
    if (!desktop) {
      byId<HTMLInputElement>("folderPicker").click();
      return;
    }

    const selected = await desktop.chooseDirectory();
    if (!selected) return;

    this.installation = await desktop.inspectInstallation(selected);
    this.render();
    if (this.installation.kind === "not-found") this.showToast("That folder does not contain Antigravity.");
  }

  private onFolderChosen(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const first = input.files?.item(0);
    if (!first) return;
    const folder = first.webkitRelativePath.split("/")[0] || "Selected Antigravity folder";
    this.installation = { kind: "detected", path: folder, antigravityVersion: "Unknown", patchState: "unpatched" };
    this.render();
  }

  private async run(operation: InstallOperation): Promise<void> {
    if (this.busy || !this.installation.path) return;

    this.busy = true;
    this.setControlsDisabled(true);
    byId<HTMLElement>("progressPanel").hidden = false;

    try {
      const result = await this.patcher.run(operation, this.installation.path, (progress) =>
        this.renderProgress(operation, progress)
      );
      this.installation = result.installation;
      this.showToast(result.message);
    } catch (error) {
      this.showToast(readableError(error));
      // The operation may have completed partially, so trust disk over memory.
      const path = this.installation.path;
      if (path) this.installation = (await window.betterGravityDesktop?.inspectInstallation(path)) ?? this.installation;
    } finally {
      this.busy = false;
      this.setControlsDisabled(false);
      this.render();
    }
  }

  private render(): void {
    const patchState = patchStateOf(this.installation);
    const copy = states[patchState];
    const actions = availableOperations(this.installation);

    const pill = byId<HTMLElement>("statePill");
    pill.classList.toggle("good", copy.tone === "good");
    pill.classList.toggle("bad", copy.tone === "bad");

    byId<HTMLElement>("stateLabel").textContent = patchState === "unknown" ? "Not found" : patchState.replace("-", " ");
    byId<HTMLElement>("stateEyebrow").textContent = copy.eyebrow;
    byId<HTMLElement>("stateTitle").textContent = copy.title;
    byId<HTMLElement>("stateDescription").textContent = copy.description;

    byId<HTMLElement>("hostVersion").textContent = this.installation.antigravityVersion
      ? `Version ${this.installation.antigravityVersion}`
      : "Antigravity not detected";
    byId<HTMLElement>("hostPath").textContent = this.installation.path ?? "Looking in standard Windows locations";

    this.renderActions(actions);
  }

  private renderActions(actions: readonly InstallOperation[]): void {
    const [primary, ...secondary] = actions;
    const panel = byId<HTMLElement>("decisionPanel");
    const primaryButton = byId<HTMLButtonElement>("primaryAction");

    panel.hidden = actions.length === 0 && this.installation.kind !== "not-found";
    primaryButton.hidden = primary === undefined;

    if (primary) {
      const copy = operations[primary];
      byId<HTMLElement>("primaryIcon").textContent = copy.icon;
      byId<HTMLElement>("primaryLabel").textContent = copy.label;
      byId<HTMLElement>("primaryHint").textContent = copy.hint;
      primaryButton.onclick = () => void this.run(primary);
    }

    const container = byId<HTMLElement>("secondaryActions");
    container.replaceChildren();
    for (const operation of secondary) {
      const copy = operations[operation];
      const button = document.createElement("button");
      button.className = copy.destructive ? "secondary-action danger" : "secondary-action";
      button.type = "button";
      button.title = copy.hint;
      button.textContent = copy.label;
      button.onclick = () => void this.run(operation);
      container.append(button);
    }

    // With nothing installed there is still a location to choose.
    byId<HTMLButtonElement>("chooseLocation").hidden = false;
  }

  private renderProgress(operation: InstallOperation, progress: OperationProgress): void {
    byId<HTMLElement>("progressEyebrow").textContent = progress.stage.toUpperCase();
    byId<HTMLElement>("progressTitle").textContent = operations[operation].running;
    byId<HTMLElement>("progressPercent").textContent = `${progress.percent}%`;
    byId<HTMLElement>("progressBar").style.width = `${progress.percent}%`;
    byId<HTMLElement>("progressMessage").textContent = progress.message;
  }

  private setControlsDisabled(disabled: boolean): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>("button")) {
      button.disabled = disabled;
    }
  }

  private showToast(message: string): void {
    const toast = byId<HTMLElement>("toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 4200);
  }
}
