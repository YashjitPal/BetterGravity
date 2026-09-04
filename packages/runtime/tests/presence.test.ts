import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FrameReader,
  PresenceConnection,
  encodeFrame,
  socketCandidates,
  toWireActivity,
  type PresenceSocket
} from "../src/main/presence.js";
import type { PresenceStatus } from "../src/protocol.js";

const HANDSHAKE = 0;
const FRAME = 1;
const CLOSE = 2;
const PING = 3;
const PONG = 4;

/** Stands in for the pipe, so the protocol can be driven frame by frame. */
class FakeSocket implements PresenceSocket {
  readonly sent: Buffer[] = [];
  destroyed = false;
  writeThrows = false;
  private readonly handlers = new Map<string, ((argument: never) => void)[]>();

  write(chunk: Buffer): void {
    if (this.writeThrows) throw new Error("pipe is gone");
    this.sent.push(chunk);
  }

  destroy(): void {
    this.destroyed = true;
    this.emit("close");
  }

  on(event: "data", listener: (chunk: Buffer) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: string, listener: (argument: never) => void): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(listener);
    this.handlers.set(event, existing);
  }

  emit(event: string, argument?: unknown): void {
    for (const listener of [...(this.handlers.get(event) ?? [])]) listener(argument as never);
  }

  /** Everything written so far, decoded. */
  frames(): readonly { opcode: number; payload: Record<string, unknown> }[] {
    return new FrameReader().push(Buffer.concat(this.sent));
  }

  /** Delivers a frame as though Discord had sent it. */
  deliver(opcode: number, payload: unknown): void {
    this.emit("data", encodeFrame(opcode, payload));
  }

  ready(username = "yashjit"): void {
    this.deliver(FRAME, { cmd: "DISPATCH", evt: "READY", data: { user: { username } } });
  }
}

const CLIENT_ID = "123456789012345678";

/** Connects on the first candidate, which is the common case. */
function connectFirst(): { connection: PresenceConnection; sockets: FakeSocket[]; attempts: string[] } {
  const sockets: FakeSocket[] = [];
  const attempts: string[] = [];
  const connection = new PresenceConnection(async (socketPath) => {
    attempts.push(socketPath);
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  return { connection, sockets, attempts };
}

const connections: PresenceConnection[] = [];
const track = (connection: PresenceConnection) => {
  connections.push(connection);
  return connection;
};

afterEach(() => {
  while (connections.length > 0) connections.pop()?.dispose();
  vi.useRealTimers();
});

describe("socket discovery", () => {
  it("uses Discord's named pipes on Windows", () => {
    const paths = socketCandidates("win32", {});
    expect(paths).toHaveLength(10);
    expect(paths[0]).toBe("\\\\?\\pipe\\discord-ipc-0");
    expect(paths[9]).toBe("\\\\?\\pipe\\discord-ipc-9");
  });

  it("looks in the Flatpak and Snap directories as well as the runtime one", () => {
    const paths = socketCandidates("linux", { XDG_RUNTIME_DIR: "/run/user/1000" });
    expect(paths).toContain("/run/user/1000/discord-ipc-0");
    expect(paths).toContain("/run/user/1000/app/com.discordapp.Discord/discord-ipc-0");
    expect(paths).toContain("/run/user/1000/snap.discord/discord-ipc-0");
  });

  it("falls back through the temp directory variables", () => {
    expect(socketCandidates("darwin", { TMPDIR: "/var/tmp" })[0]).toBe("/var/tmp/discord-ipc-0");
    expect(socketCandidates("linux", {})[0]).toBe("/tmp/discord-ipc-0");
  });
});

describe("framing", () => {
  it("writes the opcode and length as little-endian integers", () => {
    const frame = encodeFrame(HANDSHAKE, { v: 1 });
    expect(frame.readInt32LE(0)).toBe(HANDSHAKE);
    expect(frame.readInt32LE(4)).toBe(frame.length - 8);
    expect(JSON.parse(frame.subarray(8).toString("utf8"))).toEqual({ v: 1 });
  });

  it("reassembles a frame split across chunks", () => {
    const reader = new FrameReader();
    const frame = encodeFrame(FRAME, { cmd: "SET_ACTIVITY" });
    expect(reader.push(frame.subarray(0, 5))).toEqual([]);
    expect(reader.push(frame.subarray(5, 11))).toEqual([]);
    const done = reader.push(frame.subarray(11));
    expect(done).toHaveLength(1);
    expect(done[0]?.payload).toEqual({ cmd: "SET_ACTIVITY" });
  });

  it("splits several frames arriving in one chunk", () => {
    const reader = new FrameReader();
    const frames = reader.push(Buffer.concat([encodeFrame(PING, { a: 1 }), encodeFrame(PONG, { b: 2 })]));
    expect(frames.map((frame) => frame.opcode)).toEqual([PING, PONG]);
  });

  it("refuses a length that would allocate the host out of memory", () => {
    const header = Buffer.alloc(8);
    header.writeInt32LE(FRAME, 0);
    header.writeInt32LE(64 * 1024 * 1024, 4);
    expect(() => new FrameReader().push(header)).toThrow(/frame/);
  });

  it("refuses a body that is not JSON", () => {
    const body = Buffer.from("not json", "utf8");
    const header = Buffer.alloc(8);
    header.writeInt32LE(FRAME, 0);
    header.writeInt32LE(body.length, 4);
    expect(() => new FrameReader().push(Buffer.concat([header, body]))).toThrow(/not JSON/);
  });
});

describe("activity mapping", () => {
  it("renames fields to Discord's and rounds timestamps", () => {
    expect(
      toWireActivity({
        details: "Working with the agent",
        state: "Antigravity",
        startedAt: 1700000000123.7,
        largeImage: "antigravity",
        largeText: "Antigravity"
      })
    ).toEqual({
      details: "Working with the agent",
      state: "Antigravity",
      timestamps: { start: 1700000000124 },
      assets: { large_image: "antigravity", large_text: "Antigravity" }
    });
  });

  it("omits empty groups rather than sending them", () => {
    expect(toWireActivity({ details: "Idle" })).toEqual({ details: "Idle" });
  });

  it("maps an activity with nothing in it to no activity at all", () => {
    expect(toWireActivity({})).toBeUndefined();
  });
});

describe("connecting", () => {
  it("rejects something that is not an application id without dialling", async () => {
    const { connection, attempts } = connectFirst();
    track(connection);
    const status = await connection.open("not-an-id");
    expect(status.phase).toBe("off");
    expect(status.message).toMatch(/application id/);
    expect(attempts).toEqual([]);
  });

  it("sends the handshake and reports connected once Discord is ready", async () => {
    const { connection, sockets } = connectFirst();
    track(connection);
    const seen: PresenceStatus[] = [];
    connection.onStatusChanged((status) => void seen.push(status));

    await connection.open(CLIENT_ID);
    const socket = sockets[0]!;
    expect(socket.frames()[0]).toEqual({ opcode: HANDSHAKE, payload: { v: 1, client_id: CLIENT_ID } });
    expect(connection.current().phase).toBe("connecting");

    socket.ready();
    expect(connection.current()).toEqual({ phase: "connected", user: "yashjit" });
    expect(seen.map((status) => status.phase)).toEqual(["connecting", "connected"]);
  });

  it("moves down the candidates until one answers", async () => {
    const attempts: string[] = [];
    const connection = track(
      new PresenceConnection(async (socketPath) => {
        attempts.push(socketPath);
        if (attempts.length < 3) throw new Error("nothing listening");
        return new FakeSocket();
      })
    );

    await connection.open(CLIENT_ID);
    expect(attempts).toHaveLength(3);
    expect(connection.current().phase).toBe("connecting");
  });

  it("reports Discord being closed rather than throwing", async () => {
    const connection = track(
      new PresenceConnection(async () => {
        throw new Error("nothing listening");
      })
    );

    const status = await connection.open(CLIENT_ID);
    expect(status.phase).toBe("unavailable");
    expect(status.message).toMatch(/not running/);
  });

  it("answers Discord's pings so the connection is not reaped", async () => {
    const { connection, sockets } = connectFirst();
    track(connection);
    await connection.open(CLIENT_ID);
    const socket = sockets[0]!;
    socket.ready();

    socket.deliver(PING, { nonce: "abc" });
    const pong = socket.frames().find((frame) => frame.opcode === PONG);
    expect(pong?.payload).toEqual({ nonce: "abc" });
  });

  it("stops rather than retrying when Discord rejects the application", async () => {
    const { connection, sockets } = connectFirst();
    track(connection);
    await connection.open(CLIENT_ID);

    sockets[0]!.deliver(CLOSE, { code: 4000, message: "Invalid client ID" });
    expect(connection.current()).toEqual({ phase: "unavailable", message: "Invalid client ID" });
  });
});

describe("activity updates", () => {
  beforeEach(() => vi.useFakeTimers());

  const setActivityFrames = (socket: FakeSocket) =>
    socket.frames().filter((frame) => frame.payload["cmd"] === "SET_ACTIVITY");

  it("sends the activity chosen before Discord was ready, once it is", async () => {
    const { connection, sockets } = connectFirst();
    track(connection);
    await connection.open(CLIENT_ID);
    const socket = sockets[0]!;

    connection.update({ details: "Idle" });
    expect(setActivityFrames(socket)).toHaveLength(0);

    socket.ready();
    const sent = setActivityFrames(socket);
    expect(sent).toHaveLength(1);
    expect((sent[0]?.payload["args"] as Record<string, unknown>)["activity"]).toEqual({ details: "Idle" });
  });

  it("coalesces updates inside the rate-limit window and sends the last one", async () => {
    const { connection, sockets } = connectFirst();
    track(connection);
    await connection.open(CLIENT_ID);
    const socket = sockets[0]!;
    socket.ready();

    connection.update({ details: "first" });
    connection.update({ details: "second" });
    connection.update({ details: "third" });
    expect(setActivityFrames(socket)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5000);
    const sent = setActivityFrames(socket);
    expect(sent).toHaveLength(2);
    expect((sent[1]?.payload["args"] as Record<string, unknown>)["activity"]).toEqual({ details: "third" });
  });

  it("clears the presence when asked for no activity", async () => {
    const { connection, sockets } = connectFirst();
    track(connection);
    await connection.open(CLIENT_ID);
    const socket = sockets[0]!;
    socket.ready();

    connection.update(undefined);
    const args = setActivityFrames(socket)[0]?.payload["args"] as Record<string, unknown>;
    expect(args["activity"]).toBeUndefined();
    expect(args["pid"]).toBe(process.pid);
  });

  it("goes unavailable when Discord disappears mid-session", async () => {
    const { connection, sockets } = connectFirst();
    track(connection);
    await connection.open(CLIENT_ID);
    const socket = sockets[0]!;
    socket.ready();

    socket.emit("error", new Error("pipe closed"));
    expect(connection.current().phase).toBe("unavailable");
  });

  it("reconnects after Discord comes back, and resends the activity", async () => {
    const sockets: FakeSocket[] = [];
    const connection = track(
      new PresenceConnection(async () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      })
    );

    await connection.open(CLIENT_ID);
    sockets[0]!.ready();
    connection.update({ details: "Working with the agent" });

    sockets[0]!.emit("error", new Error("Discord quit"));
    expect(connection.current().phase).toBe("unavailable");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(2);

    sockets[1]!.ready();
    const resent = setActivityFrames(sockets[1]!);
    expect(resent).toHaveLength(1);
    expect((resent[0]?.payload["args"] as Record<string, unknown>)["activity"]).toEqual({
      details: "Working with the agent"
    });
  });

  it("gives up on a socket that accepts the handshake and never answers", async () => {
    const { connection, sockets } = connectFirst();
    track(connection);
    await connection.open(CLIENT_ID);
    expect(connection.current().phase).toBe("connecting");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(connection.current().phase).toBe("unavailable");
    expect(sockets[0]?.destroyed).toBe(true);
  });

  it("stops updating once closed", async () => {
    const { connection, sockets } = connectFirst();
    track(connection);
    await connection.open(CLIENT_ID);
    const socket = sockets[0]!;
    socket.ready();

    expect(connection.close()).toEqual({ phase: "off" });
    connection.update({ details: "ignored" });
    expect(setActivityFrames(socket)).toHaveLength(0);
    expect(socket.destroyed).toBe(true);
  });
});
