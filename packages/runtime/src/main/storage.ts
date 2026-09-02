import fs from "node:fs";
import type { PluginStorageSnapshot } from "../protocol.js";
import { logger } from "./logger.js";

const FLUSH_DELAY_MS = 250;

/**
 * Per-plugin key/value storage in a single JSON file. Writes are debounced
 * because plugins tend to persist on every interaction, and a plugin losing
 * the last quarter second of state is preferable to hammering the disk.
 */
export class PluginStorageStore {
  private data: Record<string, Record<string, unknown>> = {};
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(private readonly file: string) {
    this.data = this.load();
  }

  snapshot(): PluginStorageSnapshot {
    return this.data;
  }

  namespace(pluginId: string): Readonly<Record<string, unknown>> {
    return this.data[pluginId] ?? {};
  }

  write(pluginId: string, key: string, value: unknown): void {
    if (typeof pluginId !== "string" || typeof key !== "string") return;
    const bucket = (this.data[pluginId] ??= {});
    if (value === undefined) delete bucket[key];
    else bucket[key] = value;
    this.scheduleFlush();
  }

  /** Forgets everything a plugin stored, used when a plugin is removed. */
  forget(pluginId: string): void {
    if (!(pluginId in this.data)) return;
    delete this.data[pluginId];
    this.scheduleFlush();
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    try {
      fs.writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`);
    } catch (error) {
      logger.error("Could not persist plugin storage.", error);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
  }

  private load(): Record<string, Record<string, unknown>> {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const result: Record<string, Record<string, unknown>> = {};
      for (const [pluginId, bucket] of Object.entries(parsed as Record<string, unknown>)) {
        if (bucket && typeof bucket === "object" && !Array.isArray(bucket)) {
          result[pluginId] = { ...(bucket as Record<string, unknown>) };
        }
      }
      return result;
    } catch {
      return {};
    }
  }
}
