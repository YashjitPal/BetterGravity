// Discord Rich Presence — puts "working" or "idle" on your Discord profile.
//
// Nothing identifying is ever sent. The plugin reads two things from the DOM,
// both of which are only ever present or absent: whether a stop control exists.
// It never reads a project name, a conversation title, a model, or any message
// text, so there is nothing to leak even by accident.
//
// Setup is in docs/presence.md — Discord needs an application of your own,
// because the application is what supplies the name and artwork on your profile.

const settings = plugin.settings.define({
  applicationId: {
    type: "string",
    label: "Discord application ID",
    description: "From discord.com/developers/applications. Presence stays off until this is set.",
    default: "",
    placeholder: "1234567890123456789"
  },
  whenIdle: {
    type: "select",
    label: "When idle",
    description: "Whether to keep showing Antigravity once the agent stops.",
    default: "show",
    options: [
      { value: "show", label: "Show as idle" },
      { value: "hide", label: "Hide the presence" }
    ]
  },
  timer: {
    type: "select",
    label: "Elapsed timer",
    default: "state",
    options: [
      { value: "state", label: "Time in the current state" },
      { value: "session", label: "Time since Antigravity opened" },
      { value: "off", label: "No timer" }
    ]
  },
  artwork: {
    type: "string",
    label: "Artwork key",
    description: "Name of an image uploaded to the application's Rich Presence assets. Leave empty for none.",
    default: "antigravity"
  }
});

// Antigravity swaps the send button for a stop button while the agent runs, and
// a conversation running in the background grows one in the sidebar. Both are
// matched on attributes the app sets deliberately rather than on class names,
// which are Tailwind utilities and shared with hundreds of unrelated elements.
const BUSY_SELECTOR = [
  // The red stop button that replaces send in the open conversation.
  '[data-tooltip-id="input-send-button-cancel-tooltip"]',
  // A conversation executing in the sidebar, which may not be the open one.
  '[aria-label="Stop execution"]'
].join(",");

const SESSION_STARTED_AT = Date.now();

/** Polled rather than observed: a MutationObserver over the whole app fires
 * constantly while the agent streams, and presence cannot update faster than
 * Discord's rate limit anyway, so a cheap query every couple of seconds costs
 * less and reads the same. */
const POLL_INTERVAL_MS = 2000;

let working = false;
let since = SESSION_STARTED_AT;
let connected = false;

function activity() {
  if (!working && settings.whenIdle === "hide") return undefined;

  const startedAt =
    settings.timer === "session" ? SESSION_STARTED_AT : settings.timer === "state" ? since : undefined;

  return {
    details: working ? "Working with the agent" : "Idle",
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(settings.artwork ? { largeImage: settings.artwork, largeText: "Antigravity" } : {})
  };
}

function push() {
  if (!connected) return;
  void plugin.presence.update(activity());
}

function poll() {
  const busy = document.querySelector(BUSY_SELECTOR) !== null;
  if (busy === working) return;
  working = busy;
  since = Date.now();
  push();
}

async function connect() {
  const id = String(settings.applicationId || "").trim();
  if (!id) {
    connected = false;
    await plugin.presence.close();
    return;
  }

  const status = await plugin.presence.open(id);
  // `unavailable` only means Discord is closed; the runtime reconnects on its
  // own and reports `connected` when it returns, so this is not a failure.
  connected = status.phase === "connected" || status.phase === "connecting" || status.phase === "unavailable";
  if (status.phase === "off" && status.message) {
    plugin.ui.toast({ title: "Discord Rich Presence", body: status.message, kind: "error" });
  }
  push();
}

plugin.onDispose(
  plugin.presence.onStatusChanged((status) => {
    plugin.log.info(`Discord ${status.phase}${status.user ? ` as ${status.user}` : ""}${status.message ? `: ${status.message}` : ""}`);
    // The activity has to be re-sent after a reconnect, because Discord drops
    // whatever it was showing when the socket went away.
    if (status.phase === "connected") push();
  })
);

const ticker = setInterval(poll, POLL_INTERVAL_MS);
plugin.onDispose(() => clearInterval(ticker));

plugin.onDispose(
  plugin.settings.onChange((key) => {
    if (key === "applicationId") void connect();
    else push();
  })
);

poll();
void connect();
