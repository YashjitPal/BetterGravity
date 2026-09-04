// Custom Gemini API Key — sends Antigravity's chat through a key of your own.
//
// The work is all in BetterGravity's main process: a loopback HTTPS listener that
// translates between Antigravity's internal protocol and the public Gemini API,
// and a hook that hands the language server that address as it is spawned. This
// plugin is the panel for it — the key and the preferences — because the listener
// has to be up and the endpoint already rewritten before any plugin script exists
// to ask for it.
//
// `"gemini": true` in the manifest is what arms it at launch, from the settings
// saved here last time. The key lives with this plugin's other settings under
// %APPDATA%\BetterGravity, is sent to the address below and nowhere else, and
// never reaches the log or a status — so nothing here can put it in a repository.
//
// There is nothing to press. Switching this plugin on installs the certificate
// the language server needs, and switching it off puts chat back on Antigravity's
// own subscription immediately; the runtime does both by itself. Setup is in
// docs/gemini-key.md, and it is two steps: paste a key, restart.

// The capability behind this arrives with BetterGravity's runtime, not with the
// plugin, and a runtime is only loaded when Antigravity launches. So a plugin
// switched on in a session that started before its runtime did has nothing to
// call. Stand in for it rather than throwing: the settings are still worth saving
// for the next launch, and a plugin that fails to start cannot save anything.
const READY = typeof plugin.gemini === "object" && plugin.gemini !== null;

const OFFLINE_STATUS = {
  phase: "off",
  keyed: false,
  trusted: false,
  restartRequired: true,
  counts: { translated: 0, passedThrough: 0, failed: 0 }
};

const gemini = READY
  ? plugin.gemini
  : {
      status: () => OFFLINE_STATUS,
      configure: async () => OFFLINE_STATUS,
      onStatusChanged: () => () => {}
    };

const settings = plugin.settings.define({
  apiKey: {
    type: "string",
    label: "Gemini API key",
    description: "From aistudio.google.com/apikey. Chat stays on Antigravity's own subscription until this is set.",
    default: "",
    placeholder: "AIza…",
    secret: true
  },
  baseUrl: {
    type: "string",
    label: "Base URL",
    description:
      "Where the key is used. Leave it empty for Google's own API; set it only if you go through something else that speaks the same one.",
    default: "",
    placeholder: "https://generativelanguage.googleapis.com"
  },
  stream: {
    type: "boolean",
    label: "Stream replies",
    description: "Shows the answer as it is written, the way Antigravity does on its own credentials.",
    default: true
  },
  thoughts: {
    type: "boolean",
    label: "Show the model's thinking",
    description: "Passes thinking through to the interface instead of dropping it. Costs nothing extra; it is already generated.",
    default: true
  },
  audit: {
    type: "boolean",
    label: "Keep a request log",
    description: "One line per request under the BetterGravity folder: model, size, and outcome. Never the prompt, never the key.",
    default: false
  }
});

/** Hands the main process the key and the preferences, and arms it if the plugin
 * was switched on after launch rather than before it. */
function push() {
  return gemini.configure({
    apiKey: String(settings.apiKey || "").trim(),
    baseUrl: String(settings.baseUrl || "").trim(),
    stream: settings.stream !== false,
    thoughts: settings.thoughts !== false,
    audit: settings.audit === true
  });
}

// A change deserves saying once, and only once: the counts publish a status per
// request, and a toast each time would be a torrent.
let announced = "";

plugin.onDispose(
  gemini.onStatusChanged((status) => {
    // A status carries a port and a thumbprint, never the key, so this is safe.
    plugin.log.info(`Gemini ${status.phase}${status.message ? `: ${status.message}` : ""}`);

    const worth = status.phase === "blocked" || status.phase === "listening";
    const notice = worth ? status.message : undefined;
    if (!notice || notice === announced) return;
    announced = notice;
    plugin.ui.toast({
      title: "Custom Gemini API Key",
      body: notice,
      kind: status.phase === "blocked" ? "warning" : "info"
    });
  })
);

plugin.onDispose(plugin.settings.onChange(() => void push()));

void push();

// Nothing above will ever publish a status in this case, so the one thing the
// user has to know has to be said here instead.
if (!READY) {
  plugin.ui.toast({
    title: "Custom Gemini API Key",
    body: "Everything here is saved. Restart Antigravity to send its chat through your key.",
    kind: "info"
  });
}
