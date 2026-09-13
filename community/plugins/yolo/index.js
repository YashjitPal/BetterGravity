// YOLO configures Antigravity's executor before a turn reaches the server.
// Field names/numbers are from Antigravity 2.12.2's native protobuf descriptors.
// The same policy is used for protobuf, Connect JSON, and WebSocket requests.
const SERVICE = "/exa.language_server_pb.LanguageServerService/";
const field = (number, name, value) => ({ number, name, value });
const message = (number, name, fields, optional = false, repeated = false) =>
  ({ number, name, fields, optional, repeated });

const CONFIG = [message(1, "plannerConfig", [message(13, "toolConfig", [
  field(46, "autoAllowAllInteractions", true),
  field(53, "autoInteractionBehavior", 1), // AUTO_INTERACTION_BEHAVIOR_ALLOW_ALL
  message(8, "runCommand", [message(3, "autoCommandConfig", [
    field(6, "autoExecutionPolicy", 3) // CASCADE_COMMANDS_AUTO_EXECUTION_EAGER
  ])]),
  message(25, "antigravityBrowser", [
    field(2, "autoRunDecision", 1), // AUTO_RUN_DECISION_USER_ALLOW
    field(8, "browserJsAutoRunPolicy", 3), // BROWSER_JS_AUTO_RUN_POLICY_ENABLED
    field(11, "browserJsExecutionPolicy", 4), // BROWSER_JS_EXECUTION_POLICY_TURBO
    field(25, "skipPermissionChecks", true)
  ]),
  message(33, "notifyUser", [field(1, "artifactReviewMode", 2)]) // ARTIFACT_REVIEW_MODE_TURBO
])])];

const agent = (number, name, repeated = false) =>
  message(number, name, [message(11, "cascadeConfig", CONFIG, true)], true, repeated);
// AgentScriptItem.source is a protobuf oneof. Adding cascadeConfig beside a
// configPath, Python script, or command would replace the selected agent.
const script = (number, name, repeated = false) => message(number, name, [
  message(11, "cascadeConfig", CONFIG, true), agent(7, "config")
], true, repeated);
// An omitted config means the server may reuse its previous one. A new partial
// config would discard that config's model selection and executor settings.
const SEND = [message(5, "cascadeConfig", CONFIG, true), agent(19, "customAgentSpec")];
const METHODS = new Map(Object.entries({
  SendUserCascadeMessage: SEND,
  SendAllQueuedMessages: [message(3, "cascadeConfig", CONFIG, true)],
  RevertToCascadeStep: [message(5, "overrideConfig", CONFIG, true)],
  StartCascade: [script(6, "agentScriptItem"), agent(11, "customAgentSpec")],
  ForkConversation: [script(7, "agentScriptOverride")],
  SetOrVerifyStaticConfig: [agent(2, "customAgentSpec")],
  StartBattleMode: [message(1, "request", SEND, true), message(11, "requests", SEND, true, true), script(6, "agentScripts", true)],
  DetectBattleModeAutoTrigger: [message(3, "userMessage", SEND, true)],
  ReplayGroundTruthTrajectory: [message(4, "cascadeConfig", CONFIG, true)]
}));

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
let disposed = false;
let configured = 0;
let unsupported = 0;

plugin.settings.define({
  status: {
    type: "note",
    label: "Native execution policy",
    read: () => `Allow-all is active for new turns. ${configured} execution request${configured === 1 ? "" : "s"} configured.` +
      (unsupported ? ` ${unsupported} request${unsupported === 1 ? " kept its" : "s kept their"} normal policy because the format was unsupported.` : "")
  }
});

function rulesFor(procedure) {
  return typeof procedure === "string" && procedure.startsWith(SERVICE)
    ? METHODS.get(procedure.slice(SERVICE.length)) : undefined;
}

function isHostUrl(raw, socket = false) {
  const url = new URL(raw);
  if (socket) {
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return false;
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    if (url.pathname !== "/connect-websocket") return false;
  }
  // Never rewrite requests to a website, MCP endpoint, or a remote service.
  return url.origin === location.origin;
}

function patchJson(value, rules) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a protobuf JSON object.");
  let touched = false;
  for (const rule of rules) {
    const snake = rule.name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    const camelPresent = Object.hasOwn(value, rule.name);
    const snakePresent = snake !== rule.name && Object.hasOwn(value, snake);
    if (camelPresent && snakePresent) throw new Error("Duplicate protobuf JSON field.");
    const key = snakePresent ? snake : rule.name;
    if (rule.fields) {
      if (value[key] == null) {
        if (rule.optional || rule.repeated) continue;
        value[key] = {};
      }
      if (rule.repeated) {
        if (!Array.isArray(value[key])) throw new Error("Expected repeated protobuf messages.");
        for (const entry of value[key]) touched = patchJson(entry, rule.fields) || touched;
      } else {
        touched = patchJson(value[key], rule.fields) || touched;
      }
    } else {
      value[key] = rule.value;
      touched = true;
    }
  }
  return touched;
}

function concat(parts) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

function varint(value) {
  const bytes = [];
  do {
    const low = value % 128;
    value = Math.floor(value / 128);
    bytes.push(low | (value ? 128 : 0));
  } while (value);
  return new Uint8Array(bytes);
}

function readVarint(bytes, cursor, small = false) {
  let value = 0;
  for (let index = 0; index < (small ? 5 : 10); index++) {
    if (cursor.offset >= bytes.length) throw new Error("Truncated protobuf varint.");
    const byte = bytes[cursor.offset++];
    if (small) value += (byte & 127) * 2 ** (index * 7);
    if (!(byte & 128)) {
      if ((small && value > 0xffffffff) || (!small && index === 9 && byte > 1)) throw new Error("Invalid protobuf varint.");
      return value;
    }
  }
  throw new Error("Invalid protobuf varint.");
}

function encodedField(rule, bytes) {
  return rule.fields
    ? concat([varint(rule.number * 8 + 2), varint(bytes.length), bytes])
    : concat([varint(rule.number * 8), varint(Number(rule.value))]);
}

function patchProto(bytes, rules) {
  const byNumber = new Map(rules.map(rule => [rule.number, rule]));
  const seen = new Set();
  const parts = [];
  const cursor = { offset: 0 };
  let touched = false;
  while (cursor.offset < bytes.length) {
    const start = cursor.offset;
    const tag = readVarint(bytes, cursor, true);
    const number = Math.floor(tag / 8), wire = tag % 8;
    if (!number) throw new Error("Invalid protobuf tag.");
    let payload = cursor.offset;
    if (wire === 0) readVarint(bytes, cursor);
    else if (wire === 1) cursor.offset += 8;
    else if (wire === 2) {
      const length = readVarint(bytes, cursor, true);
      payload = cursor.offset;
      cursor.offset += length;
    } else if (wire === 5) cursor.offset += 4;
    else throw new Error("Unsupported protobuf wire type.");
    if (cursor.offset > bytes.length) throw new Error("Truncated protobuf field.");
    const rule = byNumber.get(number);
    if (!rule) { parts.push(bytes.subarray(start, cursor.offset)); continue; }
    if (wire !== (rule.fields ? 2 : 0)) throw new Error("Unexpected protobuf field type.");
    seen.add(number);
    if (rule.fields) {
      const next = patchProto(bytes.subarray(payload, cursor.offset), rule.fields);
      parts.push(encodedField(rule, next.bytes));
      touched = next.touched || touched;
    } else {
      parts.push(encodedField(rule));
      touched = true;
    }
  }
  for (const rule of rules) {
    if (seen.has(rule.number) || rule.optional || rule.repeated) continue;
    const next = rule.fields ? patchProto(new Uint8Array(), rule.fields) : undefined;
    parts.push(encodedField(rule, next?.bytes));
    touched = true;
  }
  return { bytes: touched ? concat(parts) : bytes, touched };
}

function patchPayload(bytes, rules, json) {
  if (!json) return patchProto(bytes, rules);
  const value = JSON.parse(decoder.decode(bytes));
  const touched = patchJson(value, rules);
  return { bytes: touched ? encoder.encode(JSON.stringify(value)) : bytes, touched };
}

function patchBody(bytes, rules, type) {
  if (type === "application/json" || type === "application/proto") return patchPayload(bytes, rules, type === "application/json");
  if (!["application/connect+json", "application/connect+proto", "application/grpc-web+json", "application/grpc-web+proto"].includes(type)) {
    throw new Error("Unsupported RPC content type.");
  }
  const parts = [];
  let offset = 0, touched = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 5) throw new Error("Truncated RPC frame.");
    const header = new DataView(bytes.buffer, bytes.byteOffset + offset, 5);
    const flags = header.getUint8(0), length = header.getUint32(1);
    const end = offset + 5 + length;
    if (end > bytes.length || ![0, 2, 128].includes(flags)) throw new Error("Unsupported RPC frame.");
    if (flags) parts.push(bytes.subarray(offset, end));
    else {
      const next = patchPayload(bytes.subarray(offset + 5, end), rules, type.endsWith("+json"));
      const prefix = new Uint8Array(5);
      new DataView(prefix.buffer).setUint32(1, next.bytes.length);
      parts.push(prefix, next.bytes);
      touched = next.touched || touched;
    }
    offset = end;
  }
  return { bytes: touched ? concat(parts) : bytes, touched };
}

plugin.net.onFetch(async (request, next) => {
  if (disposed || request.method !== "POST" || !request.url.includes(SERVICE) || !isHostUrl(request.url)) return next(request);
  const rules = rulesFor(new URL(request.url).pathname);
  if (!rules) return next(request);
  let outgoing = request;
  try {
    const encoding = request.headers.get("content-encoding");
    if (encoding && encoding !== "identity") throw new Error("Compressed RPC request.");
    const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const bytes = new Uint8Array(await request.clone().arrayBuffer());
    if (!disposed) {
      const result = patchBody(bytes, rules, type);
      if (result.touched) {
        const headers = new Headers(request.headers);
        headers.delete("content-length");
        outgoing = new Request(request, { headers, body: result.bytes });
        configured++;
      }
    }
  } catch {
    // Leave the original, unconsumed body intact when a host format changes.
    unsupported++;
  }
  // Do not catch transport errors and accidentally send a user's message twice.
  return next(outgoing);
});

// Patching the prototype also covers sockets opened before YOLO was enabled.
plugin.patcher.before(WebSocket.prototype, "send", context => {
  if (disposed || typeof context.args[0] !== "string" || !isHostUrl(context.self.url, true)) return;
  let envelope;
  try { envelope = JSON.parse(context.args[0]); } catch { return; }
  if (!envelope || envelope.type !== "start") return;
  const rules = rulesFor(envelope.procedure);
  if (!rules) return;
  try {
    if (patchJson(envelope.payload, rules)) {
      context.args[0] = JSON.stringify(envelope);
      configured++;
    }
  } catch { unsupported++; }
});

// Fetch middleware and patches are removed by the plugin host on disposal.
plugin.onDispose(() => { disposed = true; });
