import { describe, expect, it } from "vitest";
import {
  CCPA_HOST,
  GOOGLE_BASE,
  MODEL_VERSION,
  ModelRegistry,
  PUBLIC_MODELS_TTL_MS,
  applyThinkingConfig,
  bestPublicModel,
  consolidate,
  filterHeaders,
  nameFromDisplay,
  neutralizeQuota,
  parseBaseUrl,
  parseFamily,
  pickThinkingLevel,
  publicModelNames,
  readChatRequest,
  readEventData,
  splitEvents,
  versionFor,
  wrapEvent
} from "../src/main/gemini/translate.js";

const GEMINI = "API_PROVIDER_GOOGLE_GEMINI";

/** One catalog entry, keyed by alias the way Antigravity sends it. */
function entry(
  alias: string,
  modelEnum: string,
  displayName: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { [alias]: { model: modelEnum, displayName, apiProvider: GEMINI, ...extra } };
}

function registryWith(models: Record<string, unknown>, available: readonly string[] = []): ModelRegistry {
  const registry = new ModelRegistry();
  if (available.length > 0) registry.rememberPublicModels(available);
  registry.updateFromCatalog(JSON.stringify({ models }));
  return registry;
}

const events = (body: string): readonly Record<string, unknown>[] =>
  splitEvents(Buffer.from(body)).events.flatMap((event) => [...readEventData(event)]);

describe("naming the model", () => {
  it("answers from the static map until a catalog arrives", () => {
    const registry = new ModelRegistry();
    expect(registry.resolve("MODEL_PLACEHOLDER_M16")).toEqual({
      model: "gemini-3.1-pro-preview",
      thinkingLevel: "high",
      thinkingBudget: null
    });
    // The two the agent fires before anything is warm.
    expect(registry.resolve("MODEL_PLACEHOLDER_M15")?.model).toBe("gemini-3.5-flash");
    expect(registry.resolve("MODEL_PLACEHOLDER_M84")?.model).toBe("gemini-3.5-flash");
    expect(registry.resolve("MODEL_PLACEHOLDER_M318")).toEqual({
      model: "gemini-3.8-flash",
      thinkingLevel: "high",
      thinkingBudget: null
    });
    expect(registry.resolve("MODEL_PLACEHOLDER_M298")).toEqual({
      model: "gemini-3.7-flash",
      thinkingLevel: "high",
      thinkingBudget: null
    });
    expect(registry.resolve("MODEL_SOMETHING_ELSE")).toBeUndefined();
  });

  it("prefers the live catalog to the static map", () => {
    const registry = registryWith(
      entry("gemini-3-flash-agent", "MODEL_PLACEHOLDER_M84", "Gemini 3.6 Flash (Low)"),
      ["gemini-3.6-flash"]
    );
    expect(registry.resolve("MODEL_PLACEHOLDER_M84")).toEqual({
      model: "gemini-3.6-flash",
      thinkingLevel: "low",
      thinkingBudget: null
    });
  });

  it("leaves another provider's model to the subscription, static map or not", () => {
    const registry = registryWith({
      "claude-sonnet": {
        model: "MODEL_PLACEHOLDER_M16",
        displayName: "Claude Sonnet 4.5",
        apiProvider: "API_PROVIDER_VERTEX_ANTHROPIC"
      }
    });
    expect(registry.resolve("MODEL_PLACEHOLDER_M16")).toBeUndefined();
  });

  it("skips the models that do not answer a chat request", () => {
    const registry = registryWith({
      ...entry("gemini-3-image", "MODEL_PLACEHOLDER_M99", "Gemini 3 Pro Image"),
      ...entry("tab_completion", "MODEL_PLACEHOLDER_M98", "Tab Completion")
    });
    expect(registry.resolve("MODEL_PLACEHOLDER_M99")).toBeUndefined();
    expect(registry.resolve("MODEL_PLACEHOLDER_M98")).toBeUndefined();
  });
});

describe("which field states the version", () => {
  it("believes the enum for the 2.5 family, whose label is wrong", () => {
    // Three distinct models share the label "Gemini 3.1 Flash Lite"; the enum
    // is the only field that says 2.5.
    expect(versionFor("gemini-2.5-flash", "Gemini 3.1 Flash Lite", "MODEL_GOOGLE_GEMINI_2_5_FLASH")).toBe("2.5");
  });

  it("believes the label for a placeholder enum, whose alias lags", () => {
    expect(versionFor("gemini-3-flash-agent", "Gemini 3.5 Flash (High)", "MODEL_PLACEHOLDER_M84")).toBe("3.5");
    // No version in the alias at all, so the label is all there is.
    expect(versionFor("gemini-pro-agent", "Gemini 3.1 Pro (High)", "MODEL_PLACEHOLDER_M16")).toBe("3.1");
  });

  it("reads the family from the alias, and the label only when it has to", () => {
    expect(parseFamily("gemini-3-flash-agent", "Gemini 3.5 Flash (High)")).toEqual({ version: "3.5", family: "flash" });
    expect(parseFamily("some-internal-name", "Gemini 3.1 Flash Lite")).toEqual({
      version: "3.1",
      family: "flash-lite"
    });
    expect(parseFamily("gemini-embedding-001", "Gemini Embedding")).toBeUndefined();
  });
});

describe("naming from display label", () => {
  it("resolves dynamic flash versions", () => {
    expect(nameFromDisplay("Gemini 3.8 Flash (High)")?.model).toBe("gemini-3.8-flash");
    expect(nameFromDisplay("Gemini 3.7 Flash")?.model).toBe("gemini-3.7-flash");
    expect(nameFromDisplay("Gemini 3.6 Flash")?.model).toBe("gemini-3.6-flash");
    expect(nameFromDisplay("Gemini 3.5 Flash")?.model).toBe("gemini-3.5-flash");
    expect(nameFromDisplay("Flash")?.model).toBe("gemini-3.5-flash");
  });

  it("resolves dynamic flash-lite and pro versions", () => {
    expect(nameFromDisplay("Gemini 3.1 Flash Lite")?.model).toBe("gemini-3.1-flash-lite");
    expect(nameFromDisplay("Gemini 3.5 Pro")?.model).toBe("gemini-3.5-pro");
    expect(nameFromDisplay("Gemini 3.1 Pro (High)")?.model).toBe("gemini-3.1-pro-preview");
    expect(nameFromDisplay("Pro")?.model).toBe("gemini-3.1-pro-preview");
  });
});

describe("choosing from what the key serves", () => {
  const available = new Set([
    "gemini-3.5-flash",
    "gemini-3.5-flash-preview-11-2026",
    "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-image",
    "embedding-001"
  ]);

  it("takes the stable id over a dated preview of the same version", () => {
    expect(bestPublicModel("3.5", "flash", available)).toEqual({ id: "gemini-3.5-flash", downgraded: false });
  });

  it("does not let flash-lite answer for flash, or the reverse", () => {
    expect(bestPublicModel("3.1", "flash-lite", available)?.id).toBe("gemini-3.1-flash-lite");
    // 3.1 Flash Lite is on offer, but it is not a Flash — so there is no 3.1
    // Flash here and nothing older to step down to either.
    expect(bestPublicModel("3.1", "flash", available)).toBeUndefined();
    expect(bestPublicModel("3.5", "flash-lite", available)).toEqual({
      id: "gemini-3.1-flash-lite",
      downgraded: true
    });
  });

  it("steps down to the nearest older version rather than giving up", () => {
    // 3.9 Pro is not out; billing the user's key for 3.1 Pro beats falling back
    // to the subscription, and the caller is told it was a downgrade.
    expect(bestPublicModel("3.9", "pro", available)).toEqual({ id: "gemini-3.1-pro-preview", downgraded: true });
  });

  it("has nothing to offer when the family is absent or unknown", () => {
    expect(bestPublicModel("3.5", "flash", new Set())).toBeUndefined();
    expect(bestPublicModel(undefined, "flash", available)).toBeUndefined();
    expect(bestPublicModel("1.0", "pro", available)).toBeUndefined();
  });
});

describe("the 2.5 family, which counts tokens instead", () => {
  it("trusts the alias when the key really serves it", () => {
    const registry = registryWith(
      entry("gemini-2.5-flash", "MODEL_GOOGLE_GEMINI_2_5_FLASH", "Gemini 3.1 Flash Lite", {
        thinkingBudget: 8000
      }),
      ["gemini-2.5-flash"]
    );
    expect(registry.resolve("MODEL_GOOGLE_GEMINI_2_5_FLASH")).toEqual({
      model: "gemini-2.5-flash",
      thinkingLevel: null,
      thinkingBudget: 8000
    });
  });

  it("replaces an alias the key has never heard of", () => {
    // `gemini-2.5-flash-thinking` is Antigravity's own name and answers 400.
    const registry = registryWith(
      entry("gemini-2.5-flash-thinking", "MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING", "Gemini 3.1 Flash Lite", {
        thinkingBudget: -1
      }),
      ["gemini-2.5-flash"]
    );
    expect(registry.resolve("MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING")).toEqual({
      model: "gemini-2.5-flash",
      thinkingLevel: null,
      // A dynamic budget is not a number the 2.5 endpoint takes.
      thinkingBudget: 0
    });
  });
});

describe("how much thinking to ask for", () => {
  it("takes the label at its word when it states a depth", () => {
    expect(pickThinkingLevel("Gemini 3.1 Pro (High)", 0, true, "gemini-3.1-pro-preview")).toBe("high");
    expect(pickThinkingLevel("Gemini 3.5 Flash (Medium)", null, true, "gemini-3.5-flash")).toBe("medium");
    expect(pickThinkingLevel("Gemini 3.5 Flash (Low)", 100_000, true, "gemini-3.5-flash")).toBe("low");
  });

  it("reads the budget when the label says nothing", () => {
    expect(pickThinkingLevel("Gemini 3.5 Flash", 0, true, "gemini-3.5-flash")).toBe("minimal");
    expect(pickThinkingLevel("Gemini 3.5 Flash", 4_999, true, "gemini-3.5-flash")).toBe("low");
    expect(pickThinkingLevel("Gemini 3.5 Flash", 20_000, true, "gemini-3.5-flash")).toBe("medium");
    expect(pickThinkingLevel("Gemini 3.5 Flash", 80_000, true, "gemini-3.5-flash")).toBe("high");
    // -1 is a dynamic budget, so the model decides — effectively high.
    expect(pickThinkingLevel("Gemini 3.5 Flash", -1, true, "gemini-3.5-flash")).toBe("high");
    expect(pickThinkingLevel("Gemini 3.1 Flash Lite", null, false, "gemini-3.1-flash-lite")).toBe("minimal");
  });

  it("never asks Pro for minimal, which it does not accept", () => {
    expect(pickThinkingLevel("Gemini 3.1 Pro", 0, true, "gemini-3.1-pro-preview")).toBe("low");
  });
});

describe("the request going out", () => {
  it("unwraps the envelope and keeps the enum the picker chose", () => {
    const body = JSON.stringify({
      request: {
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        labels: { model_enum: "MODEL_PLACEHOLDER_M84" },
        sessionId: "abc"
      },
      model: "gemini-3-flash-agent"
    });
    const read = readChatRequest(body);
    expect(read?.sourceEnum).toBe("MODEL_PLACEHOLDER_M84");
    // Fields the public API would reject are gone; the rest is untouched.
    expect(read?.inner).toEqual({ contents: [{ role: "user", parts: [{ text: "hello" }] }] });
    expect(readChatRequest("{ not json")).toBeUndefined();
  });

  it("sets one thinking dial and clears the other", () => {
    const inner: Record<string, unknown> = {
      generationConfig: { temperature: 0.4, thinkingConfig: { thinkingBudget: 8000 } }
    };
    applyThinkingConfig(inner, { model: "gemini-3.5-flash", thinkingLevel: "medium", thinkingBudget: null }, false);
    expect(inner["generationConfig"]).toEqual({
      temperature: 0.4,
      thinkingConfig: { thinkingLevel: "medium", includeThoughts: false }
    });

    applyThinkingConfig(inner, { model: "gemini-2.5-flash", thinkingLevel: null, thinkingBudget: 0 }, true);
    expect(inner["generationConfig"]).toEqual({
      temperature: 0.4,
      thinkingConfig: { thinkingBudget: 0, includeThoughts: true }
    });
  });
});

describe("reading the stream", () => {
  it("splits on either delimiter and keeps what is incomplete", () => {
    const scan = splitEvents(Buffer.from('data: {"a":1}\r\n\r\ndata: {"b":2}\n\ndata: {"c'));
    expect(scan.events).toEqual(['data: {"a":1}', 'data: {"b":2}']);
    expect(scan.rest.toString()).toBe('data: {"c');
  });

  it("ignores keep-alive blanks and anything that is not JSON", () => {
    expect(splitEvents(Buffer.from("\n\n\r\n\r\n")).events).toEqual([]);
    expect(readEventData(": ping\ndata: not json\ndata: {\"ok\":true}")).toEqual([{ ok: true }]);
  });
});

/** One chunk as the public API sends it, before the role has been set. */
const openingChunk = (): Record<string, unknown> => ({
  candidates: [{ index: 0, content: { parts: [{ text: "weighing it up" }] } }]
});

const answerChunk = (): Record<string, unknown> => ({
  candidates: [{ index: 0, content: { role: "model", parts: [{ text: "the answer" }] } }],
  usageMetadata: { promptTokenCount: 9, totalTokenCount: 20, trafficType: "ON_DEMAND" },
  responseId: "resp-1"
});

const unwrap = (event: string): Record<string, unknown> =>
  JSON.parse(event.replace(/^data: /, "").trimEnd()) as Record<string, unknown>;

describe("re-wrapping a streamed event", () => {
  it("hands the editor an envelope with the trace id it correlates on", () => {
    const wrapped = unwrap(wrapEvent(answerChunk(), "beefcafe", false));
    expect(wrapped["traceId"]).toBe("beefcafe");
    expect(wrapped["metadata"]).toEqual({});
    const response = wrapped["response"] as Record<string, unknown>;
    expect(response["modelVersion"]).toBe(MODEL_VERSION);
    // Cloud Code does not number candidates, and carries only its own counts.
    expect(response["candidates"]).toEqual([{ content: { role: "model", parts: [{ text: "the answer" }] } }]);
    expect(response["usageMetadata"]).toEqual({ promptTokenCount: 9, totalTokenCount: 20 });
  });

  it("flags text that arrives before the role as thinking, then drops it", () => {
    const kept = unwrap(wrapEvent(openingChunk(), "trace", true));
    expect((kept["response"] as Record<string, unknown>)["candidates"]).toEqual([
      { content: { role: "model", parts: [{ text: "weighing it up", thought: true }] } }
    ]);
    // With thoughts off the part goes entirely, and an empty candidate keeps no
    // content at all rather than an empty one.
    const dropped = unwrap(wrapEvent(openingChunk(), "trace", false));
    expect((dropped["response"] as Record<string, unknown>)["candidates"]).toEqual([{}]);
  });

  it("keeps a real thought signature and gives a finished candidate empty text", () => {
    const event = wrapEvent(
      {
        candidates: [
          { index: 0, finishReason: "STOP", content: { role: "model", parts: [{ thoughtSignature: "AbCd" }] } }
        ]
      },
      "trace",
      false
    );
    expect((unwrap(event)["response"] as Record<string, unknown>)["candidates"]).toEqual([
      { finishReason: "STOP", content: { role: "model", parts: [{ thoughtSignature: "AbCd" }] } }
    ]);

    const bare = wrapEvent({ candidates: [{ index: 0, finishReason: "STOP" }] }, "trace", false);
    expect((unwrap(bare)["response"] as Record<string, unknown>)["candidates"]).toEqual([
      { finishReason: "STOP", content: { role: "model", parts: [{ text: "" }] } }
    ]);
  });
});

describe("consolidating a whole response instead", () => {
  const upstream = [
    'data: {"candidates":[{"content":{"parts":[{"text":"thinking "}]}}]}',
    'data: {"candidates":[{"content":{"parts":[{"text":"out loud"}]}}]}',
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}],"usageMetadata":{"promptTokenCount":4},"responseId":"r-9"}',
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":", world","thoughtSignature":"SIG"}]}}],"usageMetadata":{"promptTokenCount":4,"totalTokenCount":11,"cachedContentTokenCount":2}}',
    'data: {"candidates":[{"finishReason":"STOP","content":{"role":"model","parts":[{"text":""}]}}],"usageMetadata":{"promptTokenCount":4,"totalTokenCount":11}}'
  ].join("\r\n\r\n");

  it("emits the answer and then a terminator, both under one trace id", () => {
    const result = consolidate(events(`${upstream}\r\n\r\n`), "onetrace", false);
    const wrapped = splitEvents(Buffer.from(result.body)).events.map(unwrap);
    expect(wrapped).toHaveLength(2);
    expect(wrapped.every((event) => event["traceId"] === "onetrace")).toBe(true);

    const answer = wrapped[0]?.["response"] as Record<string, unknown>;
    expect(answer["candidates"]).toEqual([
      { content: { role: "model", parts: [{ text: "Hello, world", thoughtSignature: "SIG" }] } }
    ]);
    // The four counts Cloud Code carries, and not the fifth.
    expect(answer["usageMetadata"]).toEqual({ promptTokenCount: 4, totalTokenCount: 11 });
    expect(answer["responseId"]).toBe("r-9");

    const terminator = wrapped[1]?.["response"] as Record<string, unknown>;
    expect(terminator["candidates"]).toEqual([
      { content: { role: "model", parts: [{ text: "" }] }, finishReason: "STOP" }
    ]);
    expect(result).toMatchObject({ textLength: 12, thoughtLength: 17, actionCount: 0 });
  });

  it("keeps thinking out of the answer unless it was asked for", () => {
    const shown = consolidate(events(`${upstream}\r\n\r\n`), "trace", true);
    const answer = splitEvents(Buffer.from(shown.body)).events.map(unwrap)[0]?.["response"] as Record<string, unknown>;
    expect(answer["candidates"]).toEqual([
      {
        content: {
          role: "model",
          parts: [
            { text: "thinking out loud", thought: true, thoughtSignature: "SIG" },
            { text: "Hello, world" }
          ]
        }
      }
    ]);
  });

  it("puts tool calls first and passes them through whole", () => {
    const body = consolidate(
      events(
        'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"read_file","args":{"path":"a.ts"}},"thoughtSignature":"TOOL"}]}}]}\n\n' +
          'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"totalTokenCount":3}}\n\n'
      ),
      "trace",
      false
    );
    const answer = splitEvents(Buffer.from(body.body)).events.map(unwrap)[0]?.["response"] as Record<string, unknown>;
    expect(answer["candidates"]).toEqual([
      {
        content: {
          role: "model",
          parts: [{ functionCall: { name: "read_file", args: { path: "a.ts" } }, thoughtSignature: "TOOL" }]
        }
      }
    ]);
    expect(body.actionCount).toBe(1);
  });

  it("still terminates a response that said nothing at all", () => {
    const body = consolidate([], "trace", false);
    expect(splitEvents(Buffer.from(body.body)).events).toHaveLength(1);
  });
});

describe("what the key serves", () => {
  it("keeps only the models that can answer a chat request", () => {
    const listed = publicModelNames(
      JSON.stringify({
        models: [
          { name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
          { name: "models/gemini-3.5-flash-image", supportedGenerationMethods: ["predict"] },
          { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
          // No list of methods at all: kept, since nothing says it cannot.
          { name: "models/gemini-4.0-flash" },
          { name: "" }
        ]
      })
    );
    expect(listed).toEqual(["gemini-3.5-flash", "gemini-4.0-flash"]);
    expect(publicModelNames("nonsense")).toEqual([]);
  });

  it("reports new models only once there is something to compare against", () => {
    const registry = new ModelRegistry();
    expect(registry.rememberPublicModels(["gemini-3.5-flash"])).toEqual({ count: 1, added: [] });
    expect(registry.rememberPublicModels(["gemini-3.5-flash", "gemini-3.6-flash"])).toEqual({
      count: 2,
      added: ["gemini-3.6-flash"]
    });
    expect(registry.availableSize).toBe(2);
  });

  it("goes stale after half an hour, so a model released today is picked up", () => {
    const registry = new ModelRegistry();
    expect(registry.publicModelsStale(0)).toBe(true);
    registry.rememberPublicModels(["gemini-3.5-flash"], 1_000);
    expect(registry.publicModelsStale(1_000 + PUBLIC_MODELS_TTL_MS - 1)).toBe(false);
    expect(registry.publicModelsStale(1_000 + PUBLIC_MODELS_TTL_MS)).toBe(true);
  });

  it("keeps the catalog it had when a refresh brings nothing", () => {
    const registry = registryWith(entry("gemini-3-flash-agent", "MODEL_PLACEHOLDER_M84", "Gemini 3.5 Flash (High)"));
    expect(registry.updateFromCatalog("{}")).toBe(0);
    expect(registry.catalogSize).toBe(1);
    expect(registry.resolve("MODEL_PLACEHOLDER_M84")?.model).toBe("gemini-3.5-flash");
  });

  it("says where every catalog entry ends up, in enum order", () => {
    const registry = registryWith(
      {
        ...entry("gemini-3-flash-agent", "MODEL_PLACEHOLDER_M84", "Gemini 3.5 Flash (High)"),
        "claude-sonnet": {
          model: "MODEL_PLACEHOLDER_M40",
          displayName: "Claude Sonnet 4.5",
          apiProvider: "API_PROVIDER_VERTEX_ANTHROPIC"
        }
      },
      ["gemini-3.5-flash"]
    );
    expect(registry.summarize()).toEqual([
      "MODEL_PLACEHOLDER_M40 claude-sonnet (Claude Sonnet 4.5) -> subscription, API_PROVIDER_VERTEX_ANTHROPIC",
      "MODEL_PLACEHOLDER_M84 gemini-3-flash-agent (Gemini 3.5 Flash (High)) -> gemini-3.5-flash level=high"
    ]);
  });

  it("says which lines are a guess, so a stale mapping is visible in the log", () => {
    const registry = registryWith(
      entry("gemini-pro-agent", "MODEL_PLACEHOLDER_M16", "Gemini 4.2 Pro (High)"),
      ["gemini-3.1-pro-preview"]
    );
    expect(registry.summarize()[0]).toContain("-> gemini-3.1-pro-preview level=high (no pro at version 4.2 on this key)");
  });
});

describe("the quota the picker draws", () => {
  it("fills up the Gemini models and leaves every other provider alone", () => {
    const rewritten = neutralizeQuota(
      JSON.stringify({
        models: {
          "gemini-3-flash-agent": { apiProvider: GEMINI, quotaInfo: { remainingFraction: 0 } },
          // No quotaInfo at all, so one has to be put there.
          "gemini-pro-agent": { apiProvider: GEMINI },
          "claude-sonnet": { apiProvider: "API_PROVIDER_VERTEX_ANTHROPIC", quotaInfo: { remainingFraction: 0.25 } }
        }
      })
    );
    const models = (JSON.parse(rewritten ?? "{}") as Record<string, Record<string, Record<string, unknown>>>)[
      "models"
    ];
    expect(models?.["gemini-3-flash-agent"]).toEqual({ apiProvider: GEMINI, quotaInfo: { remainingFraction: 1 } });
    expect(models?.["gemini-pro-agent"]).toEqual({ apiProvider: GEMINI, quotaInfo: { remainingFraction: 1 } });
    // The subscription's own numbers are accurate, so they stand.
    expect(models?.["claude-sonnet"]?.["quotaInfo"]).toEqual({ remainingFraction: 0.25 });
  });

  it("says nothing when there was nothing to change, so the bytes go on untouched", () => {
    expect(
      neutralizeQuota(JSON.stringify({ models: { "gemini-3-flash-agent": { apiProvider: GEMINI, quotaInfo: { remainingFraction: 1 } } } }))
    ).toBeUndefined();
    expect(neutralizeQuota(JSON.stringify({ models: {} }))).toBeUndefined();
    expect(neutralizeQuota("{ not json")).toBeUndefined();
  });
});

describe("which headers travel to the next hop", () => {
  it("drops the ones that describe this connection, and the body it carried", () => {
    const kept = filterHeaders({
      host: CCPA_HOST,
      Connection: "keep-alive",
      "Content-Length": "40",
      "content-encoding": "gzip",
      "Transfer-Encoding": "chunked",
      "Content-Type": "application/json",
      "user-agent": "language_server",
      "x-forwarded-for": ["10.0.0.1", "10.0.0.2"],
      "x-empty": undefined
    });
    expect(kept).toEqual({
      "Content-Type": "application/json",
      "user-agent": "language_server",
      "x-forwarded-for": ["10.0.0.1", "10.0.0.2"]
    });
  });

  it("keeps the editor's credentials for a passthrough and withholds them from the public API", () => {
    const bag = { authorization: "Bearer subscription-token", "X-Goog-Api-Key": "editor", accept: "text/event-stream" };
    expect(Object.keys(filterHeaders(bag))).toEqual(["authorization", "X-Goog-Api-Key", "accept"]);
    // Going out on the user's own key, so the subscription's token must not.
    expect(filterHeaders(bag, true)).toEqual({ accept: "text/event-stream" });
  });
});

describe("reading a base URL", () => {
  it("means Google when it is empty", () => {
    expect(parseBaseUrl("")).toBe(GOOGLE_BASE);
    expect(parseBaseUrl("   ")).toBe(GOOGLE_BASE);
  });

  it("takes an origin apart, trailing slash and all", () => {
    expect(parseBaseUrl(" https://relay.example.test/gemini/ ")).toEqual({
      secure: true,
      host: "relay.example.test",
      port: undefined,
      prefix: "/gemini",
      origin: "https://relay.example.test/gemini",
      problem: undefined
    });
  });

  it("keeps a port, and reports one with nothing under it as no prefix", () => {
    expect(parseBaseUrl("https://relay.example.test:8443")).toMatchObject({ port: 8443, prefix: "" });
    expect(parseBaseUrl("https://relay.example.test:8443/")).toMatchObject({ port: 8443, prefix: "" });
  });

  // A relay on this machine is nobody else's business, so plain http is fine
  // there and nowhere else: off the machine it would put the key on the wire.
  it("allows http for loopback only", () => {
    expect(parseBaseUrl("http://127.0.0.1:8080/v1").problem).toBeUndefined();
    expect(parseBaseUrl("http://localhost:8080")).toMatchObject({ secure: false, host: "localhost" });
    expect(parseBaseUrl("http://[::1]:8080").problem).toBeUndefined();
    expect(parseBaseUrl("http://relay.example.test").problem).toContain("unencrypted");
  });

  it("falls back to Google, saying why, rather than failing", () => {
    for (const bad of ["relay.example.test", "not a url at all", "ftp://relay.example.test", "file:///tmp/relay"]) {
      const target = parseBaseUrl(bad);
      expect(target.host).toBe(GOOGLE_BASE.host);
      expect(target.secure).toBe(true);
      expect(target.problem).toContain("generativelanguage.googleapis.com");
    }
  });
});
