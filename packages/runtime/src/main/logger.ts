import fs from "node:fs";
import path from "node:path";

const MAX_LOG_BYTES = 512 * 1024;

/**
 * Antigravity reassigns `console` to electron-log during its own startup and a
 * packaged build has no attached terminal, so the runtime keeps its own file.
 * Logging must never be able to take the runtime down.
 */
export class RuntimeLogger {
  private file: string | undefined;

  open(runtimeDirectory: string): void {
    const target = path.join(runtimeDirectory, "runtime.log");
    try {
      fs.mkdirSync(runtimeDirectory, { recursive: true });
      if (fs.existsSync(target) && fs.statSync(target).size > MAX_LOG_BYTES) fs.rmSync(target, { force: true });
      fs.appendFileSync(target, `\n--- session started ${new Date().toISOString()} ---\n`);
      this.file = target;
    } catch {
      this.file = undefined;
    }
  }

  info(message: string): void {
    this.write(message);
  }

  error(message: string, cause?: unknown): void {
    const detail = cause instanceof Error ? `${cause.message}\n${cause.stack ?? ""}` : cause === undefined ? "" : String(cause);
    this.write(detail ? `${message}\n${detail}` : message);
  }

  private write(body: string): void {
    if (!this.file) return;
    try {
      fs.appendFileSync(this.file, `[${new Date().toISOString()}] ${body}\n`);
    } catch {
      // A full or locked disk must not break injection.
    }
  }
}

export const logger = new RuntimeLogger();
