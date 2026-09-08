import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/protocol.js";
import { PetLibrary } from "../src/main/pets.js";

vi.mock("electron", () => ({ nativeImage: {
  createFromBuffer: (bytes: Buffer) => {
    const size = JSON.parse(bytes.toString()) as { width: number; height: number };
    return { isEmpty: () => !size.width, getSize: () => size,
      crop: () => ({ toDataURL: () => "data:image/png;base64,cHJldmlldw==" }),
      resize: () => ({ toDataURL: () => "data:image/png;base64,cHJldmlldw==" }) };
  }
} }));

let temporary: string;
let library: PetLibrary;
let configFile: string;
const enabled = { ...DEFAULT_SETTINGS, plugins: { developerMode: true, enabled: ["pets"] } };
const disabled = { ...enabled, plugins: { ...enabled.plugins, enabled: [] } };

function json(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function packagePet(id = "willow", overrides = {}, dimensions = { width: 1536, height: 2288 }): string {
  const folder = path.join(library.directory, id);
  json(path.join(folder, "pet.json"), { id, displayName: "Willow", description: "A small forest friend.",
    spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp", ...overrides });
  json(path.join(folder, "spritesheet.webp"), dimensions);
  return folder;
}

beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bg-pet-library-"));
  library = new PetLibrary(path.join(temporary, "BetterGravity"), path.join(temporary, "plugins"), path.join(temporary, "home"));
  configFile = path.join(temporary, "home/.gemini/config/skills.json");
  fs.mkdirSync(path.join(library.skillDirectory, "hatch-pet"), { recursive: true });
  fs.writeFileSync(path.join(library.skillDirectory, "hatch-pet/SKILL.md"), "---\nname: hatch-pet\ndescription: Hatch a pet.\n---\n");
});

afterEach(() => {
  library.dispose();
  if (path.dirname(temporary) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith("bg-pet-library-")) {
    throw new Error("Unexpected test cleanup path.");
  }
  fs.rmSync(temporary, { recursive: true, force: true });
});

describe("Pets native skill registration", () => {
  it("registers once, preserves other skills, and unregisters without deleting pets", async () => {
    const other = { path: "C:/team/skills", exclude: ["experimental"] };
    const inherited = [{ path: "C:/team/common.json" }];
    json(configFile, { entries: [other], inherits: inherited });
    library.sync(enabled);
    library.sync(enabled);
    expect(JSON.parse(fs.readFileSync(configFile, "utf8"))).toEqual({ entries: [other, { path: library.skillDirectory }], inherits: inherited });
    const folder = packagePet();
    expect(library.prepareCreation().skillPath).toBe(path.join(library.skillDirectory, "hatch-pet/SKILL.md"));
    library.sync(disabled);
    expect(JSON.parse(fs.readFileSync(configFile, "utf8"))).toEqual({ entries: [other], inherits: inherited });
    expect(fs.existsSync(path.join(folder, "pet.json"))).toBe(true);
    expect(() => library.prepareCreation()).toThrow("Enable Pets");
    expect((await library.read()).pets).toEqual([]);
    library.sync(enabled);
    expect((await library.read()).pets.map(pet => pet.id)).toEqual(["willow"]);
  });

  it("keeps a malformed native skills config intact and reports the problem", async () => {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, "{unfinished");
    library.sync(enabled);
    expect(fs.readFileSync(configFile, "utf8")).toBe("{unfinished");
    expect((await library.read()).skillPath).toBeNull();
    expect(() => library.prepareCreation()).toThrow();
  });

  it("does not claim creation is available if the skill bundle is missing", async () => {
    fs.renameSync(path.join(library.skillDirectory, "hatch-pet/SKILL.md"), path.join(library.skillDirectory, "hatch-pet/unavailable.md"));
    library.sync(enabled);
    expect((await library.read()).message).toContain("skill is missing");
    expect(fs.existsSync(configFile)).toBe(false);
  });

  it("unregisters when plugin execution is disabled globally", () => {
    library.sync(enabled);
    library.sync({ ...enabled, plugins: { developerMode: false, enabled: ["pets"] } });
    expect(JSON.parse(fs.readFileSync(configFile, "utf8")).entries).toEqual([]);
  });
});

describe("validated local pet packages", () => {
  beforeEach(() => library.sync(enabled));

  it("loads a version 2 package and exposes only thumbnails in the picker", async () => {
    packagePet();
    const pet = await library.load("willow");
    expect(pet).toMatchObject({ id: "willow", displayName: "Willow", spriteVersionNumber: 2 });
    expect(pet.spritesheetDataUrl).toMatch(/^data:image\/webp;base64,/);
    expect((await library.read()).pets[0]).not.toHaveProperty("spritesheetDataUrl");
  });

  it.each([
    [{ spriteVersionNumber: 1 }, { width: 1536, height: 1872 }],
    [{}, { width: 1536, height: 1872 }],
    [{ id: "wrong-folder" }, { width: 1536, height: 2288 }],
    [{ spritesheetPath: "../outside.webp" }, { width: 1536, height: 2288 }]
  ])("rejects invalid manifests and atlas dimensions", async (overrides, dimensions) => {
    packagePet("broken", overrides, dimensions);
    await expect(library.load("broken")).rejects.toThrow();
    expect((await library.read()).pets).toHaveLength(0);
    expect((await library.read()).message).toContain("broken");
  });

  it("rejects ids and directory links that escape the pet library", async () => {
    await expect(library.load("../outside")).rejects.toThrow("Invalid pet id");
    const outside = path.join(temporary, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(library.directory, "linked"), process.platform === "win32" ? "junction" : "dir");
    await expect(library.load("linked")).rejects.toThrow("outside");
  });

  it("shows actual generation stages and only marks validated installed pets ready", async () => {
    const runs = path.join(library.directory, ".hatching");
    json(path.join(runs, "pending/progress.json"), { name: "Willow", stage: "posing", updatedAt: "2026-09-09T10:00:00Z" });
    json(path.join(runs, "incomplete/progress.json"), { name: "Missing", stage: "ready", petId: "missing", updatedAt: "2026-09-09T11:00:00Z" });
    expect((await library.read()).runs).toMatchObject([{ id: "pending", stage: "posing" }]);
    packagePet();
    json(path.join(runs, "done/progress.json"), { name: "Willow", stage: "ready", petId: "willow", updatedAt: "2026-09-09T12:00:00Z" });
    expect((await library.read()).runs.map(run => run.stage)).toEqual(["ready", "posing"]);
  });
});
