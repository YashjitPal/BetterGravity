import fs from "node:fs";
import path from "node:path";
import type { PetCreationProgress, PetLibraryState, PetRecord, PetSprite, RuntimeSettings } from "../protocol.js";
import { PetImageReader } from "./pet-images.js";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STAGES = new Set(["preparing", "imagining", "posing", "hatching", "ready", "error"]);
const MAX_JSON_BYTES = 64 * 1024;

function readJson(file: string): Record<string, unknown> {
  if (fs.statSync(file).size > MAX_JSON_BYTES) throw new Error("The pet metadata is too large.");
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object.");
  return value as Record<string, unknown>;
}

function writeJson(file: string, value: unknown): void {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
}

function beneath(base: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.includes("\0")) throw new Error("Invalid pet file path.");
  const resolved = path.resolve(base, relative);
  if (!resolved.startsWith(path.resolve(base) + path.sep)) throw new Error("A pet file escapes its package.");
  const realBase = fs.realpathSync(base);
  const realFile = fs.realpathSync(resolved);
  if (!realFile.startsWith(realBase + path.sep)) throw new Error("A pet file links outside its package.");
  return realFile;
}

function directories(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && ID.test(entry.name)).map(entry => entry.name).sort();
}

/** Owns the plugin's one global skill entry and its durable local pet library. */
export class PetLibrary {
  readonly directory: string;
  readonly skillDirectory: string;
  private readonly skillsConfig: string;
  private enabled = false;
  private problem: string | undefined;
  private watcher: fs.FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly cache = new Map<string, { stamp: string; pet: PetSprite }>();
  private readonly images = new PetImageReader();

  constructor(root: string, plugins: string, home: string) {
    this.directory = path.join(root, "pets");
    this.skillDirectory = path.join(plugins, "pets", "skills");
    this.skillsConfig = path.join(home, ".gemini", "config", "skills.json");
  }

  onChanged(listener: () => void): void { this.listeners.add(listener); }

  sync(settings: RuntimeSettings): void {
    const wanted = settings.plugins.developerMode && settings.plugins.enabled.includes("pets");
    this.enabled = wanted;
    this.problem = undefined;
    try {
      const skill = path.join(this.skillDirectory, "hatch-pet", "SKILL.md");
      if (wanted && !fs.existsSync(skill)) throw new Error("The Hatch Pet skill is missing. Reinstall Pets.");
      const config = fs.existsSync(this.skillsConfig) ? readJson(this.skillsConfig) : {};
      if (config["entries"] !== undefined && !Array.isArray(config["entries"])) {
        throw new Error("Antigravity's skills.json has an invalid entries list; it was left unchanged.");
      }
      const entries = (config["entries"] ?? []) as unknown[];
      const ours = (entry: unknown) => !!entry && typeof entry === "object" &&
        typeof (entry as Record<string, unknown>)["path"] === "string" &&
        path.resolve((entry as { path: string }).path) === path.resolve(this.skillDirectory);
      const next = entries.filter(entry => !ours(entry));
      if (wanted) next.push({ path: this.skillDirectory });
      if (JSON.stringify(next) !== JSON.stringify(entries)) writeJson(this.skillsConfig, { ...config, entries: next });
      if (wanted) {
        fs.mkdirSync(this.directory, { recursive: true });
        fs.mkdirSync(path.join(this.directory, ".hatching"), { recursive: true });
        this.watch();
      }
    } catch (error) {
      this.problem = error instanceof Error ? error.message : String(error);
    }
    if (!wanted) {
      this.watcher?.close();
      this.watcher = undefined;
      if (this.debounce) clearTimeout(this.debounce);
      this.cache.clear();
      this.images.dispose();
    }
    this.announce();
  }

  prepareCreation(): { skillPath: string; directory: string } {
    this.requireEnabled();
    if (this.problem) throw new Error(this.problem);
    return { skillPath: path.join(this.skillDirectory, "hatch-pet", "SKILL.md"), directory: this.directory };
  }

  async read(): Promise<PetLibraryState> {
    const pets: PetRecord[] = [];
    const issues: string[] = this.problem ? [this.problem] : [];
    if (this.enabled) {
      for (const id of directories(this.directory).slice(0, 100)) {
        if (!this.enabled) break;
        try { const { spritesheetDataUrl: _sheet, ...record } = await this.load(id); pets.push(record); }
        catch (error) { issues.push(`${id}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    const runs = this.enabled ? await this.runs(new Set(pets.map(pet => pet.id))) : [];
    return {
      enabled: this.enabled,
      directory: this.directory,
      skillPath: this.enabled && !this.problem ? path.join(this.skillDirectory, "hatch-pet", "SKILL.md") : null,
      pets: this.enabled ? pets : [],
      runs: this.enabled ? runs : [],
      ...(issues.length ? { message: issues.join("\n") } : {})
    };
  }

  async load(id: string): Promise<PetSprite> {
    this.requireEnabled();
    if (!ID.test(id)) throw new Error("Invalid pet id.");
    const folder = beneath(this.directory, id);
    const manifestFile = beneath(folder, "pet.json");
    const manifest = readJson(manifestFile);
    if (manifest["id"] !== id || manifest["spriteVersionNumber"] !== 2 ||
      typeof manifest["displayName"] !== "string" || !manifest["displayName"].trim() ||
      typeof manifest["description"] !== "string" || typeof manifest["spritesheetPath"] !== "string") {
      throw new Error("The pet needs a version 2 manifest with its id, name, description, and sprite sheet.");
    }
    const file = beneath(folder, manifest["spritesheetPath"]);
    const info = fs.statSync(file);
    const stamp = `${fs.statSync(manifestFile).mtimeMs}:${info.mtimeMs}:${info.size}`;
    const cached = this.cache.get(id);
    if (cached?.stamp === stamp) return cached.pet;
    const image = await this.images.read(file, true);
    this.requireEnabled();
    const bytes = fs.readFileSync(file);
    const mime = /\.png$/i.test(file) ? "image/png" : "image/webp";
    const pet: PetSprite = {
      id, displayName: manifest["displayName"].trim().slice(0, 100), description: manifest["description"].slice(0, 500),
      spriteVersionNumber: 2,
      previewDataUrl: image.previewDataUrl,
      spritesheetDataUrl: `data:${mime};base64,${bytes.toString("base64")}`
    };
    this.cache.set(id, { stamp, pet });
    if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
    return pet;
  }

  dispose(): void {
    this.enabled = false;
    this.watcher?.close();
    if (this.debounce) clearTimeout(this.debounce);
    this.cache.clear();
    this.images.dispose();
    this.listeners.clear();
  }

  private requireEnabled(): void {
    if (!this.enabled) throw new Error("Enable Pets to use its pet library and creation skill.");
  }

  private async runs(petIds: ReadonlySet<string>): Promise<PetCreationProgress[]> {
    const root = path.join(this.directory, ".hatching");
    const result: PetCreationProgress[] = [];
    for (const id of directories(root).slice(-30)) {
      try {
        const folder = beneath(root, id);
        const value = readJson(beneath(folder, "progress.json"));
        if (typeof value["stage"] !== "string" || !STAGES.has(value["stage"]) ||
          typeof value["name"] !== "string" || typeof value["updatedAt"] !== "string" ||
          !Number.isFinite(Date.parse(value["updatedAt"]))) continue;
        const petId = typeof value["petId"] === "string" ? value["petId"] : undefined;
        if (value["stage"] === "ready" && (!petId || !petIds.has(petId))) continue;
        let previewDataUrl: string | undefined;
        if (typeof value["preview"] === "string") {
          try { previewDataUrl = (await this.images.read(beneath(folder, value["preview"]), false)).previewDataUrl; }
          catch { /* An incomplete image write should not hide genuine progress. */ }
        }
        result.push({ id, name: value["name"].slice(0, 100), stage: value["stage"] as PetCreationProgress["stage"],
          updatedAt: value["updatedAt"], ...(petId ? { petId } : {}), ...(previewDataUrl ? { previewDataUrl } : {}),
          ...(typeof value["message"] === "string" ? { message: value["message"].slice(0, 500) } : {}) });
      } catch { /* A generation may still be writing its first progress file. */ }
    }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  }

  private watch(): void {
    if (this.watcher) return;
    this.watcher = fs.watch(this.directory, { recursive: true, persistent: false }, () => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => { this.cache.clear(); this.announce(); }, 180);
    });
    this.watcher.on("error", () => { this.problem = "Pet folder monitoring stopped. Refresh the pet library to try again."; this.announce(); });
  }

  private announce(): void { for (const listener of this.listeners) listener(); }
}
