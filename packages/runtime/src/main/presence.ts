/**
 * Discord Rich Presence, over the IPC socket every Discord client listens on.
 *
 * This lives in the main process because it cannot live anywhere else. Discord
 * offers two transports: a local socket, and a WebSocket on ports 6463-6472.
 * The WebSocket one authenticates by matching the `Origin` header against a
 * fixed list registered on the application, and Antigravity serves its UI from
 * `https://127.0.0.1:<port>` with a port that changes every launch — so no
 * origin a plugin could send would stay registered. The socket has no such
 * check, and reaching it needs `node:net`, which the page world does not have.
 *
 * The capability is deliberately narrow. It dials Discord's own socket names
 * and nothing else, so it does not become a general outbound socket for
 * plugins, which would defeat the point of them being confined to the page.
 */

import net from "node:net";
import path from "node:path";
import type { PresenceActivity, PresenceStatus } from "../protocol.js";
import { logger } from "./logger.js";

export type { PresenceActivity, PresencePhase, PresenceStatus } from "../protocol.js";

/** Discord's framing: a little-endian opcode and length, then UTF-8 JSON. */
const HEADER_BYTES = 8;

const OPCODE = {
  handshake: 0,
  frame: 1,
  close: 2,
  ping: 3,
  pong: 4
} as const;

/**
 * Discord numbers its sockets 0-9 so several clients (stable, PTB, canary) can
 * run at once. Whichever answers first is the one to talk to.
 */
const SOCKET_COUNT = 10;

/** A malformed length must not be able to allocate the host out of memory. */
const MAX_FRAME_BYTES = 1024 * 1024;

/** Long enough for a busy client, short enough not to stall a probe of ten. */
const CONNECT_TIMEOUT_MS = 2000;

/** How long READY may take before the socket is treated as a dead end. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * Discord rate-limits activity updates. Presence only changes when the agent
 * starts or stops, so a floor this coarse is never felt, and the trailing
 * update below means a change during the window is delayed rather than lost.
 */
const MIN_UPDATE_INTERVAL_MS = 5000;

/** Retry while Discord is closed, backing off so a permanent absence is cheap. */
const RETRY_MIN_MS = 10_000;
const RETRY_MAX_MS = 60_000;

/**
 * The part of `net.Socket` this needs, so tests can supply a double rather than
 * a real pipe.
 */
export interface PresenceSocket {
  write(chunk: Buffer): void;
  destroy(): void;
  on(event: "data", listener: (chunk: Buffer) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
}

export type PresenceConnector = (socketPath: string) => Promise<PresenceSocket>;

/**
 * Where Discord puts its socket. Windows uses a named pipe; everywhere else it
 * is a file in the runtime directory, which the Flatpak and Snap builds nest
 * one level further down.
 */
export function socketCandidates(
  platform: string = process.platform,
  environment: NodeJS.ProcessEnv = process.env
): readonly string[] {
  const names = Array.from({ length: SOCKET_COUNT }, (_, index) => `discord-ipc-${index}`);
  if (platform === "win32") return names.map((name) => `\\\\?\\pipe\\${name}`);

  const base =
    environment["XDG_RUNTIME_DIR"] ??
    environment["TMPDIR"] ??
    environment["TMP"] ??
    environment["TEMP"] ??
    "/tmp";
  // posix.join rather than join: these are always POSIX paths, and building
  // them on a Windows host — as the tests do — would otherwise use backslashes.
  const roots = [
    base,
    path.posix.join(base, "app", "com.discordapp.Discord"),
    path.posix.join(base, "snap.discord")
  ];
  return roots.flatMap((root) => names.map((name) => path.posix.join(root, name)));
}

export function encodeFrame(opcode: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeInt32LE(opcode, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

export interface DecodedFrame {
  readonly opcode: number;
  readonly payload: Record<string, unknown>;
}

/**
 * Reassembles frames from a socket's chunks, which split and merge freely.
 */
export class FrameReader {
  private pending = Buffer.alloc(0);

  push(chunk: Buffer): readonly DecodedFrame[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const frames: DecodedFrame[] = [];

    while (this.pending.length >= HEADER_BYTES) {
      const opcode = this.pending.readInt32LE(0);
      const length = this.pending.readInt32LE(4);
      if (length < 0 || length > MAX_FRAME_BYTES) throw new Error(`Discord sent a ${length}-byte frame.`);
      if (this.pending.length < HEADER_BYTES + length) break;

      const body = this.pending.subarray(HEADER_BYTES, HEADER_BYTES + length).toString("utf8");
      this.pending = this.pending.subarray(HEADER_BYTES + length);
      try {
        frames.push({ opcode, payload: JSON.parse(body) as Record<string, unknown> });
      } catch {
        throw new Error("Discord sent a frame that was not JSON.");
      }
    }

    return frames;
  }
}

/** Discord's activity object, which is snake_case and drops empty fields. */
export function toWireActivity(activity: PresenceActivity): Record<string, unknown> | undefined {
  const wire: Record<string, unknown> = {};
  if (activity.details) wire["details"] = activity.details;
  if (activity.state) wire["state"] = activity.state;

  const timestamps: Record<string, number> = {};
  if (typeof activity.startedAt === "number") timestamps["start"] = Math.round(activity.startedAt);
  if (typeof activity.endsAt === "number") timestamps["end"] = Math.round(activity.endsAt);
  if (Object.keys(timestamps).length > 0) wire["timestamps"] = timestamps;

  const assets: Record<string, string> = {};
  if (activity.largeImage) assets["large_image"] = activity.largeImage;
  if (activity.largeText) assets["large_text"] = activity.largeText;
  if (activity.smallImage) assets["small_image"] = activity.smallImage;
  if (activity.smallText) assets["small_text"] = activity.smallText;
  if (Object.keys(assets).length > 0) wire["assets"] = assets;

  // Discord clears the presence when the activity is absent, which is exactly
  // what an activity with nothing in it should mean.
  return Object.keys(wire).length > 0 ? wire : undefined;
}

function connectToPipe(socketPath: string): Promise<PresenceSocket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error(`${socketPath} did not answer.`)), CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.setNoDelay(true);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
  });
}

/**
 * One connection to the local Discord client, owned by the main process and
 * shared by whichever plugin is driving it.
 */
export class PresenceConnection {
  private socket: PresenceSocket | undefined;
  private reader = new FrameReader();
  private clientId = "";
  private status: PresenceStatus = { phase: "off" };
  private readonly listeners = new Set<(status: PresenceStatus) => void>();

  /** The activity to show once connected, and whether one was ever asked for. */
  private desired: PresenceActivity | undefined;
  private requested = false;
  private sentAt = 0;
  private flushTimer: NodeJS.Timeout | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private handshakeTimer: NodeJS.Timeout | undefined;
  private retryDelay = RETRY_MIN_MS;
  /** Set while the caller wants a connection, so retries know to keep going. */
  private wanted = false;
  private nonce = 0;

  constructor(private readonly connect: PresenceConnector = connectToPipe) {}

  current(): PresenceStatus {
    return this.status;
  }

  onStatusChanged(listener: (status: PresenceStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Points the connection at an application. Calling it again with the same id
   * is a no-op, so a plugin may call it on every settings change.
   */
  async open(clientId: string): Promise<PresenceStatus> {
    const trimmed = String(clientId ?? "").trim();
    if (!/^\d{17,20}$/.test(trimmed)) {
      return this.moveTo({ phase: "off", message: "That is not a Discord application id." });
    }
    if (this.wanted && this.clientId === trimmed && this.status.phase === "connected") return this.status;

    if (this.clientId !== trimmed) this.dropSocket();
    this.clientId = trimmed;
    this.wanted = true;
    return this.dial();
  }

  /** Stops updating the presence and lets Discord clear it. */
  close(): PresenceStatus {
    this.wanted = false;
    this.desired = undefined;
    this.requested = false;
    this.dropSocket();
    return this.moveTo({ phase: "off" });
  }

  /** Passing nothing clears the presence without dropping the connection. */
  update(activity: PresenceActivity | undefined): PresenceStatus {
    this.desired = activity;
    this.requested = true;
    this.flush();
    return this.status;
  }

  private async dial(): Promise<PresenceStatus> {
    if (this.socket) return this.status;
    this.moveTo({ phase: "connecting" });

    for (const candidate of socketCandidates()) {
      if (!this.wanted) return this.status;
      let socket: PresenceSocket;
      try {
        socket = await this.connect(candidate);
      } catch {
        continue;
      }

      this.attach(socket);
      try {
        socket.write(encodeFrame(OPCODE.handshake, { v: 1, client_id: this.clientId }));
      } catch (error) {
        logger.error("Discord accepted the socket but refused the handshake.", error);
        this.dropSocket();
        continue;
      }

      // READY arrives asynchronously, so `connecting` stands until it does —
      // but a socket that accepts the handshake and then says nothing would
      // leave it standing forever, which is what this deadline is for.
      this.handshakeTimer = setTimeout(() => {
        this.handshakeTimer = undefined;
        if (this.status.phase === "connected") return;
        this.dropSocket();
        this.retryLater("Discord accepted the connection but never became ready.");
      }, HANDSHAKE_TIMEOUT_MS);
      this.handshakeTimer.unref?.();
      return this.status;
    }

    return this.retryLater("Discord is not running, or is not signed in.");
  }

  private attach(socket: PresenceSocket): void {
    this.socket = socket;
    this.reader = new FrameReader();

    socket.on("data", (chunk) => {
      let frames: readonly DecodedFrame[];
      try {
        frames = this.reader.push(chunk);
      } catch (error) {
        logger.error("Dropping the Discord connection after an unreadable frame.", error);
        this.dropSocket();
        this.retryLater("Discord sent something unreadable.");
        return;
      }
      for (const frame of frames) this.receive(frame);
    });

    // Both compare identity rather than truthiness, so a late event from a
    // socket already replaced cannot tear down its successor.
    socket.on("error", () => {
      // A pipe that dies mid-session is ordinary: Discord was closed.
      if (this.socket !== socket) return;
      this.dropSocket();
      if (this.wanted) this.retryLater("Discord closed the connection.");
    });

    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.dropSocket();
      if (this.wanted) this.retryLater("Discord closed the connection.");
    });
  }

  private receive(frame: DecodedFrame): void {
    if (frame.opcode === OPCODE.ping) {
      this.send(OPCODE.pong, frame.payload);
      return;
    }

    if (frame.opcode === OPCODE.close) {
      const message = typeof frame.payload["message"] === "string" ? frame.payload["message"] : undefined;
      this.dropSocket();
      // Discord closes with a reason when it rejects the application id, and
      // retrying with the same id would only be refused again.
      this.moveTo({ phase: "unavailable", message: message ?? "Discord refused the connection." });
      return;
    }

    if (frame.opcode !== OPCODE.frame) return;
    if (frame.payload["evt"] !== "READY") return;

    const data = frame.payload["data"];
    const user = typeof data === "object" && data !== null ? (data as Record<string, unknown>)["user"] : undefined;
    const username =
      typeof user === "object" && user !== null ? String((user as Record<string, unknown>)["username"] ?? "") : "";

    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
    }
    this.retryDelay = RETRY_MIN_MS;
    this.moveTo(username ? { phase: "connected", user: username } : { phase: "connected" });
    // The activity chosen while the socket was down is sent now, unthrottled:
    // the floor exists to space out updates, not to delay the first one.
    this.sentAt = 0;
    this.flush();
  }

  /**
   * Sends the desired activity, spacing updates out. A change inside the window
   * schedules a trailing send rather than being dropped, so the last state a
   * plugin asked for is always the one Discord ends up showing.
   */
  private flush(): void {
    if (this.status.phase !== "connected" || !this.socket) return;
    // Connecting without an activity should leave Discord alone rather than
    // announce an empty presence.
    if (!this.requested) return;

    const waited = Date.now() - this.sentAt;
    if (waited < MIN_UPDATE_INTERVAL_MS) {
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = undefined;
          this.flush();
        }, MIN_UPDATE_INTERVAL_MS - waited);
      }
      return;
    }

    this.sentAt = Date.now();
    this.nonce += 1;
    this.send(OPCODE.frame, {
      cmd: "SET_ACTIVITY",
      // Discord ties the presence to a process so it can drop it if we vanish.
      args: { pid: process.pid, activity: this.desired ? toWireActivity(this.desired) : undefined },
      nonce: `bettergravity-${this.nonce}`
    });
  }

  private send(opcode: number, payload: unknown): void {
    if (!this.socket) return;
    try {
      this.socket.write(encodeFrame(opcode, payload));
    } catch (error) {
      logger.error("Could not write to Discord.", error);
      this.dropSocket();
      if (this.wanted) this.retryLater("Discord stopped accepting writes.");
    }
  }

  private retryLater(message: string): PresenceStatus {
    if (!this.wanted) return this.status;
    if (!this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        void this.dial();
      }, this.retryDelay);
      this.retryTimer.unref?.();
      this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
    }
    return this.moveTo({ phase: "unavailable", message });
  }

  private dropSocket(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
    }
    try {
      socket?.destroy();
    } catch {
      // Already gone, which is the outcome being asked for.
    }
  }

  /** Releases timers so a quit is not held open. */
  dispose(): void {
    this.wanted = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.dropSocket();
    this.listeners.clear();
  }

  private moveTo(status: PresenceStatus): PresenceStatus {
    const unchanged =
      this.status.phase === status.phase &&
      this.status.user === status.user &&
      this.status.message === status.message;
    this.status = status;
    if (unchanged) return status;

    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        logger.error("A presence listener threw.", error);
      }
    }
    return status;
  }
}
