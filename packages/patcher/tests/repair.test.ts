import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectInstallation, installationPaths, runOperation } from "../src/native/index.js";
import { guard } from "../src/native/repair.js";
import { createFixture, noopHostControl, writeHostArchive, type Fixture } from "./fixtures.js";

let fixture: Fixture;
let logged: string[];

const options = () => ({ runtimeSource: fixture.runtimeSource, closeHost: noopHostControl });

/** Reproduces what electron-updater does: replace app.asar, leave _app.asar. */
const simulateHostUpdate = (version: string) => writeHostArchive(installationPaths(fixture.root).currentAsar, version);

const guardOptions = (overrides: Partial<Parameters<typeof guard>[0]> = {}) => ({
  installationPath: fixture.root,
  closeHost: noopHostControl,
  isHostRunning: () => false,
  pollIntervalMs: 1,
  exitTimeoutMs: 50,
  watchTimeoutMs: 50,
  sleep: () => Promise.resolve(),
  log: (message: string) => void logged.push(message),
  ...overrides
});

beforeEach(async () => {
  fixture = await createFixture();
  logged = [];
  await runOperation("install", fixture.root, options());
});

afterEach(() => {
  fixture.cleanup();
});

describe("guard", () => {
  it("does nothing when the installation is still patched", async () => {
    const outcome = await guard(guardOptions());

    expect(outcome.kind).toBe("already-patched");
    expect(inspectInstallation(fixture.root).kind).toBe("patched");
  });

  it("reapplies the patch after Antigravity replaces the bundle", async () => {
    await simulateHostUpdate("2.12.0");
    expect(inspectInstallation(fixture.root).kind).toBe("needs-repatch");

    const outcome = await guard(guardOptions());

    expect(outcome).toEqual({ kind: "repatched", version: "2.12.0" });
    expect(inspectInstallation(fixture.root)).toMatchObject({ kind: "patched", antigravityVersion: "2.12.0" });
  });

  it("adopts the updated bundle as the original", async () => {
    await simulateHostUpdate("2.12.0");
    await guard(guardOptions());

    const restored = installationPaths(fixture.root).originalAsar;
    expect(fs.existsSync(restored)).toBe(true);
    expect(inspectInstallation(fixture.root).antigravityVersion).toBe("2.12.0");
  });

  it("waits for Antigravity to exit before touching anything", async () => {
    await simulateHostUpdate("2.12.0");
    let calls = 0;

    const outcome = await guard(
      guardOptions({
        // Running for the first few checks, then gone.
        isHostRunning: () => (calls += 1) <= 3
      })
    );

    expect(calls).toBeGreaterThan(3);
    expect(outcome.kind).toBe("repatched");
  });

  it("gives up rather than fighting an application that will not close", async () => {
    await simulateHostUpdate("2.12.0");

    const outcome = await guard(guardOptions({ isHostRunning: () => true }));

    expect(outcome.kind).toBe("host-still-running");
    expect(inspectInstallation(fixture.root).kind).toBe("needs-repatch");
  });

  // Nothing was waiting to be put back, so a reopened Antigravity just means
  // the moment has passed.
  it("stops if Antigravity is reopened with the patch intact", async () => {
    let checks = 0;
    const outcome = await guard(
      guardOptions({
        watchTimeoutMs: 10_000,
        isHostRunning: () => (checks += 1) > 2
      })
    );

    expect(outcome.kind).toBe("already-patched");
    expect(logged).toContain("Antigravity started again; stopping.");
  });

  /**
   * Regression, and the reason the guardian existed but never fired: an update
   * ends with Antigravity relaunching itself, so treating that as a stop
   * condition meant the guardian could only ever win a narrow race. Observed on
   * a real 2.11 to 2.12 update, where it logged "Antigravity started again"
   * fifty seconds in and left the installation unpatched.
   */
  describe("when the updater relaunches Antigravity", () => {
    /** Answers in order, then holds the last answer. */
    const hostRunning = (answers: readonly boolean[]) => {
      let index = 0;
      return () => answers[Math.min(index++, answers.length - 1)] ?? false;
    };

    /** A clock that only moves while the guardian is sleeping. */
    const clock = () => {
      let time = 0;
      return { now: () => time, sleep: async (ms: number) => void (time += ms) };
    };

    // Closed for the initial wait, back up as the updater leaves it, then
    // closed again by the user.
    const relaunched = [false, true, true, true, false];

    it("waits for it to close rather than giving up", async () => {
      await simulateHostUpdate("2.12.0");

      const outcome = await guard(
        guardOptions({ watchTimeoutMs: 10, repatchTimeoutMs: 10_000, isHostRunning: hostRunning(relaunched) })
      );

      expect(outcome).toEqual({ kind: "repatched", version: "2.12.0" });
      expect(inspectInstallation(fixture.root)).toMatchObject({ kind: "patched", antigravityVersion: "2.12.0" });
    });

    // The window for spotting an update is short; the patience for acting on
    // one that has been spotted is not.
    it("keeps waiting past the window it would watch for an update in", async () => {
      await simulateHostUpdate("2.12.0");
      const time = clock();

      const outcome = await guard(
        guardOptions({
          watchTimeoutMs: 0,
          repatchTimeoutMs: 10 * 60_000,
          pollIntervalMs: 1_000,
          idlePollIntervalMs: 15_000,
          isHostRunning: hostRunning(relaunched),
          now: time.now,
          sleep: time.sleep
        })
      );

      expect(outcome.kind).toBe("repatched");
    });

    it("says it is waiting, once rather than on every poll", async () => {
      await simulateHostUpdate("2.12.0");

      await guard(guardOptions({ repatchTimeoutMs: 10_000, isHostRunning: hostRunning(relaunched) }));

      expect(logged.filter((line) => line.includes("waiting for it to close"))).toHaveLength(1);
    });

    it("gives up if it never gets a quiet moment", async () => {
      await simulateHostUpdate("2.12.0");
      const time = clock();

      const outcome = await guard(
        guardOptions({
          repatchTimeoutMs: 60_000,
          idlePollIntervalMs: 15_000,
          // Closed for the initial wait, then back and never leaving.
          isHostRunning: hostRunning([false, true]),
          now: time.now,
          sleep: time.sleep
        })
      );

      expect(outcome.kind).toBe("host-still-running");
      expect(inspectInstallation(fixture.root).kind).toBe("needs-repatch");
    });
  });

  it("refuses to patch a host version outside the supported major", async () => {
    await simulateHostUpdate("3.0.0");

    const outcome = await guard(guardOptions());

    expect(outcome.kind).toBe("no-update");
    expect(inspectInstallation(fixture.root).kind).toBe("needs-repatch");
  });

  it("reports a failure instead of throwing", async () => {
    await simulateHostUpdate("2.12.0");
    // The runtime files it would deploy are gone, so reapplying cannot succeed.
    fs.rmSync(installationPaths(fixture.root).runtimeCode, { recursive: true, force: true });

    const outcome = await guard(guardOptions());

    expect(outcome.kind).toBe("failed");
    expect(logged.some((line) => line.includes("Could not reapply"))).toBe(true);
  });

  // Regression: the guardian reads app.asar on every poll, so it holds a cached
  // header for the patched bundle by the time the updater swaps the file. That
  // stale cache made the reapply fail with a bogus ENOENT.
  it("survives the bundle changing underneath a poll it already made", async () => {
    let polls = 0;

    const outcome = await guard(
      guardOptions({
        watchTimeoutMs: 10_000,
        sleep: async () => {
          polls += 1;
          if (polls === 2) await simulateHostUpdate("2.12.0");
        }
      })
    );

    expect(polls).toBeGreaterThanOrEqual(2);
    expect(outcome).toEqual({ kind: "repatched", version: "2.12.0" });
    expect(inspectInstallation(fixture.root)).toMatchObject({ kind: "patched", antigravityVersion: "2.12.0" });
  });

  it("explains what it did", async () => {
    await simulateHostUpdate("2.12.0");
    await guard(guardOptions());

    expect(logged).toContain("Antigravity 2.12.0 replaced the patch.");
    expect(logged).toContain("Reapplying.");
    expect(logged).toContain("Reapplied successfully.");
  });
});
