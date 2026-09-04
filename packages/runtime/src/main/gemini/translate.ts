/**
 * Translating between Antigravity's Cloud Code endpoint and the public Gemini
 * API.
 *
 * Everything here is pure: bytes and a registry in, bytes out. The hard parts
 * of this feature are the guesses — which public model an internal enum means,
 * how much thinking to ask for, how a streamed event is re-wrapped — and
 * keeping them in one file means they can be tested without a socket, a
 * certificate, or a running language server. The transport is in `proxy.ts`.
 *
 * The shapes are Google's on both sides. The language server speaks a Cloud
 * Code dialect that wraps an ordinary Gemini request in `{"request": {...}}`
 * and wants `{"response": {...}, "traceId", "metadata"}` back as server-sent
 * events; the public API takes and returns the inner halves. So the work is
 * unwrapping, re-wrapping, and naming the model.
 */

import crypto from "node:crypto";

export const PUBLIC_HOST = "generativelanguage.googleapis.com";
/** The only Cloud Code host Antigravity 2.12.0 talks to. */
export const CCPA_HOST = "daily-cloudcode-pa.googleapis.com";
export const CHAT_PATH_PREFIX = "/v1internal:streamGenerateContent";
export const CATALOG_PATH_PREFIX = "/v1internal:fetchAvailableModels";

/** How Antigravity's own catalog labels a model served by the Gemini API. */
export const GEMINI_PROVIDER = "API_PROVIDER_GOOGLE_GEMINI";

// ── Where the translated requests go ─────────────────────────────────────────

/**
 * Google's public API, or whatever the panel was pointed at instead: a relay of
 * one's own, a gateway a workplace insists on, something listening on this
 * machine. The standard `/v1beta/...` path is appended to `prefix`, so anything
 * that speaks the public Gemini API works without further explanation.
 */
export interface BaseTarget {
  readonly secure: boolean;
  readonly host: string;
  readonly port: number | undefined;
  /** A path the relay lives under, without its trailing slash. Usually empty. */
  readonly prefix: string;
  /** What to print when naming it. */
  readonly origin: string;
  /** Why the text was refused, when it was — in which case this is Google's. */
  readonly problem: string | undefined;
}

export const GOOGLE_BASE: BaseTarget = {
  secure: true,
  host: PUBLIC_HOST,
  port: undefined,
  prefix: "",
  origin: `https://${PUBLIC_HOST}`,
  problem: undefined
};

/** Where an unencrypted address is nobody else's business but this machine's. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Reads what was typed into the panel. Always returns something usable: a base
 * URL that cannot be understood falls back to Google's own and carries the
 * reason, because a typo should cost the user a sentence in the panel rather
 * than their chat.
 */
export function parseBaseUrl(raw: string): BaseTarget {
  const text = raw.trim();
  if (text === "") return GOOGLE_BASE;

  const refused = (problem: string): BaseTarget => ({ ...GOOGLE_BASE, problem });

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return refused(`The base URL is not an address, so requests are going to ${PUBLIC_HOST}.`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return refused(`A base URL has to start with https://, so requests are going to ${PUBLIC_HOST}.`);
  }
  if (url.hostname === "") {
    return refused(`The base URL names no host, so requests are going to ${PUBLIC_HOST}.`);
  }
  // Plain http off this machine would put the key on the wire in clear text.
  if (url.protocol === "http:" && !LOOPBACK.has(url.hostname)) {
    return refused(`http:// would send your key unencrypted, so requests are going to ${PUBLIC_HOST}.`);
  }

  const secure = url.protocol === "https:";
  const port = url.port === "" ? undefined : Number(url.port);
  const prefix = url.pathname.replace(/\/+$/, "");
  return {
    secure,
    host: url.hostname,
    port,
    prefix,
    origin: `${url.protocol}//${url.host}${prefix}`,
    problem: undefined
  };
}

/**
 * The `modelVersion` every wrapped response carries. Cloud Code reports an
 * internal name here rather than a public model id, so this is sent verbatim
 * rather than echoing whichever model actually answered.
 */
export const MODEL_VERSION = "gemini-3-flash-a";

/** Thirty minutes: new models ship on the order of days, not seconds. */
export const PUBLIC_MODELS_TTL_MS = 30 * 60 * 1000;

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

/**
 * What a model enum resolves to. One dial or the other: Gemini 3.x takes a
 * `thinkingLevel`, 2.5 takes a numeric `thinkingBudget`, and sending both is a
 * request error.
 */
export interface Resolution {
  readonly model: string;
  readonly thinkingLevel: ThinkingLevel | null;
  readonly thinkingBudget: number | null;
}

/** One model as Antigravity's catalog describes it, keyed by its enum. */
export interface CatalogModel {
  /** Antigravity's internal name, which is sometimes the public one too. */
  readonly alias: string;
  readonly displayName: string;
  readonly apiProvider: string;
  readonly modelProvider: string;
  readonly thinkingBudget: number | null;
  readonly minThinkingBudget: number | null;
  readonly supportsThinking: boolean;
}

const withLevel = (model: string, thinkingLevel: ThinkingLevel): Resolution => ({
  model,
  thinkingLevel,
  thinkingBudget: null
});

/**
 * The fallback for the moment before Antigravity's catalog arrives. The agent
 * fires its first requests while `fetchAvailableModels` is still in flight, and
 * without these they bill the bundled subscription and rate-limit the account
 * that the user's own key was meant to spare.
 *
 * These enum numbers are not stable across Antigravity versions — they are
 * 2.12.0's. Anything missing or renamed simply falls through to the live
 * catalog, which is why being out of date here costs a few requests and not
 * the feature.
 */
const STATIC_MODELS: Readonly<Record<string, Resolution>> = {
  MODEL_PLACEHOLDER_M16: withLevel("gemini-3.1-pro-preview", "high"),
  MODEL_PLACEHOLDER_M36: withLevel("gemini-3.1-pro-preview", "low"),
  // The two the agent executor starts with, before anything is warm.
  MODEL_PLACEHOLDER_M15: withLevel("gemini-3.5-flash", "high"),
  MODEL_PLACEHOLDER_M84: withLevel("gemini-3.5-flash", "high"),
  MODEL_PLACEHOLDER_M47: withLevel("gemini-3.5-flash", "high"),
  MODEL_PLACEHOLDER_M132: withLevel("gemini-3.5-flash", "high"),
  MODEL_PLACEHOLDER_M133: withLevel("gemini-3.5-flash", "high"),
  MODEL_PLACEHOLDER_M20: withLevel("gemini-3.5-flash", "low"),
  MODEL_PLACEHOLDER_M187: withLevel("gemini-3.5-flash", "minimal"),
  MODEL_PLACEHOLDER_M71: withLevel("gemini-3.6-flash", "high"),
  MODEL_PLACEHOLDER_M72: withLevel("gemini-3.6-flash", "medium"),
  MODEL_PLACEHOLDER_M196: withLevel("gemini-3.6-flash", "high"),
  MODEL_PLACEHOLDER_M264: withLevel("gemini-3.6-flash", "high"),
  MODEL_PLACEHOLDER_M298: withLevel("gemini-3.7-flash", "high"),
  MODEL_PLACEHOLDER_M318: withLevel("gemini-3.8-flash", "high")
};

/** Model ids that do not serve chat the way `streamGenerateContent` needs. */
const SPECIALTY_MARKERS = [
  "-image",
  "-tts",
  "-audio",
  "-live",
  "-computer-use",
  "-embedding",
  "-native-audio",
  "-live-translate",
  "-customtools"
] as const;

/** The same idea applied to a catalog entry's own words rather than an id. */
const NON_CHAT_WORDS = [
  "image",
  "video",
  "audio",
  "tts",
  "embedding",
  "computer use",
  "computer-use",
  "live"
] as const;

export type ModelFamily = "pro" | "flash" | "flash-lite";

export interface FamilyGuess {
  /** `"3.5"`, `"3"`, `"2.5"`; absent when no field states one. */
  readonly version: string | undefined;
  readonly family: ModelFamily;
}

/**
 * The version to trust, which differs by enum shape because the catalog's own
 * fields disagree:
 *
 *   MODEL_PLACEHOLDER_M84   gemini-3-flash-agent   "Gemini 3.5 Flash (High)"
 *   MODEL_GOOGLE_GEMINI_2_5_FLASH   gemini-2.5-flash   "Gemini 3.1 Flash Lite"
 *
 * An alias lags the real version or omits it, so the display name wins for
 * placeholder enums. For the 2.5 family the display name is plainly wrong —
 * three distinct models share one label — while the enum states the version
 * outright, so that wins instead.
 */
export function versionFor(alias: string, display: string, modelEnum: string): string | undefined {
  const number = /(\d+\.\d+|\d+)/;
  if (modelEnum.startsWith("MODEL_GOOGLE_GEMINI_")) {
    const stated = /MODEL_GOOGLE_GEMINI_(\d+)_(\d+)/.exec(modelEnum);
    if (stated) return `${stated[1]}.${stated[2]}`;
    return number.exec(alias)?.[1];
  }
  for (const source of [display, alias]) {
    const found = number.exec(source);
    if (found) return found[1];
  }
  return undefined;
}

/**
 * The version and family Antigravity is asking for, or nothing when the entry
 * is not a chat model at all. The family comes from the alias where it can,
 * because an alias names the family reliably even when its version is stale.
 */
export function parseFamily(alias: string, display: string, modelEnum = ""): FamilyGuess | undefined {
  const text = `${alias} ${display}`.toLowerCase();
  if (NON_CHAT_WORDS.some((word) => text.includes(word))) return undefined;
  // Autocomplete and other internal models are not chat models.
  if (alias.startsWith("tab_") || alias.startsWith("chat_")) return undefined;

  for (const source of [alias.toLowerCase(), display.toLowerCase()]) {
    const version = versionFor(alias, display, modelEnum);
    if (source.includes("flash lite") || source.includes("flash-lite")) {
      return { version, family: "flash-lite" };
    }
    if (source.includes("pro")) return { version, family: "pro" };
    if (source.includes("flash")) return { version, family: "flash" };
  }
  return undefined;
}

/** `"3.5"` → `[3, 5]`, so versions compare the way their numbers read. */
function versionTuple(version: string): readonly number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

/** Element by element, with a missing element ranking below any present one. */
function compareVersions(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

interface Candidate {
  readonly id: string;
  readonly version: readonly number[];
  readonly preview: boolean;
}

/** Ids in this family, exactly: flash-lite is not flash. */
function candidatesFor(family: ModelFamily, available: ReadonlySet<string>): readonly Candidate[] {
  const found: Candidate[] = [];
  for (const id of available) {
    if (!id.startsWith("gemini-")) continue;
    if (SPECIALTY_MARKERS.some((marker) => id.includes(marker))) continue;
    if (family === "flash-lite" && !id.includes("flash-lite")) continue;
    if (family === "flash" && (!id.includes("flash") || id.includes("flash-lite"))) continue;
    if (family === "pro" && !id.includes("pro")) continue;
    const stated = /^gemini-(\d+(?:\.\d+)?)/.exec(id);
    if (!stated) continue;
    found.push({ id, version: versionTuple(stated[1] ?? ""), preview: id.includes("-preview") });
  }
  return found;
}

export interface BestModel {
  readonly id: string;
  /** True when the version asked for was not on offer and an older one is used. */
  readonly downgraded: boolean;
}

/**
 * The best real id for a version and family, out of what the key actually
 * serves. Exact version first, stable before preview; failing that the nearest
 * *lower* version, which keeps a newly announced model billing to the user's
 * key instead of quietly falling back to the subscription — the whole point of
 * the feature. A downgrade is reported so the caller can say so out loud.
 */
export function bestPublicModel(
  version: string | undefined,
  family: ModelFamily | undefined,
  available: ReadonlySet<string>
): BestModel | undefined {
  if (available.size === 0 || !version || !family) return undefined;
  const candidates = candidatesFor(family, available);
  if (candidates.length === 0) return undefined;
  const wanted = versionTuple(version);

  const exact = candidates.filter((candidate) => compareVersions(candidate.version, wanted) === 0);
  if (exact.length > 0) {
    // Stable before preview; the shortest id then wins, so the canonical name
    // beats a dated variant of it.
    exact.sort((left, right) => Number(left.preview) - Number(right.preview) || left.id.length - right.id.length);
    return { id: exact[0]?.id ?? "", downgraded: false };
  }

  const lower = candidates.filter((candidate) => compareVersions(candidate.version, wanted) < 0);
  if (lower.length === 0) return undefined;
  lower.sort((left, right) => compareVersions(right.version, left.version) || Number(left.preview) - Number(right.preview));
  return { id: lower[0]?.id ?? "", downgraded: true };
}

/**
 * How much thinking to ask for. The display name says it outright when
 * Antigravity offers the same model at several depths — "Gemini 3.1 Pro (High)"
 * — and otherwise it is derived from the numeric budget the catalog carries.
 */
export function pickThinkingLevel(
  display: string,
  budget: number | null,
  supportsThinking: boolean,
  apiModel: string
): ThinkingLevel {
  let level: ThinkingLevel;
  if (display.includes("(High)")) level = "high";
  else if (display.includes("(Medium)")) level = "medium";
  else if (display.includes("(Low)")) level = "low";
  else if (budget === 0) level = "minimal";
  else if (!supportsThinking && (budget === null || budget === 0)) level = "minimal";
  // -1 is a dynamic budget, which is effectively high.
  else if (budget === null || budget === -1) level = "high";
  else if (budget < 5000) level = "low";
  else if (budget < 50_000) level = "medium";
  else level = "high";

  // Pro does not accept `minimal`; every Flash variant does.
  return apiModel.includes("-pro") && level === "minimal" ? "low" : level;
}

export interface CatalogPick {
  readonly resolution: Resolution;
  /** Why this id is a guess, when it is one. */
  readonly note: string | undefined;
}

/** Models whose display name says they are not for chat. */
const SPECIALTY_LABELS = ["Image", "Video", "Audio"] as const;

/**
 * What one Gemini-family catalog entry should be translated to, or nothing when
 * it should be left to the subscription.
 */
export function pickFromCatalog(
  modelEnum: string,
  entry: CatalogModel,
  available: ReadonlySet<string>
): CatalogPick | undefined {
  const { alias, displayName: display, thinkingBudget: budget } = entry;
  if (SPECIALTY_LABELS.some((label) => display.includes(label))) return undefined;
  const guess = parseFamily(alias, display, modelEnum);

  // The 2.5 family takes a token budget rather than a level, and its alias is
  // usually the public name already — but not always: the alias of
  // MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING is `gemini-2.5-flash-thinking`,
  // which does not exist publicly and answers 400. So the alias is trusted only
  // when the key really serves it.
  if (modelEnum.startsWith("MODEL_GOOGLE_GEMINI_2_5_")) {
    const budget25 = budget === null || budget === -1 ? 0 : budget;
    const withBudget = (model: string): Resolution => ({ model, thinkingLevel: null, thinkingBudget: budget25 });
    if (available.size === 0 || available.has(alias)) {
      return { resolution: withBudget(alias), note: undefined };
    }
    const best = bestPublicModel(guess?.version, guess?.family, available);
    if (!best) return undefined;
    return { resolution: withBudget(best.id), note: `${alias} is not served by this key` };
  }

  // Resolve against what the key actually serves, so a model released after
  // this was written still routes to the user's key.
  const best = bestPublicModel(guess?.version, guess?.family, available);
  if (best) {
    return {
      resolution: {
        model: best.id,
        thinkingLevel: pickThinkingLevel(display, budget, entry.supportsThinking, best.id),
        thinkingBudget: null
      },
      note: best.downgraded ? `no ${guess?.family ?? "match"} at version ${guess?.version ?? "?"} on this key` : undefined
    };
  }

  const named = nameFromDisplay(display);
  if (!named) return undefined;
  return {
    resolution: {
      model: named.model,
      thinkingLevel: pickThinkingLevel(display, budget, entry.supportsThinking, named.model),
      thinkingBudget: null
    },
    note: named.note
  };
}

/**
 * The last resort: name the target from the display name alone, for a model the
 * key does not list yet. Most specific first, so "3.5 Flash" beats "Flash" and
 * "3.5 Pro" beats a bare "Pro".
 */
export function nameFromDisplay(display: string): { readonly model: string; readonly note: string | undefined } | undefined {
  const text = display.toLowerCase();
  const guessed = (model: string): { model: string; note: string } => ({
    model,
    note: `${display} is not on this key; guessing ${model}`
  });

  const versionMatch = /(\d+\.\d+|\d+)/.exec(text);
  const version = versionMatch ? versionMatch[1] : undefined;

  if (text.includes("flash lite") || text.includes("flash-lite")) {
    return guessed(version ? `gemini-${version}-flash-lite` : "gemini-3.1-flash-lite");
  }

  if (text.includes("flash")) {
    return guessed(version ? `gemini-${version}-flash` : "gemini-3.5-flash");
  }

  if (text.includes("pro")) {
    if (version && version !== "3.1") {
      return guessed(`gemini-${version}-pro`);
    }
    return guessed("gemini-3.1-pro-preview");
  }

  return undefined;
}

// ── Reading what the wire says ───────────────────────────────────────────────
//
// Everything crossing this boundary is somebody else's JSON, so each read is
// narrowed rather than asserted. A malformed body means "no answer", never a
// thrown error: the transport's job is to keep the language server working, and
// passing a request through unchanged is always a safe outcome.

function parseJson(body: string | Buffer): unknown {
  try {
    return JSON.parse(typeof body === "string" ? body : body.toString("utf8"));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Non-empty text, which is what Google's `bool(part["text"])` amounts to. */
function hasText(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

/**
 * The ids the key itself says it serves, from `ListModels`. Anything that
 * cannot answer `generateContent` is dropped, so an embedding model never wins
 * a family match.
 */
export function publicModelNames(body: string | Buffer): readonly string[] {
  const data = asRecord(parseJson(body));
  const names: string[] = [];
  for (const raw of asArray(data?.["models"])) {
    const model = asRecord(raw);
    if (!model) continue;
    const name = asText(model["name"]).replace("models/", "").trim();
    if (name.length === 0) continue;
    const methods = asArray(model["supportedGenerationMethods"]);
    if (methods.length > 0 && !methods.some((method) => asText(method).includes("generateContent"))) continue;
    names.push(name);
  }
  return names;
}

/**
 * Antigravity's catalog, keyed by enum rather than by alias, because the enum is
 * what a chat request carries.
 */
export function catalogModels(body: string | Buffer): ReadonlyMap<string, CatalogModel> {
  const data = asRecord(parseJson(body));
  const models = asRecord(data?.["models"]) ?? {};
  const cache = new Map<string, CatalogModel>();
  for (const [alias, raw] of Object.entries(models)) {
    const info = asRecord(raw);
    if (!info) continue;
    const modelEnum = asText(info["model"]);
    if (modelEnum.length === 0) continue;
    cache.set(modelEnum, {
      alias,
      displayName: asText(info["displayName"]),
      apiProvider: asText(info["apiProvider"]),
      modelProvider: asText(info["modelProvider"]),
      thinkingBudget: asNumber(info["thinkingBudget"]),
      minThinkingBudget: asNumber(info["minThinkingBudget"]),
      supportsThinking: info["supportsThinking"] === true
    });
  }
  return cache;
}

export interface PublicModelUpdate {
  readonly count: number;
  /** Ids that were not there before. Empty on the first fetch, which is not news. */
  readonly added: readonly string[];
}

/**
 * What is known about models, from the two directions it arrives from:
 * Antigravity's catalog says what the editor is offering, and the key's own
 * model list says what can actually be asked for. Resolution is the meeting of
 * the two, so both are kept in one place.
 */
export class ModelRegistry {
  private catalog: ReadonlyMap<string, CatalogModel> = new Map();
  private available: ReadonlySet<string> = new Set();
  /** Zero until the key's model list has been read at least once. */
  private fetchedAt = 0;

  get catalogSize(): number {
    return this.catalog.size;
  }

  get availableSize(): number {
    return this.available.size;
  }

  /**
   * Whether the key's model list is worth re-reading. Antigravity can start
   * offering a model the moment Google ships it, and without a refresh the
   * resolver would keep downgrading it for the rest of the session. A list that
   * has never been read is always worth reading, whatever the clock says.
   */
  publicModelsStale(now = Date.now()): boolean {
    return this.fetchedAt === 0 || now - this.fetchedAt >= PUBLIC_MODELS_TTL_MS;
  }

  rememberPublicModels(ids: readonly string[], now = Date.now()): PublicModelUpdate {
    const before = this.available;
    const next = new Set(ids);
    this.available = next;
    this.fetchedAt = now;
    const added = before.size === 0 ? [] : [...next].filter((id) => !before.has(id)).sort();
    return { count: next.size, added };
  }

  /**
   * Takes the catalog from a `fetchAvailableModels` response. An empty or
   * unreadable body leaves the previous catalog in place — a failed refresh
   * should not cost the mapping that was already working.
   */
  updateFromCatalog(body: string | Buffer): number {
    const next = catalogModels(body);
    if (next.size === 0) return 0;
    this.catalog = next;
    return next.size;
  }

  /**
   * The model to use for one of Antigravity's enums, or nothing at all, which
   * means "leave this request alone". The live catalog decides whenever it has
   * an entry: a non-Gemini provider is deliberately not looked up in the static
   * map, because overriding Claude or GPT with a Gemini model would be a
   * surprise rather than a fallback. Only when the catalog has never been seen
   * does the static map answer, so the first chat after launch still works.
   */
  resolve(modelEnum: string): Resolution | undefined {
    const entry = this.catalog.get(modelEnum);
    if (entry) {
      if (entry.apiProvider !== GEMINI_PROVIDER) return undefined;
      return pickFromCatalog(modelEnum, entry, this.available)?.resolution;
    }
    return STATIC_MODELS[modelEnum];
  }

  /**
   * One line per catalog entry saying where it ends up. Worth logging: a model
   * that quietly falls through to the subscription is otherwise
   * indistinguishable from one that was never offered, and the enum numbers
   * change between Antigravity versions, so the static map goes stale unseen.
   */
  summarize(): readonly string[] {
    const lines: string[] = [];
    for (const [modelEnum, entry] of [...this.catalog].sort(([left], [right]) => left.localeCompare(right))) {
      const label = `${modelEnum} ${entry.alias} (${entry.displayName})`;
      if (entry.apiProvider !== GEMINI_PROVIDER) {
        lines.push(`${label} -> subscription, ${entry.apiProvider || "no provider"}`);
        continue;
      }
      const picked = pickFromCatalog(modelEnum, entry, this.available);
      if (!picked) {
        lines.push(`${label} -> subscription`);
        continue;
      }
      const { model, thinkingLevel, thinkingBudget } = picked.resolution;
      const dial = thinkingLevel !== null ? `level=${thinkingLevel}` : `budget=${thinkingBudget ?? "default"}`;
      lines.push(`${label} -> ${model} ${dial}${picked.note ? ` (${picked.note})` : ""}`);
    }
    return lines;
  }
}

// ── The request going out ────────────────────────────────────────────────────

export interface ChatRequest {
  /** The inner Gemini request, with Antigravity's own fields removed. */
  readonly inner: Record<string, unknown>;
  /** `labels.model_enum`: what the picker chose, kept for the audit line. */
  readonly sourceEnum: string;
}

export function readChatRequest(body: string | Buffer): ChatRequest | undefined {
  const outer = asRecord(parseJson(body));
  if (!outer) return undefined;
  const inner = asRecord(outer["request"]) ?? {};
  const sourceEnum = asText(asRecord(inner["labels"])?.["model_enum"]);
  // Antigravity's own routing fields. The public API rejects a request carrying
  // a field it does not know, so they cannot simply be left in place.
  delete inner["labels"];
  delete inner["sessionId"];
  return { inner, sourceEnum };
}

/**
 * Sets the one thinking dial the chosen model understands and clears the other,
 * because a request carrying both is an error. `includeThoughts` is what decides
 * whether the model's reasoning comes back at all.
 */
export function applyThinkingConfig(
  inner: Record<string, unknown>,
  resolution: Resolution,
  includeThoughts: boolean
): void {
  const generation = asRecord(inner["generationConfig"]) ?? {};
  const thinking = asRecord(generation["thinkingConfig"]) ?? {};
  delete thinking["thinkingLevel"];
  delete thinking["thinkingBudget"];
  if (resolution.thinkingLevel !== null) thinking["thinkingLevel"] = resolution.thinkingLevel;
  if (resolution.thinkingBudget !== null) thinking["thinkingBudget"] = resolution.thinkingBudget;
  thinking["includeThoughts"] = includeThoughts;
  generation["thinkingConfig"] = thinking;
  inner["generationConfig"] = generation;
}

/** Cloud Code uses one id for every chunk of one response, so mint one per call. */
export function newTraceId(): string {
  return crypto.randomBytes(8).toString("hex");
}

// ── The response coming back ─────────────────────────────────────────────────

export interface SseScan {
  readonly events: readonly string[];
  /** What is left after the last complete event, to carry into the next chunk. */
  readonly rest: Buffer;
}

/**
 * Splits off every complete server-sent event. The public API delimits them with
 * CRLF CRLF and the specification allows LF LF, so both are looked for and
 * whichever comes first wins — scanning for one only would hold the whole
 * response in the buffer and lose the token-by-token stream.
 */
export function splitEvents(buffered: Buffer): SseScan {
  const events: string[] = [];
  let rest = buffered;
  for (;;) {
    const crlf = rest.indexOf("\r\n\r\n");
    const lf = rest.indexOf("\n\n");
    let at = -1;
    let width = 0;
    if (crlf >= 0 && (lf < 0 || crlf <= lf)) {
      at = crlf;
      width = 4;
    } else if (lf >= 0) {
      at = lf;
      width = 2;
    }
    if (at < 0) break;
    const event = rest.subarray(0, at).toString("utf8");
    rest = rest.subarray(at + width);
    if (event.trim().length > 0) events.push(event);
  }
  return { events, rest };
}

/** The `data:` payloads of one event. Anything unparseable is skipped, not thrown. */
export function readEventData(event: string): readonly Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = [];
  for (const line of event.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const parsed = asRecord(parseJson(line.slice(6)));
    if (parsed) payloads.push(parsed);
  }
  return payloads;
}

/**
 * Cloud Code carries four token counts on an intermediate chunk and five on the
 * last one. The public API adds fields of its own, so the block is rebuilt from
 * the names Cloud Code uses rather than forwarded.
 */
const STREAM_USAGE_FIELDS = [
  "promptTokenCount",
  "candidatesTokenCount",
  "totalTokenCount",
  "thoughtsTokenCount",
  "cachedContentTokenCount"
] as const;

/** The consolidated path emits one block, which matches the intermediate shape. */
const BUFFERED_USAGE_FIELDS = STREAM_USAGE_FIELDS.slice(0, 4);

function pruneUsage(usage: Record<string, unknown> | undefined, fields: readonly string[]): Record<string, unknown> {
  const pruned: Record<string, unknown> = {};
  if (!usage) return pruned;
  for (const field of fields) if (field in usage) pruned[field] = usage[field];
  return pruned;
}

/**
 * One candidate, in place. Parts that carry nothing the language server reads
 * are dropped, and a candidate left with nothing gets the empty-text shape Cloud
 * Code sends alongside a finish reason rather than an empty content object.
 */
function cleanCandidate(candidate: Record<string, unknown>, hasUsage: boolean, includeThoughts: boolean): void {
  // Cloud Code does not number its candidates; the public API does, and the
  // language server's validator only reads the shape it expects.
  delete candidate["index"];
  const content = asRecord(candidate["content"]) ?? {};
  const hasRole = "role" in content;
  const kept: Record<string, unknown>[] = [];

  for (const raw of asArray(content["parts"])) {
    const part = asRecord(raw);
    if (!part) continue;
    // The public API sends thought text in the chunks before any usage block
    // without flagging it as a thought. Flag it so the editor files it under
    // thinking instead of printing it as the answer.
    if (!hasUsage && !hasRole && hasText(part["text"]) && !part["thought"]) part["thought"] = true;
    if (part["thought"] && !includeThoughts) continue;
    const substantive =
      hasText(part["text"]) ||
      "functionCall" in part ||
      "functionResponse" in part ||
      "thoughtSignature" in part;
    if (substantive) kept.push(part);
  }

  if (kept.length > 0) candidate["content"] = { role: "model", parts: kept };
  else if (candidate["finishReason"]) candidate["content"] = { role: "model", parts: [{ text: "" }] };
  else delete candidate["content"];
}

/**
 * One public-API event, re-wrapped as the Cloud Code event the language server
 * reads. Real `thoughtSignature` values pass through untouched: they are
 * cryptographically checked when they come back on the next turn, so a
 * synthesized one is worse than none at all.
 */
export function wrapEvent(payload: Record<string, unknown>, traceId: string, includeThoughts: boolean): string {
  const hasUsage = "usageMetadata" in payload;
  for (const raw of asArray(payload["candidates"])) {
    const candidate = asRecord(raw);
    if (candidate) cleanCandidate(candidate, hasUsage, includeThoughts);
  }
  payload["usageMetadata"] = pruneUsage(asRecord(payload["usageMetadata"]), STREAM_USAGE_FIELDS);
  payload["modelVersion"] = MODEL_VERSION;
  return `data: ${JSON.stringify({ response: payload, traceId, metadata: {} })}\n\n`;
}

export interface Consolidated {
  /** The whole response body: substantive content, then a terminator. */
  readonly body: string;
  readonly textLength: number;
  readonly thoughtLength: number;
  readonly actionCount: number;
}

/**
 * The buffered alternative to streaming: every event read, then two events
 * written — one carrying the answer, one carrying the finish reason. Slower to
 * appear on screen, but the editor sees a single complete message, which is the
 * safer shape when a stream is being awkward.
 */
export function consolidate(
  payloads: readonly Record<string, unknown>[],
  traceId: string,
  includeThoughts: boolean
): Consolidated {
  const thoughts: string[] = [];
  const spoken: string[] = [];
  const actions: Record<string, unknown>[] = [];
  const signatures: string[] = [];
  let finishReason = "";
  let usage: Record<string, unknown> | undefined;
  let responseId = "";

  for (const payload of payloads) {
    const first = asRecord(asArray(payload["candidates"])[0]);
    const content = asRecord(first?.["content"]);
    const reason = asText(first?.["finishReason"]);
    if (reason.length > 0) finishReason = reason;
    for (const raw of asArray(content?.["parts"])) {
      const part = asRecord(raw);
      if (!part) continue;
      const isAction = "functionCall" in part || "functionResponse" in part;
      if (isAction) {
        // Kept whole, signature included: a tool call is replayed verbatim.
        actions.push(part);
      } else if (hasText(part["text"])) {
        const unflaggedThought = !("usageMetadata" in payload) && !(content && "role" in content);
        (part["thought"] || unflaggedThought ? thoughts : spoken).push(asText(part["text"]));
      }
      // Some chunks carry nothing but a signature — the terminator of a plain
      // text answer, for one — so they are collected separately.
      if (!isAction && hasText(part["thoughtSignature"])) signatures.push(asText(part["thoughtSignature"]));
    }
    const seen = asRecord(payload["usageMetadata"]);
    if (seen && Object.keys(seen).length > 0) usage = seen;
    const seenId = asText(payload["responseId"]);
    if (seenId.length > 0) responseId = seenId;
  }

  const pruned = pruneUsage(usage, BUFFERED_USAGE_FIELDS);
  const parts: Record<string, unknown>[] = [...actions];
  if (includeThoughts && thoughts.length > 0) parts.push({ text: thoughts.join(""), thought: true });
  if (spoken.length > 0) parts.push({ text: spoken.join("") });
  // The last real signature the model emitted, on the first part of what we
  // send. Never a synthesized one: Google rejects those on the next turn.
  const last = signatures[signatures.length - 1];
  const first = parts[0];
  if (last !== undefined && first) parts[0] = { ...first, thoughtSignature: last };

  const envelope = (response: Record<string, unknown>): string =>
    `data: ${JSON.stringify({ response, traceId, metadata: {} })}\n\n`;
  let body = "";
  if (parts.length > 0) {
    body += envelope({
      candidates: [{ content: { role: "model", parts } }],
      usageMetadata: pruned,
      modelVersion: MODEL_VERSION,
      responseId
    });
  }
  body += envelope({
    candidates: [{ content: { role: "model", parts: [{ text: "" }] }, finishReason: finishReason || "STOP" }],
    usageMetadata: pruned,
    modelVersion: MODEL_VERSION,
    responseId
  });

  return {
    body,
    textLength: spoken.join("").length,
    thoughtLength: thoughts.join("").length,
    actionCount: actions.length
  };
}

// ── The catalog on its way back to the editor ────────────────────────────────

/**
 * Marks Gemini models as having full quota left.
 *
 * Antigravity drives the picker's rate-limit icon and its quota banner from each
 * model's `quotaInfo.remainingFraction`, which describes the bundled
 * subscription. A chat on the user's own key does not touch that subscription,
 * so showing those models as exhausted is simply wrong. Everything else is left
 * alone: Claude and the rest really do spend the subscription, and their numbers
 * are accurate.
 *
 * Returns nothing when there was nothing to change, so the original bytes can be
 * forwarded untouched.
 */
export function neutralizeQuota(body: string | Buffer): string | undefined {
  const data = asRecord(parseJson(body));
  const models = asRecord(data?.["models"]);
  if (!data || !models) return undefined;
  let changed = 0;
  for (const raw of Object.values(models)) {
    const info = asRecord(raw);
    if (!info || info["apiProvider"] !== GEMINI_PROVIDER) continue;
    const quota = asRecord(info["quotaInfo"]) ?? {};
    info["quotaInfo"] = quota;
    if (quota["remainingFraction"] === 1) continue;
    quota["remainingFraction"] = 1;
    changed += 1;
  }
  return changed > 0 ? JSON.stringify(data) : undefined;
}

// ── Headers ──────────────────────────────────────────────────────────────────

export type HeaderBag = Readonly<Record<string, string | string[] | undefined>>;

/**
 * Headers that describe one hop rather than the message, and so must not be
 * copied onto the next one. `content-length` and `content-encoding` are in here
 * too: the body being forwarded is not always the body that arrived.
 */
export const HOP_BY_HOP: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "content-encoding"
]);

export function filterHeaders(headers: HeaderBag, dropAuth = false): Record<string, string | string[]> {
  const kept: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (dropAuth && (lower === "authorization" || lower === "x-goog-api-key")) continue;
    kept[name] = value;
  }
  return kept;
}
