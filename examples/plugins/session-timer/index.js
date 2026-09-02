// Session Timer — a reference plugin covering the whole BetterGravity surface:
// settings, storage, styles, DOM work, and cleanup.
//
// Copy this folder into %APPDATA%\BetterGravity\plugins\ and turn on developer
// mode to run it.

// define() returns a live, typed view of the options. Reading a property gives
// the current value; assigning to one saves it.
const settings = plugin.settings.define({
  corner: {
    type: "select",
    label: "Corner",
    description: "Where the timer sits on screen.",
    default: "bottom-right",
    options: [
      { value: "bottom-right", label: "Bottom right" },
      { value: "bottom-left", label: "Bottom left" },
      { value: "top-right", label: "Top right" }
    ]
  },
  showSeconds: {
    type: "boolean",
    label: "Show seconds",
    description: "Include seconds in the readout.",
    default: false
  }
});

/** @type {Record<string, string>} */
const CORNERS = {
  "bottom-right": "bottom: 14px; right: 14px;",
  "bottom-left": "bottom: 14px; left: 14px;",
  "top-right": "top: 42px; right: 14px;"
};

// Antigravity does not render pseudo-elements on the html element, so the badge
// is a real node appended to the body.
const badge = document.createElement("div");
badge.className = "bettergravity-session-timer";
document.body.appendChild(badge);
plugin.onDispose(() => badge.remove());

plugin.styles.add(`
  .bettergravity-session-timer {
    position: fixed;
    z-index: 2147483000;
    padding: 6px 12px;
    border-radius: 999px;
    font: 500 12px/1 system-ui, sans-serif;
    color: #f4f4f5;
    background: rgba(24, 24, 27, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(6px);
    pointer-events: none;
  }
`);

// Total time across sessions lives in storage, which persists between restarts.
const previousTotal = plugin.storage.get("totalMinutes", 0);
const startedAt = Date.now();

/** @param {number} elapsedMs */
function format(elapsedMs) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [`${hours}h`, `${minutes}m`];
  if (settings.showSeconds) parts.push(`${totalSeconds % 60}s`);
  return parts.join(" ");
}

function paint() {
  badge.style.cssText = CORNERS[settings.corner] ?? "bottom: 14px; right: 14px;";
  badge.textContent = `Session ${format(Date.now() - startedAt)}`;
}

const ticker = setInterval(() => {
  paint();
  plugin.storage.set("totalMinutes", previousTotal + Math.floor((Date.now() - startedAt) / 60000));
}, 1000);
plugin.onDispose(() => clearInterval(ticker));

// Repaint immediately when the user changes an option in the settings panel.
plugin.onDispose(plugin.settings.onChange(paint));

paint();
plugin.log.info(`started; ${previousTotal} minutes recorded previously`);
