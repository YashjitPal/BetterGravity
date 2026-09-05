// Gemini App — the behaviour. The look is in styles/, declared in plugin.json
// and injected by BetterGravity before this script runs.
//
// CSS can move, hide, and restyle, but it cannot rewrite text, reach for a name,
// or measure a distance that only exists once it happens, so what lives here is
// what needs code. The first of it was the prompt box's model pill: it reads
// "3.1 Pro", not "Gemini 3.1 Pro". The model menu, the aria-label
// that screen readers announce, and every other place a model is named keep
// the full name.
//
// The rule for Gemini models is Willow's (features/code/src/workbench/
// model-labels.ts): drop the word "Gemini" and whatever follows it stays. It is
// a rule, not a list, so "Gemini 4 Pro" will read "4 Pro" the day it appears.
// Other vendors' models are listed by hand below; Antigravity adds those rarely.

// ---------------------------------------------------------------------------
// Workspace Theme & Colors — Willow OKLCh Perceptual Engine
// ---------------------------------------------------------------------------

const WORKSPACE_COLOR_DEFINITIONS = [
  { id: "green", label: "Willow Green", hex: "#4a7c59" },
  { id: "blue", label: "Blue", hex: "#3b82f6", isDefault: true },
  { id: "pink", label: "Pink", hex: "#ec4899" },
  { id: "yellow", label: "Yellow", hex: "#eab308" },
  { id: "orange", label: "Orange", hex: "#f97316" },
  { id: "purple", label: "Purple", hex: "#8b5cf6" },
  { id: "lilac", label: "Lilac", hex: "#c084fc" },
  { id: "coral", label: "Coral", hex: "#f43f5e" },
  { id: "teal", label: "Teal", hex: "#14b8a6" }
];

const pluginSettings = plugin.settings.define({
  workspaceColor: {
    type: "palette",
    label: "Workspace color",
    description: "Accent color theme for the background glow, send button, and UI highlights.",
    default: "blue",
    options: WORKSPACE_COLOR_DEFINITIONS.map((d) => ({ value: d.id, label: d.label, hex: d.hex }))
  }
});

// Color Space Maths (sRGB <-> Linear <-> OKLab <-> OKLCh)
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

const linearToOklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
};

const oklabToLinear = ([L, a, b]) => {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
};

const oklabToOklch = ([L, a, b]) => [
  L,
  Math.hypot(a, b),
  ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
];

const oklchToOklab = ([L, C, h]) => [
  L,
  C * Math.cos((h * Math.PI) / 180),
  C * Math.sin((h * Math.PI) / 180)
];

const isInGamut = ([r, g, b]) => [r, g, b].every((c) => c >= -1e-5 && c <= 1 + 1e-5);

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255
];

const rgbToHex = ([r, g, b]) => {
  const clamp = (v) => Math.min(255, Math.max(0, Math.round(v * 255)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
};

const rgbToOklch = (rgb) => oklabToOklch(linearToOklab(rgb.map(srgbToLinear)));

const oklchToRgb = ([L, C, h]) => {
  let lo = 0;
  let hi = C;
  if (isInGamut(oklabToLinear(oklchToOklab([L, C, h])))) {
    lo = C;
  } else {
    for (let i = 0; i < 64; i += 1) {
      const mid = (lo + hi) / 2;
      if (isInGamut(oklabToLinear(oklchToOklab([L, mid, h])))) lo = mid;
      else hi = mid;
    }
  }
  const linear = oklabToLinear(oklchToOklab([L, lo, h]));
  return linear.map((c) => Math.min(1, Math.max(0, linearToSrgb(c))));
};

const GLOW_ACCENT_TRANSFORM = {
  lightnessRatio: 0.424245154339543,
  chromaRatio: 0.46688940886964236,
  hueShiftDeg: 9.038231999938716
};

const GLOW_TO_BUTTON_TRANSFORM = {
  lightnessRatio: 1.5055348233608743,
  chromaRatio: 1.6820248383608614,
  hueShiftDeg: -5.072855244339735
};

const GLOW_TO_CHIP_TRANSFORM = {
  lightnessRatio: 1.1694180324862116,
  chromaRatio: 1.2611264321248365,
  hueShiftDeg: -0.6335269870383513
};

// Willow's exact measured glow accents
const WILLOW_HOME_GLOW_ACCENTS = {
  green: "rgb(6, 78, 59)",
  blue: "rgb(20, 32, 79)",
  pink: "rgb(76, 9, 35)",
  yellow: "rgb(66, 54, 0)",
  orange: "rgb(72, 34, 0)",
  purple: "rgb(45, 17, 75)",
  lilac: "rgb(62, 32, 76)",
  coral: "rgb(78, 7, 10)",
  teal: "rgb(0, 53, 52)"
};

// Willow's exact measured send button pairs
const WILLOW_SEND_BUTTONS = {
  green: { bg: "#127352", hover: "#0d5c41" },
  blue: { bg: "#1b3f95", hover: "#153277" },
  pink: { bg: "#8c064b", hover: "#70053c" },
  yellow: { bg: "#7c6100", hover: "#634e00" },
  orange: { bg: "#863e00", hover: "#6b3200" },
  purple: { bg: "#512192", hover: "#450e83" },
  lilac: { bg: "#6f3c92", hover: "#5f2c81" },
  coral: { bg: "#900021", hover: "#78001a" },
  teal: { bg: "#00625c", hover: "#00514c" }
};

// Willow's exact creamy tints for text selection
const WILLOW_CREAMY = {
  green: "rgba(156, 228, 179, 0.35)",
  blue: "rgba(168, 199, 250, 0.35)",
  pink: "rgba(250, 178, 205, 0.35)",
  yellow: "rgba(253, 221, 65, 0.35)",
  orange: "rgba(255, 202, 138, 0.35)",
  purple: "rgba(188, 149, 250, 0.35)",
  lilac: "rgba(215, 175, 252, 0.35)",
  coral: "rgba(255, 140, 160, 0.35)",
  teal: "rgba(130, 230, 220, 0.35)"
};

// Antigravity mark hue rotation filters (calibrated against default blue mark)
const ANTIGRAVITY_LOGO_FILTERS = {
  blue: "none",
  green: "hue-rotate(-95deg) saturate(1.1)",
  pink: "hue-rotate(75deg) saturate(1.2)",
  yellow: "hue-rotate(170deg) saturate(1.3)",
  orange: "hue-rotate(145deg) saturate(1.25)",
  purple: "hue-rotate(35deg) saturate(1.2)",
  lilac: "hue-rotate(50deg) saturate(1.15)",
  coral: "hue-rotate(95deg) saturate(1.2)",
  teal: "hue-rotate(-45deg) saturate(1.1)"
};

function computeWorkspaceTheme(def) {
  let glowAccent = WILLOW_HOME_GLOW_ACCENTS[def.id];
  let glowRgb;
  if (!glowAccent) {
    const [L, C, h] = rgbToOklch(hexToRgb(def.hex));
    glowRgb = oklchToRgb([
      L * GLOW_ACCENT_TRANSFORM.lightnessRatio,
      C * GLOW_ACCENT_TRANSFORM.chromaRatio,
      (h + GLOW_ACCENT_TRANSFORM.hueShiftDeg + 360) % 360
    ]);
    const [r, g, b] = glowRgb.map((c) => Math.round(c * 255));
    glowAccent = `rgb(${r}, ${g}, ${b})`;
  } else {
    const m = glowAccent.match(/\d+/g);
    glowRgb = m ? [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255] : [6 / 255, 78 / 255, 59 / 255];
  }

  let sendButton = WILLOW_SEND_BUTTONS[def.id];
  if (!sendButton) {
    const [L_glow, C_glow, h_glow] = rgbToOklch(glowRgb);
    const L_btn = L_glow * GLOW_TO_BUTTON_TRANSFORM.lightnessRatio;
    const C_btn = C_glow * GLOW_TO_BUTTON_TRANSFORM.chromaRatio;
    const h_btn = (h_glow + GLOW_TO_BUTTON_TRANSFORM.hueShiftDeg + 360) % 360;
    sendButton = {
      bg: rgbToHex(oklchToRgb([L_btn, C_btn, h_btn])),
      hover: rgbToHex(oklchToRgb([L_btn * 0.82, C_btn, h_btn]))
    };
  }

  let chipBg = def.id === "blue" ? "#192967" : def.id === "green" ? "#127352" : null;
  if (!chipBg) {
    const [L_glow, C_glow, h_glow] = rgbToOklch(glowRgb);
    chipBg = rgbToHex(oklchToRgb([
      L_glow * GLOW_TO_CHIP_TRANSFORM.lightnessRatio,
      C_glow * GLOW_TO_CHIP_TRANSFORM.chromaRatio,
      (h_glow + GLOW_TO_CHIP_TRANSFORM.hueShiftDeg + 360) % 360
    ]));
  }

  let creamyRgba = WILLOW_CREAMY[def.id];
  if (!creamyRgba) {
    const [, C, h] = rgbToOklch(hexToRgb(def.hex));
    const creamyRgb = oklchToRgb([0.85, Math.min(C * 0.55, 0.11), h]);
    const [cr, cg, cb] = creamyRgb.map((c) => Math.round(c * 255));
    creamyRgba = `rgba(${cr}, ${cg}, ${cb}, 0.35)`;
  }

  let logoFilter = ANTIGRAVITY_LOGO_FILTERS[def.id];
  if (!logoFilter) {
    if (def.id === "blue") {
      logoFilter = "none";
    } else {
      const [, , h_swatch] = rgbToOklch(hexToRgb(def.hex));
      const angle = Math.round((h_swatch - 245 + 360) % 360);
      logoFilter = `hue-rotate(${angle > 180 ? angle - 360 : angle}deg) saturate(1.15)`;
    }
  }

  return {
    id: def.id,
    label: def.label,
    swatchHex: def.hex,
    glowAccent,
    sendButton,
    chipBg,
    creamyRgba,
    logoFilter
  };
}

function getWorkspaceTheme(colorId) {
  const match = WORKSPACE_COLOR_DEFINITIONS.find((d) => d.id === colorId);
  return computeWorkspaceTheme(match || WORKSPACE_COLOR_DEFINITIONS[0]);
}

function applyWorkspaceTheme(colorId) {
  const theme = getWorkspaceTheme(colorId);
  const root = document.documentElement;

  root.style.setProperty("--gemini-home-glow-accent", theme.glowAccent);
  root.style.setProperty("--gemini-send-bg", theme.sendButton.bg);
  root.style.setProperty("--gemini-send-bg-hover", theme.sendButton.hover);
  root.style.setProperty("--gemini-chip-bg", theme.chipBg);
  root.style.setProperty("--gemini-selection-bg", theme.creamyRgba);
  root.style.setProperty("--gemini-logo-filter", theme.logoFilter);

  let themeStyle = document.getElementById("gemini-theme-dynamic-styles");
  if (!themeStyle) {
    themeStyle = document.createElement("style");
    themeStyle.id = "gemini-theme-dynamic-styles";
    document.head.appendChild(themeStyle);
  }
  themeStyle.textContent = `
    :root {
      --gemini-home-glow-accent: ${theme.glowAccent} !important;
      --gemini-send-bg: ${theme.sendButton.bg} !important;
      --gemini-send-bg-hover: ${theme.sendButton.hover} !important;
      --gemini-chip-bg: ${theme.chipBg} !important;
      --gemini-selection-bg: ${theme.creamyRgba} !important;
      --gemini-logo-filter: ${theme.logoFilter} !important;
    }
    ::selection {
      background: ${theme.creamyRgba} !important;
    }
  `;
}

// Initialise theme and listen for settings changes
applyWorkspaceTheme(pluginSettings.workspaceColor);
plugin.settings.onChange((key, value) => {
  if (key === "workspaceColor" && typeof value === "string") {
    applyWorkspaceTheme(value);
    enhanceWorkspaceColorSettings();
  }
});

function enhanceWorkspaceColorSettings() {
  const rows = document.querySelectorAll(".py-2.px-3");
  let targetRow = null;
  for (const r of rows) {
    if ((r.textContent || "").includes("Workspace color")) {
      targetRow = r;
      break;
    }
  }
  if (!targetRow) return;

  const controlSlot = targetRow.querySelector(".shrink-0");
  if (!controlSlot) return;

  const input = controlSlot.querySelector("input, select");
  if (input) {
    input.style.display = "none";
  }

  const currentVal =
    window.BetterGravity && window.BetterGravity.plugins && window.BetterGravity.plugins.getSetting
      ? window.BetterGravity.plugins.getSetting("gemini-app", "workspaceColor") || pluginSettings.workspaceColor || "blue"
      : pluginSettings.workspaceColor || "blue";

  let container = controlSlot.querySelector(".gemini-palette-picker");
  if (container && (container.querySelector(".gemini-palette-badge") || container.querySelector(".gemini-palette-swatches"))) {
    container.remove();
    container = null;
  }
  if (!container) {
    container = document.createElement("div");
    container.className = "gemini-palette-picker";
    container.style.cssText = "display: flex; align-items: center; gap: 7px; flex-wrap: wrap; justify-content: flex-end;";
    controlSlot.appendChild(container);
  } else {
    container.style.cssText = "display: flex; align-items: center; gap: 7px; flex-wrap: wrap; justify-content: flex-end;";
  }

  if (container.getAttribute("data-active-color") === currentVal && container.children.length === WORKSPACE_COLOR_DEFINITIONS.length) {
    return;
  }
  container.setAttribute("data-active-color", currentVal);

  container.innerHTML = "";
  for (const col of WORKSPACE_COLOR_DEFINITIONS) {
    const isSelected = col.id === currentVal;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = col.label;
    btn.setAttribute("aria-label", col.label);
    btn.style.cssText = [
      "width: 24px",
      "height: 24px",
      "border-radius: 6px",
      "background-color: " + col.hex,
      "cursor: pointer",
      "position: relative",
      "display: inline-flex",
      "align-items: center",
      "justify-content: center",
      "border: 1px solid rgba(255, 255, 255, 0.18)",
      "transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.15s ease, outline 0.15s ease, opacity 0.15s ease",
      "box-sizing: border-box",
      "padding: 0",
      isSelected
        ? "transform: scale(1.1); outline: 2px solid #ffffff; outline-offset: 2px; box-shadow: 0 0 0 1px #18181b, 0 2px 8px rgba(0,0,0,0.5); z-index: 2;"
        : "opacity: 0.8;"
    ].join(";");

    btn.onmouseenter = () => {
      if (btn.getAttribute("data-selected") !== "true") {
        btn.style.transform = "scale(1.15)";
        btn.style.opacity = "1";
        btn.style.zIndex = "1";
      }
    };
    btn.onmouseleave = () => {
      if (btn.getAttribute("data-selected") !== "true") {
        btn.style.transform = "scale(1)";
        btn.style.opacity = "0.8";
        btn.style.zIndex = "0";
      }
    };

    if (isSelected) {
      btn.setAttribute("data-selected", "true");
      const check = document.createElement("span");
      check.style.cssText = "color: #ffffff; display: flex; align-items: center; justify-content: center; pointer-events: none; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6));";
      check.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 -960 960 960" fill="currentColor"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>';
      btn.appendChild(check);
    }

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyWorkspaceTheme(col.id);
      if (input) {
        input.value = col.id;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (window.BetterGravity && window.BetterGravity.plugins && window.BetterGravity.plugins.setSetting) {
        window.BetterGravity.plugins.setSetting("gemini-app", "workspaceColor", col.id);
      }
      enhanceWorkspaceColorSettings();
    };

    container.appendChild(btn);
  }
}

if (typeof document !== "undefined" && document.body) {
  enhanceWorkspaceColorSettings();
  const settingsObserver = new MutationObserver(() => {
    enhanceWorkspaceColorSettings();
  });
  settingsObserver.observe(document.body, { childList: true, subtree: true });
}


/**
 * Hand-written shortenings for models that are not Gemini. Each entry is a
 * pattern and a replacement; the first that matches wins.
 *
 * "Claude Opus 4.6 (Thinking)" → "Opus 4.6"; "Claude Sonnet 4.5" → "Sonnet 4.5".
 * "GPT-OSS 120B (Medium)" → "GPT-OSS".
 */
const VENDOR_RULES = [
  { pattern: /^Claude\s+(Opus|Sonnet|Haiku)\s+([\d.]+).*$/i, replace: "$1 $2" },
  { pattern: /^GPT-OSS\b.*$/i, replace: "GPT-OSS" }
];

/** Willow's rule: the word "Gemini" goes, and so does a trailing "Extended". */
const GEMINI_WORD = /\bGemini\s+/gi;
const GEMINI_SUFFIX = /\s+Extended$/i;

function shorten(fullName) {
  const name = fullName.replace(/\s+/g, " ").trim();
  if (!name) return fullName;
  for (const rule of VENDOR_RULES) {
    if (rule.pattern.test(name)) return name.replace(rule.pattern, rule.replace).trim();
  }
  return name.replace(GEMINI_WORD, "").replace(GEMINI_SUFFIX, "").trim();
}

// Only the pill in the prompt box. The same trigger component may appear
// elsewhere; those keep full names, as the model menu does.
const PILL_SELECTOR = '[data-testid="agent-input-box"] [data-testid="model-selector-trigger"]';

/**
 * The name is the first text node inside the pill's label span. It is edited in
 * place rather than replaced: React holds a reference to that very node and
 * writes the next model's name into it, so replacing it would leave the pill
 * frozen on whatever it said when the plugin started.
 */
function nameNode(pill) {
  const label = pill.querySelector("span");
  if (!label) return null;
  for (const node of label.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.data.trim()) return node;
  }
  return null;
}

function apply(pill) {
  const node = nameNode(pill);
  if (!node) return;
  const current = node.data;
  const short = shorten(current);
  // A name that shortens to itself is either already short or not ours to touch.
  if (short === current) return;
  // The full name stays on the pill, for the theme to use and for switching
  // the plugin off to restore.
  pill.dataset.fullModelName = current.trim();
  node.data = short;
}

const observers = new Map();

/**
 * A conversation row is watched by two separate observers, so keying the map by
 * element alone loses whichever registered first. Chain them instead: dispose
 * calls both, and neither leaks.
 */
function remember(element, disposer) {
  const existing = observers.get(element);
  if (!existing) {
    observers.set(element, disposer);
    return;
  }
  observers.set(element, {
    disconnect: () => {
      existing.disconnect();
      disposer.disconnect();
    }
  });
}

plugin.dom.observe(PILL_SELECTOR, (pill) => {
  apply(pill);
  // React writes the new name into the existing text node when the model
  // changes, and rebuilds the span outright in some updates. Both are caught
  // here. Writing the short name triggers the observer once more, but a short
  // name shortens to itself, so that pass does nothing and the loop ends.
  const observer = new MutationObserver(() => apply(pill));
  observer.observe(pill, { subtree: true, childList: true, characterData: true });
  observers.set(pill, observer);
});

/* ---------------------------------------------------------------------------
 * Left sidebar: "New conversation" row and collapse motion
 * ------------------------------------------------------------------------- */
const NEW_CONV_SELECTOR = '[data-testid="new-conversation-button"]';
const SIDEBAR_SELECTOR = '[role="navigation"][aria-label="Sidebar"]';
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent);
const NEW_CONV_SHORTCUT = isMac ? "⌘+Shift+O" : "Ctrl+Shift+O";

function newConvLabelNode(btn) {
  const label = btn.querySelector(".truncate") || btn.querySelector("span:last-child");
  if (!label) return null;
  for (const node of label.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.data.trim() === "New Conversation" || node.data.trim() === "New conversation" || node.data.trim() === "New chat")) {
      return node;
    }
  }
  return null;
}

/* The current-destination pill is drawn from Antigravity's own state, not from
 * anything marked here: every sidebar nav row is one `SideBarButton` taking a
 * `selected` prop, and it spends that prop on the class `bg-sidebar-secondary`,
 * which styles/sidebar.css reads directly. A `data-active` attribute used to be
 * set here from `location.pathname`, and it went stale the moment the router
 * navigated by pushState — leaving "New Conversation" lit while a conversation
 * was open. The app's own class cannot go stale. */
function applyNewConv(btn) {
  const node = newConvLabelNode(btn);
  if (node && node.data.trim() === "New chat") {
    node.data = "New conversation";
  }
  if (!btn.hasAttribute("data-shortcut")) {
    btn.setAttribute("data-shortcut", NEW_CONV_SHORTCUT);
  }
}

plugin.dom.observe(NEW_CONV_SELECTOR, (btn) => {
  applyNewConv(btn);
  const observer = new MutationObserver(() => applyNewConv(btn));
  observer.observe(btn, { subtree: true, childList: true, characterData: true });
  observers.set(btn, observer);
});

// Willow's exact sidebar widths (expanded = 288px, collapsed = 52px) and motion curve
const WILLOW_SIDEBAR_EXPANDED_WIDTH = "288px";
const WILLOW_SIDEBAR_COLLAPSED_WIDTH = "52px";
const WILLOW_SIDEBAR_TRANSITION = "width 300ms cubic-bezier(0.2, 0, 0, 1), height 300ms cubic-bezier(0.2, 0, 0, 1)";
const TOGGLE_SELECTOR = 'button[data-testid="sidebar-toggle"][aria-label="Toggle Sidebar"], button[data-testid="sidebar-toggle"][aria-expanded]';

function isSidebarCollapsed() {
  const toggle = document.querySelector(TOGGLE_SELECTOR);
  if (toggle) {
    return toggle.getAttribute("aria-expanded") === "false";
  }
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  return sidebar?.getAttribute("data-collapsed") === "true";
}

let isEnforcingSidebarGeometry = false;

function enforceSidebarGeometry(grandParent, collapsed) {
  if (!grandParent || isEnforcingSidebarGeometry) return;
  isEnforcingSidebarGeometry = true;
  try {
    const targetWidth = collapsed ? WILLOW_SIDEBAR_COLLAPSED_WIDTH : WILLOW_SIDEBAR_EXPANDED_WIDTH;
    if (grandParent.style.width !== targetWidth) {
      grandParent.style.width = targetWidth;
    }
    if (grandParent.style.minWidth !== "0px") {
      grandParent.style.minWidth = "0px";
    }
    if (grandParent.style.visibility !== "visible") {
      grandParent.style.visibility = "visible";
    }
    if (grandParent.style.transition !== WILLOW_SIDEBAR_TRANSITION) {
      grandParent.style.transition = WILLOW_SIDEBAR_TRANSITION;
    }
    const child = grandParent.firstElementChild;
    if (child) {
      if (child.style.width !== targetWidth) {
        child.style.width = targetWidth;
      }
      if (child.style.minWidth !== "0px") {
        child.style.minWidth = "0px";
      }
      const targetLeft = collapsed ? "0px" : "";
      if (child.style.left !== targetLeft) {
        child.style.left = targetLeft;
      }
      const targetRight = collapsed ? "auto" : "";
      if (child.style.right !== targetRight) {
        child.style.right = targetRight;
      }
    }
  } finally {
    isEnforcingSidebarGeometry = false;
  }
}

function ensureSidebarHeader(sidebar, collapsed) {
  const header = sidebar?.firstElementChild;
  if (!header) return;

  let logoBtn = header.querySelector(".gemini-logo-btn");
  if (!logoBtn) {
    logoBtn = document.createElement("button");
    logoBtn.type = "button";
    logoBtn.className = "gemini-logo-btn";
    logoBtn.innerHTML = `
      <div class="gemini-logo-wrap">
        <div class="gemini-logo-mark"></div>
      </div>
      <div class="gemini-logo-expand-wrap">
        <svg class="gemini-logo-expand-icon" width="20" height="20" viewBox="0 -960 960 960" fill="currentColor">
          <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h160v-560H200v560Zm240 0h320v-560H440v560Zm-80 0v-560 560Z"/>
        </svg>
      </div>
    `;
    logoBtn.addEventListener("click", () => {
      if (isSidebarCollapsed()) {
        const toggle = document.querySelector(TOGGLE_SELECTOR);
        if (toggle) toggle.click();
      }
    });
    header.prepend(logoBtn);
  }

  const logoLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";
  if (logoBtn.getAttribute("aria-label") !== logoLabel) {
    logoBtn.setAttribute("aria-label", logoLabel);
  }
  const logoTitle = collapsed ? "Expand sidebar" : "";
  if (logoBtn.getAttribute("title") !== logoTitle && !logoBtn.hasAttribute("data-willow-tooltip")) {
    if (logoTitle) logoBtn.setAttribute("title", logoTitle);
    else logoBtn.removeAttribute("title");
  }
  const logoPos = collapsed ? "right" : "below";
  if (logoBtn.getAttribute("data-tooltip-position") !== logoPos) {
    logoBtn.setAttribute("data-tooltip-position", logoPos);
  }

  header.querySelector(".willow-sidenav-text")?.remove();
}

function updateSidebarItemsState(sidebar, collapsed) {
  const navSpecs = [
    { selector: '[data-testid="new-conversation-button"]', title: "New conversation" },
    { selector: '[data-testid="history-button"]', title: "History" },
    { selector: '#gemini-scheduled-tasks-button', title: "Scheduled tasks" },
    { selector: '[data-testid="automations-button"]', title: "Scheduled tasks" },
    { selector: '#gemini-new-project-button', title: "New project" },
    { selector: '#gemini-display-options-button', title: "Display options" },
    { selector: '[data-testid="settings-button"]', title: "Settings" }
  ];

  for (const spec of navSpecs) {
    const el = sidebar.querySelector(spec.selector) || document.querySelector(spec.selector);
    if (el) {
      if (collapsed) {
        if (el.getAttribute("data-tooltip-position") !== "right") {
          el.setAttribute("data-tooltip-position", "right");
        }
        if (!el.getAttribute("title") && !el.hasAttribute("data-willow-tooltip")) {
          el.setAttribute("title", spec.title);
        }
      } else {
        if (el.getAttribute("data-tooltip-position") === "right") {
          el.removeAttribute("data-tooltip-position");
        }
      }
    }
  }

  const userPill = sidebar.querySelector("#gemini-sidebar-user-pill");
  if (userPill) {
    if (collapsed) {
      userPill.setAttribute("data-tooltip-position", "right");
    } else {
      userPill.removeAttribute("data-tooltip-position");
    }
  }

  const rows = sidebar.querySelectorAll('[data-testid="conversation-row-sidebar"]');
  for (const row of rows) {
    if (collapsed) {
      const truncate = row.querySelector("span.truncate");
      const title = truncate?.textContent?.trim() || "Conversation";
      if (!row.getAttribute("title") && !row.hasAttribute("data-willow-tooltip")) {
        row.setAttribute("title", title);
      }
      row.setAttribute("data-tooltip-position", "right");
    } else {
      if (row.getAttribute("data-tooltip-position") === "right") {
        row.removeAttribute("data-tooltip-position");
      }
    }
  }

  const projectHeaders = sidebar.querySelectorAll('button[class*="group/headerbtn"]');
  for (const pHeader of projectHeaders) {
    if (collapsed) {
      const truncate = pHeader.querySelector("span.truncate");
      const title = truncate?.textContent?.trim() || "Project";
      if (!pHeader.getAttribute("title") && !pHeader.hasAttribute("data-willow-tooltip")) {
        pHeader.setAttribute("title", title);
      }
      pHeader.setAttribute("data-tooltip-position", "right");
    } else {
      if (pHeader.getAttribute("data-tooltip-position") === "right") {
        pHeader.removeAttribute("data-tooltip-position");
      }
    }
  }

  const seeAllBtn = sidebar.querySelector('div[class*="pl-[22px]"] > button');
  if (seeAllBtn) {
    if (collapsed) {
      if (!seeAllBtn.getAttribute("title") && !seeAllBtn.hasAttribute("data-willow-tooltip")) {
        seeAllBtn.setAttribute("title", "All conversations");
      }
      seeAllBtn.setAttribute("data-tooltip-position", "right");
    } else {
      if (seeAllBtn.getAttribute("data-tooltip-position") === "right") {
        seeAllBtn.removeAttribute("data-tooltip-position");
      }
    }
  }
}

function syncSidebarState(sidebar) {
  if (!sidebar) return;
  const grandParent = sidebar.parentElement?.parentElement;
  const collapsed = isSidebarCollapsed();

  enforceSidebarGeometry(grandParent, collapsed);
  if (sidebar.getAttribute("data-collapsed") !== String(collapsed)) {
    sidebar.setAttribute("data-collapsed", String(collapsed));
  }

  ensureSidebarHeader(sidebar, collapsed);
  sidebar.querySelector(".gemini-sidebar-expand-rail")?.remove();
  ensureExperienceSwitch(sidebar);
  updateSidebarItemsState(sidebar, collapsed);
}

plugin.dom.observe(SIDEBAR_SELECTOR, (sidebar) => {
  syncSidebarState(sidebar);
  const grandParent = sidebar.parentElement?.parentElement;
  if (grandParent) {
    const observer = new MutationObserver(() => {
      syncSidebarState(sidebar);
    });
    observer.observe(grandParent, { attributes: true, attributeFilter: ["style"] });
    observers.set(grandParent, observer);
  }
  const sidebarObserver = new MutationObserver(() => {
    ensureSidebarHeader(sidebar, isSidebarCollapsed());
    ensureExperienceSwitch(sidebar);
    sidebar.querySelector(".gemini-sidebar-expand-rail")?.remove();
  });
  sidebarObserver.observe(sidebar, { childList: true });
  remember(sidebar, sidebarObserver);
});

plugin.dom.observe(TOGGLE_SELECTOR, (toggle) => {
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  if (sidebar) syncSidebarState(sidebar);
  const toggleObserver = new MutationObserver(() => {
    const sb = document.querySelector(SIDEBAR_SELECTOR);
    if (sb) syncSidebarState(sb);
  });
  toggleObserver.observe(toggle, { attributes: true, attributeFilter: ["aria-expanded", "class"] });
  remember(toggle, toggleObserver);
});

/* ---------------------------------------------------------------------------
 * The Chat / Work switch
 *
 * Willow draws a segmented pill under the sidebar's header band
 * (apps/studio/src/shell/sidebar/Sidebar.tsx:1579-1704) to move between its two
 * experiences. Antigravity has no such control, so this is one of the few
 * places where there is no host markup to restyle: the pill is built here and
 * drawn by styles/sidebar.css, the same split the added nav rows below use.
 *
 * It selects, and that is all it does. Clicking moves the pill so the control
 * answers the pointer; no route change, no host state — what the two sides
 * should actually switch is still to be decided.
 * ------------------------------------------------------------------------- */
const EXPERIENCES = [
  { id: "chat", label: "Chat" },
  // Willow's second tab reads "Spark". Here it is "Work".
  { id: "work", label: "Work", badge: "beta" }
];

const EXPERIENCE_LABELS = new Map(EXPERIENCES.map((experience) => [experience.id, experience.label]));

/**
 * Willow gives the tooltip to the inactive tab only, so it names where you
 * would go rather than where you are (Sidebar.tsx:1636 and :1661, each passing
 * `undefined` for its own tab). Willow's also names a keyboard shortcut; there
 * is none here, so the text stops at the destination.
 *
 * Clearing it takes two attributes, not one. The tooltip engine further down
 * this file moves `title` into `data-willow-tooltip` the first time an element
 * is hovered and reads it back from there, so a tab that has been pointed at
 * once no longer holds the text in `title` — dropping only that would leave the
 * active tab still offering to switch to itself.
 */
function markExperience(pill, selected) {
  pill.dataset.geminiExperience = selected;
  for (const tab of pill.querySelectorAll("[data-gemini-experience-tab]")) {
    const isSelected = tab.dataset.geminiExperienceTab === selected;
    tab.setAttribute("aria-pressed", String(isSelected));
    if (isSelected) {
      tab.removeAttribute("title");
      tab.removeAttribute("data-willow-tooltip");
    } else {
      // Written afresh rather than left to the stash: the engine only opens for
      // an element matching `[title]`, so restoring it is what lets the tooltip
      // come back after the tab has been active.
      tab.title = `Switch to ${EXPERIENCE_LABELS.get(tab.dataset.geminiExperienceTab)}`;
      tab.removeAttribute("data-willow-tooltip");
    }
  }

  const collapsedBtn = pill.querySelector(".gemini-experience-collapsed-btn");
  if (collapsedBtn) {
    const isWork = selected === "work";
    collapsedBtn.setAttribute("aria-pressed", String(isWork));
    const nextTarget = isWork ? "Chat" : "Work";
    collapsedBtn.title = `Switch to ${nextTarget}`;
    collapsedBtn.setAttribute("aria-label", `Switch to ${nextTarget}`);
    collapsedBtn.removeAttribute("data-willow-tooltip");
  }
}

function buildExperienceSwitch() {
  const pill = document.createElement("div");
  pill.id = "gemini-experience-switch";

  const track = document.createElement("div");
  track.dataset.geminiExperienceTrack = "";
  const slider = document.createElement("div");
  slider.dataset.geminiExperienceSlider = "";
  track.append(slider);

  const tabsWrap = document.createElement("div");
  tabsWrap.className = "gemini-experience-tabs-wrap";

  for (const experience of EXPERIENCES) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.dataset.geminiExperienceTab = experience.id;
    const label = document.createElement("span");
    label.dataset.geminiExperienceLabel = "";
    label.textContent = experience.label;
    tab.append(label);
    if (experience.badge) {
      const badge = document.createElement("span");
      badge.dataset.geminiExperienceBadge = "";
      // "beta" in the markup, BETA on screen: the uppercasing is Willow's, in CSS.
      badge.textContent = experience.badge;
      tab.append(badge);
    }
    tab.addEventListener("click", () => markExperience(pill, experience.id));
    tabsWrap.append(tab);
  }
  track.append(tabsWrap);

  const collapsedBtn = document.createElement("button");
  collapsedBtn.type = "button";
  collapsedBtn.className = "gemini-experience-collapsed-btn";
  collapsedBtn.setAttribute("data-tooltip-position", "right");
  collapsedBtn.innerHTML = `
    <svg class="gemini-experience-collapsed-icon" width="14" height="22" viewBox="0 0 14 22" fill="none">
      <rect x="1" y="1" width="12" height="20" rx="6" stroke="currentColor" stroke-width="1.8"/>
      <circle cx="7" cy="7" r="3.2" fill="currentColor" class="gemini-switch-dot"/>
    </svg>
  `;
  collapsedBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const current = pill.dataset.geminiExperience || "chat";
    const next = current === "chat" ? "work" : "chat";
    markExperience(pill, next);
  });
  track.append(collapsedBtn);

  pill.append(track);
  markExperience(pill, EXPERIENCES[0].id);
  return pill;
}

/** Directly under the header band, where Willow has it, and back there if a
 * re-render moves it. The selection lives on the element, so a pill that is
 * only re-seated keeps the tab the user chose. */
function ensureExperienceSwitch(sidebar) {
  const header = sidebar.firstElementChild;
  if (!header) return;
  const pill = sidebar.querySelector("#gemini-experience-switch") ?? buildExperienceSwitch();
  if (header.nextElementSibling !== pill) header.after(pill);
}

/* ---------------------------------------------------------------------------
 * The scrolling half of the navigation (Sidebar.tsx:1881-1925)
 *
 * Willow pins two rows and no more. Its fixed block is labelled "Fixed
 * top-level navigation: Home & Search" and holds New chat and Search chats
 * (Sidebar.tsx:1882-1910); Code, Media, every section heading and every chat
 * live in the scroller below it (1919-1925) and scroll away. Antigravity pins
 * its whole nav block, so Scheduled Tasks, New project and Display options hold
 * the top of the rail while the list moves under them.
 *
 * Those three go into the scroller instead, above the chat list. Two are this
 * plugin's own rows and are simply built there. The third is Antigravity's
 * Scheduled Tasks row, and that one is deliberately NOT moved: main.js renders
 * it inside `D && <Fragment>` with two conditional rows after it (`C && !w` for
 * UI Plugins, `w &&` for the toolbox), so React may call
 * `insertBefore(row, automationsButton)` or `removeChild(automationsButton)` on
 * the nav column whenever one of those flags flips. Both throw NotFoundError
 * once that node is somewhere else, and a throw inside a commit takes the
 * sidebar with it. So it stays where React put it, hidden by styles/sidebar.css,
 * and the row below carries its glyph, its label, its selected state and its
 * clicks. When Antigravity does not render it at all, neither does this.
 *
 * The chat list is a virtualiser and does not know it now starts 96px lower. It
 * absorbs that because it overscans generously: measured live at 0, 200 and
 * 600px and at 25/50/75/100% of the range, ~230px is rendered above the viewport
 * and ~430px below it, and no blank band ever reaches an edge.
 * ------------------------------------------------------------------------- */
const AUTOMATIONS_SELECTOR = '[data-testid="automations-button"]';
const LIST_SELECTOR = '[data-testid="conversation-list-sidebar"]';

/** A bare row in this plugin's own shape; styles/sidebar.css draws the rest. */
function navRow(id) {
  const btn = document.createElement('button');
  btn.id = id;
  btn.className = 'gemini-nav-item';
  btn.setAttribute('type', 'button');
  return btn;
}

function ensureNewProjectRow(block) {
  let newProjectBtn = document.getElementById('gemini-new-project-button');
  if (!newProjectBtn) {
    newProjectBtn = navRow('gemini-new-project-button');
    newProjectBtn.innerHTML = `
      <span class="icon-box">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="7" height="7" x="3" y="3" rx="1"/>
          <rect width="7" height="7" x="14" y="3" rx="1"/>
          <rect width="7" height="7" x="14" y="14" rx="1"/>
          <rect width="7" height="7" x="3" y="14" rx="1"/>
        </svg>
      </span>
      <span class="truncate">New project</span>
    `;
    newProjectBtn.addEventListener('click', (e) => {
      e.preventDefault();
      let orig = document.querySelector('[data-testid="sidebar-add-project-button"]');
      if (!orig) {
        const scroller = document.querySelector('[data-testid="conversation-list-sidebar"]');
        if (scroller) scroller.scrollTop = 0;
        orig = document.querySelector('[data-testid="sidebar-add-project-button"]');
      }
      if (orig) orig.click();
    });
  }
  if (newProjectBtn.parentElement !== block) block.appendChild(newProjectBtn);
}

function ensureDisplayOptionsRow(block) {
  let displayOptsBtn = document.getElementById('gemini-display-options-button');
  if (!displayOptsBtn) {
    displayOptsBtn = navRow('gemini-display-options-button');
    displayOptsBtn.innerHTML = `
      <span class="icon-box">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor">
          <path d="M411.15-260v-60H548.46v60H411.15Zm-155-190v-60H703.46v60H256.16ZM140-640v-60H820v60H140Z"/>
        </svg>
      </span>
      <span class="truncate">Display options</span>
    `;
    displayOptsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      let orig = document.querySelector('[aria-label="Display Options"]');
      if (!orig) {
        const scroller = document.querySelector('[data-testid="conversation-list-sidebar"]');
        if (scroller) scroller.scrollTop = 0;
        orig = document.querySelector('[aria-label="Display Options"]');
      }
      if (orig) {
        const r = displayOptsBtn.getBoundingClientRect();
        orig.style.display = 'block';
        orig.style.position = 'fixed';
        orig.style.top = `${r.bottom}px`;
        orig.style.left = `${Math.max(10, r.right - 180)}px`;
        orig.style.width = '180px';
        orig.style.height = '1px';
        orig.style.opacity = '0';
        orig.style.pointerEvents = 'none';
        orig.click();
        setTimeout(() => {
          orig.style.position = '';
          orig.style.top = '';
          orig.style.left = '';
          orig.style.width = '';
          orig.style.height = '';
          orig.style.opacity = '';
          orig.style.pointerEvents = '';
          orig.style.display = '';
        }, 100);
      }
    });
  }
  if (displayOptsBtn.parentElement !== block) block.appendChild(displayOptsBtn);
}

function ensureScheduledTasksRow(block) {
  const original = document.querySelector(AUTOMATIONS_SELECTOR);
  let row = document.getElementById('gemini-scheduled-tasks-button');
  if (!original) {
    row?.remove();
    return;
  }
  if (!row) {
    row = navRow('gemini-scheduled-tasks-button');
    // No <svg> here. The native row draws its glyph as a Luminous ligature on
    // the icon slot's ::before (styles/sidebar.css), and so does this one, so
    // the stand-in and the row it stands in for cannot drift apart.
    row.innerHTML = '<span class="icon-box"></span><span class="truncate"></span>';
    row.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelector(AUTOMATIONS_SELECTOR)?.click();
    });
  }
  // Both of these live on the hidden row, so read them off it every pass: the
  // label because Antigravity owns its wording, and `bg-sidebar-secondary`
  // because that is where it spends the row's `selected` prop (main.js).
  const label = original.querySelector('span:last-child')?.textContent?.trim();
  const slot = row.querySelector('span:last-child');
  if (label && slot.textContent !== label) slot.textContent = label;
  row.classList.toggle('bg-sidebar-secondary', original.classList.contains('bg-sidebar-secondary'));
  if (row.parentElement !== block) block.appendChild(row);
}

const SCROLL_NAV_ROWS = [
  'gemini-scheduled-tasks-button',
  'gemini-new-project-button',
  'gemini-display-options-button',
];

function ensureScrollNav() {
  const scroller = document.querySelector(LIST_SELECTOR);
  if (!scroller) return;
  let block = document.getElementById('gemini-scroll-nav');
  if (!block) {
    block = document.createElement('div');
    block.id = 'gemini-scroll-nav';
  }
  ensureScheduledTasksRow(block);
  ensureNewProjectRow(block);
  ensureDisplayOptionsRow(block);
  // Every write from here down is guarded, because the observers that call this
  // watch the nodes it writes to, and a `replaceChildren` or an `insertBefore`
  // that changes nothing still reports a mutation. That is a loop.
  const wanted = SCROLL_NAV_ROWS
    .map((id) => document.getElementById(id))
    .filter((row) => row && row.parentElement === block);
  const current = [...block.children];
  if (wanted.length !== current.length || wanted.some((row, i) => current[i] !== row)) {
    block.replaceChildren(...wanted);
  }
  if (scroller.firstChild !== block) scroller.insertBefore(block, scroller.firstChild);
}

/* ---------------------------------------------------------------------------
 * The soft top edge (Sidebar.tsx:2122-2135)
 *
 * "Fancy top glow overlay matching sidebar background under Search tab", in
 * Willow's own words: a 12px band across the top of the scroll region,
 * `pointer-events-none z-10`, fading in over 200ms once `isScrolled`, which it
 * defines as `scrollTop > 5` (Sidebar.tsx:883). The gradient is the rail's own
 * colour, so a row scrolling out dissolves into the rail instead of sliding
 * under a scrim.
 *
 * It is a sibling of the scroller inside the `relative` box the scroller fills —
 * not a mask on the scroller, and not a child of it. Willow tried the mask and
 * ended up dimming the same row twice (its comment at Sidebar.tsx:1912-1917).
 * Antigravity's structure has the same shape, so this goes in the same place.
 * ------------------------------------------------------------------------- */
function ensureTopFade(scroller) {
  const holder = scroller.parentElement;
  if (!holder) return;
  let fade = document.getElementById('gemini-top-fade');
  if (!fade) {
    fade = document.createElement('div');
    fade.id = 'gemini-top-fade';
    fade.setAttribute('aria-hidden', 'true');
  }
  if (fade.parentElement !== holder) holder.appendChild(fade);
  const scrolled = String(scroller.scrollTop > 5);
  if (fade.dataset.scrolled !== scrolled) fade.dataset.scrolled = scrolled;
}

plugin.dom.observe(LIST_SELECTOR, (scroller) => {
  ensureScrollNav();
  ensureTopFade(scroller);
  // Willow re-checks its scroll flags on resize too (Sidebar.tsx:892-906), but
  // that is for the other one: `isAtScrollEnd` moves with scrollHeight and
  // clientHeight, which a resize changes without a scroll event. This flag only
  // watches scrollTop, and that cannot move silently.
  const onScroll = () => ensureTopFade(scroller);
  scroller.addEventListener('scroll', onScroll, { passive: true });
  // React owns the virtualiser sitting next to the block. If it swaps that out,
  // the block has to be put back in front of it.
  const children = new MutationObserver(() => {
    ensureScrollNav();
    ensureTopFade(scroller);
    const sidebar = scroller.closest(SIDEBAR_SELECTOR);
    if (sidebar && isSidebarCollapsed()) {
      updateSidebarItemsState(sidebar, true);
    }
  });
  children.observe(scroller, { childList: true });
  remember(scroller, {
    disconnect: () => {
      scroller.removeEventListener('scroll', onScroll);
      children.disconnect();
    }
  });
});

plugin.dom.observe(AUTOMATIONS_SELECTOR, (autoBtn) => {
  ensureScrollNav();
  // The hidden row is the source for the stand-in's label and selected pill;
  // its column tells us when Antigravity stops rendering it at all. Neither is
  // written to any more, so watching them cannot feed this back to itself.
  const observer = new MutationObserver(() => ensureScrollNav());
  observer.observe(autoBtn, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
    characterData: true,
  });
  remember(autoBtn, observer);
  if (autoBtn.parentElement) {
    const columnObserver = new MutationObserver(() => ensureScrollNav());
    columnObserver.observe(autoBtn.parentElement, { childList: true });
    remember(autoBtn.parentElement, columnObserver);
  }
});

const HEADERBTN_SELECTOR = '.group\\/headerbtn, button[class*="group/headerbtn"]';

function getReferenceLeft(sidebar) {
  const rows = document.querySelectorAll('[data-testid="conversation-row-sidebar"] span.truncate');
  for (const row of rows) {
    const r = row.getBoundingClientRect();
    if (r.width > 0 && r.left > 0) return r.left;
  }
  const headers = document.querySelectorAll('[data-testid="section-header"], .group\\/section-header, [role="navigation"][aria-label="Sidebar"] h2, [role="navigation"][aria-label="Sidebar"] h3');
  for (const h of headers) {
    const r = h.getBoundingClientRect();
    if (r.width > 0 && r.left > 0) return r.left;
  }
  if (sidebar) {
    return sidebar.getBoundingClientRect().left + 14;
  }
  return 14;
}

function alignSubheadingTitle(btn) {
  const truncate = btn.querySelector('span.truncate, span[class*="truncate"]');
  if (!truncate) return;

  // 1. Walk up from truncate to btn, hiding all previous siblings at every layer
  let current = truncate;
  while (current && current !== btn) {
    let prev = current.previousElementSibling;
    while (prev) {
      prev.style.setProperty('display', 'none', 'important');
      prev.style.setProperty('width', '0px', 'important');
      prev.style.setProperty('min-width', '0px', 'important');
      prev.style.setProperty('max-width', '0px', 'important');
      prev.style.setProperty('margin', '0px', 'important');
      prev.style.setProperty('padding', '0px', 'important');
      prev = prev.previousElementSibling;
    }
    if (current.parentElement && current.parentElement !== btn) {
      current.parentElement.style.setProperty('padding-left', '0px', 'important');
      current.parentElement.style.setProperty('margin-left', '0px', 'important');
      current.parentElement.style.setProperty('gap', '0px', 'important');
    }
    current = current.parentElement;
  }

  // 2. Normalize btn padding
  btn.style.setProperty('padding-left', '8px', 'important');
  btn.style.setProperty('margin-left', '0px', 'important');

  // 3. Normalize parent wrapper if present
  if (btn.parentElement) {
    btn.parentElement.style.setProperty('padding-left', '0px', 'important');
    btn.parentElement.style.setProperty('margin-left', '0px', 'important');
  }

  // 4. Pixel-perfect alignment matching conversation row title
  const sidebar = btn.closest('[role="navigation"][aria-label="Sidebar"]') || document.querySelector('[role="navigation"][aria-label="Sidebar"]');
  const targetLeft = getReferenceLeft(sidebar);
  const headingRect = truncate.getBoundingClientRect();
  if (headingRect.width > 0 && headingRect.left > 0 && targetLeft > 0) {
    const diff = headingRect.left - targetLeft;
    if (Math.abs(diff) > 0.5 && Math.abs(diff) < 80) {
      const currentMargin = parseFloat(truncate.style.marginLeft || '0');
      truncate.style.setProperty('margin-left', `${currentMargin - diff}px`, 'important');
    }
  }
}

function findHeaderRow(btn) {
  let curr = btn.parentElement;
  let candidate = null;
  while (curr && curr !== document.body) {
    if (curr.classList?.contains('group/header') ||
        curr.className?.includes?.('group/header') ||
        curr.classList?.contains('bg-sidebar') ||
        curr.style?.transform?.includes('translateY')) {
      candidate = curr;
      if (curr.classList?.contains('bg-sidebar') || curr.style?.transform?.includes('translateY')) {
        return curr;
      }
    }
    curr = curr.parentElement;
  }
  return candidate || btn.closest('.group\\/header, div[class*="group/header"]') || btn.parentElement?.parentElement;
}

function cleanHeaderActions(btn) {
  const row = findHeaderRow(btn);
  if (!row) return;

  const hideThreeDots = () => {
    const buttons = row.querySelectorAll('button');
    for (const b of buttons) {
      if (b === btn || b.classList?.contains('group/headerbtn') || b.matches?.('[class*="group/headerbtn"]')) {
        continue;
      }
      const hasPlus = b.querySelector('svg.lucide-plus, svg[class*="plus"], path[d*="M12 5"], path[d*="m12 5"], path[d*="M5 12"], path[d*="m5 12"], path[d*="12 5"], path[d*="5 12"]');
      const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).toLowerCase();
      const isPlus = hasPlus || /new|add|chat|conv|plus/.test(label);
      if (!isPlus) {
        b.style.setProperty('display', 'none', 'important');
        b.style.setProperty('width', '0px', 'important');
        b.style.setProperty('min-width', '0px', 'important');
        b.style.setProperty('max-width', '0px', 'important');
        b.style.setProperty('margin', '0px', 'important');
        b.style.setProperty('padding', '0px', 'important');
        b.style.setProperty('pointer-events', 'none', 'important');
        b.style.setProperty('opacity', '0', 'important');
        b.style.setProperty('visibility', 'hidden', 'important');

        if (b.parentElement && b.parentElement !== row && b.parentElement.children.length === 1) {
          b.parentElement.style.setProperty('display', 'none', 'important');
          b.parentElement.style.setProperty('width', '0px', 'important');
          b.parentElement.style.setProperty('min-width', '0px', 'important');
          b.parentElement.style.setProperty('margin', '0px', 'important');
          b.parentElement.style.setProperty('padding', '0px', 'important');
        }
      }
    }
  };

  hideThreeDots();
  if (!row.dataset.geminiCleaned) {
    row.dataset.geminiCleaned = "true";
    row.addEventListener('mouseenter', hideThreeDots);
    const obs = new MutationObserver(hideThreeDots);
    obs.observe(row, { childList: true, subtree: true });
    remember(row, obs);
  }
}

function isProjectExpanded(btn) {
  // 1. Check native SVG indicator inside btn
  const svgs = btn.querySelectorAll('svg');
  for (const svg of svgs) {
    const cls = ((svg.getAttribute('class') || '') + ' ' + (svg.className?.baseVal || '')).toLowerCase();
    if (cls.includes('rotate-90')) return true;
    if (cls.includes('rotate-0') || (cls.includes('rotate') && !cls.includes('90'))) return false;
    if (cls.includes('chevron-down') || cls.includes('arrow-down')) return true;
    if (cls.includes('chevron-right') || cls.includes('arrow-right')) return false;

    const path = svg.querySelector('path');
    const d = (path?.getAttribute('d') || '').toLowerCase();
    if (d.includes('6 9') || d.includes('m6 9')) return true;
    if (d.includes('9 18') || d.includes('m9 18')) return false;
    if (cls.includes('folder-open')) return true;
  }

  // 2. Check parent data-state or native aria attributes
  const parent = btn.parentElement;
  const parentState = parent?.getAttribute('data-state');
  if (parentState === 'open' || parentState === 'expanded') return true;
  if (parentState === 'closed' || parentState === 'collapsed') return false;

  // 3. Inspect virtualized list DOM in the scroller
  const row = findHeaderRow(btn);
  if (row && row.parentElement) {
    let next = row.nextElementSibling;
    while (next && (next.style?.display === 'none' || next.clientHeight === 0)) {
      next = next.nextElementSibling;
    }
    if (next) {
      if (next.matches?.('[data-testid="conversation-row-sidebar"]') ||
          next.querySelector?.('[data-testid="conversation-row-sidebar"]')) {
        return true;
      }
      if (next.matches?.('.bg-sidebar, .group\\/header, div[class*="group/header"]') ||
          next.querySelector?.(HEADERBTN_SELECTOR)) {
        return false;
      }
    }

    const matchY = (str) => {
      const m = str?.match(/translateY\(\s*([\d.]+)px\s*\)/);
      return m ? parseFloat(m[1]) : null;
    };
    const currentY = matchY(row.style?.transform);
    if (currentY !== null) {
      const siblings = Array.from(row.parentElement.children);
      let nextY = Infinity;
      let nextIsConv = false;
      for (const sib of siblings) {
        if (sib === row || sib.style?.display === 'none') continue;
        const y = matchY(sib.style?.transform);
        if (y !== null && y > currentY && y < nextY) {
          nextY = y;
          nextIsConv = sib.matches?.('[data-testid="conversation-row-sidebar"]') ||
                       !!sib.querySelector?.('[data-testid="conversation-row-sidebar"]');
        }
      }
      if (nextY !== Infinity) {
        if (nextIsConv) return true;
        if (nextY - currentY <= 45) return false;
      }
    }
  }

  return btn.dataset.projectExpanded !== 'false';
}

function updateProjectExpandedState(btn) {
  const expanded = isProjectExpanded(btn);
  btn.dataset.projectExpanded = expanded ? 'true' : 'false';
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

plugin.dom.observe(HEADERBTN_SELECTOR, (btn) => {
  updateProjectExpandedState(btn);
  alignSubheadingTitle(btn);
  cleanHeaderActions(btn);
  requestAnimationFrame(() => {
    updateProjectExpandedState(btn);
    alignSubheadingTitle(btn);
    cleanHeaderActions(btn);
  });
  setTimeout(() => {
    updateProjectExpandedState(btn);
    alignSubheadingTitle(btn);
    cleanHeaderActions(btn);
  }, 50);
  setTimeout(() => {
    updateProjectExpandedState(btn);
    alignSubheadingTitle(btn);
    cleanHeaderActions(btn);
  }, 200);

  const observer = new MutationObserver(() => {
    updateProjectExpandedState(btn);
    alignSubheadingTitle(btn);
    cleanHeaderActions(btn);
  });
  observer.observe(btn, { childList: true, subtree: true });
  observers.set(btn, observer);

  btn.addEventListener('click', () => {
    // Blur immediately on click to prevent focus from keeping the plus button visible
    btn.blur();
    const scroller = document.querySelector('[data-testid="conversation-list-sidebar"]');

    setTimeout(() => {
      btn.blur();
      updateProjectExpandedState(btn);
      alignSubheadingTitle(btn);
      cleanHeaderActions(btn);
      if (scroller) reorganizePinnedItems(scroller);
    }, 60);

    setTimeout(() => {
      btn.blur();
      updateProjectExpandedState(btn);
      if (scroller) reorganizePinnedItems(scroller);
    }, 250);
  });

  btn.addEventListener('mouseup', () => {
    btn.blur();
  });
});

plugin.dom.observe('[role="navigation"][aria-label="Sidebar"]', (sidebar) => {
  const onHover = (e) => {
    const row = e.target?.closest?.('.group\\/header, div[class*="group/header"], .bg-sidebar');
    if (row) {
      const headerBtn = row.querySelector(HEADERBTN_SELECTOR);
      if (headerBtn) cleanHeaderActions(headerBtn);
    }
  };
  sidebar.addEventListener('mouseover', onHover, { passive: true });
  observers.set(sidebar, { disconnect: () => sidebar.removeEventListener('mouseover', onHover) });
});

/* ---------------------------------------------------------------------------
 * Pinned conversations under project headers
 * ---------------------------------------------------------------------------
 * Antigravity keeps pinned conversations in a section of their own at the top
 * of the sidebar; Willow shows each one under the project it belongs to. The
 * list is virtualised — every row is placed by script out of an `items` array —
 * so this is the one part of the sidebar CSS cannot reach, and the array has to
 * be rewritten on its way into the component that renders it.
 *
 * Two rules keep that from wedging the renderer, which is what the first
 * attempt at this did:
 *
 *   1. Nothing here asks React to render. The wrapper is installed and takes
 *      effect on the host's own next render — and pinning, the act this exists
 *      for, always causes one. Forcing a render instead (dispatching into a
 *      hook queue, or firing a synthetic scroll on the element whose scroll
 *      handler runs this) feeds the observer that called it, and the renderer
 *      never reaches another frame.
 *   2. `fiber.type` is swapped and `fiber.elementType` is left alone. React
 *      reconciles children on elementType, so the fiber survives; swapping
 *      both makes every parent render see a changed type and rebuild the whole
 *      list from scratch — which drops the wrapper, so it is installed again,
 *      and again.
 *
 * Every pass below is idempotent, so the mutations a render causes settle
 * instead of feeding themselves.
 * ------------------------------------------------------------------------- */
const conversationProjectMap = new Map();

/**
 * The component holding the pinned and project state is found by its own source
 * text, since the compiler mangles names. `toString()` on a compiled component
 * is not cheap and this is asked once per render, so each function is judged
 * once and remembered.
 */
const pinnedStateOwners = new WeakMap();

function ownsPinnedState(type) {
  if (typeof type !== 'function') return false;
  let owns = pinnedStateOwners.get(type);
  if (owns === undefined) {
    let source = '';
    try {
      source = type.toString();
    } catch {
      source = '';
    }
    owns = source.includes('hasPinnedSection') || source.includes('section-pinned');
    pinnedStateOwners.set(type, owns);
  }
  return owns;
}

function findPinnedStateOwner(fiber) {
  for (let curr = fiber; curr; curr = curr.return) {
    if (ownsPinnedState(curr.type)) return curr;
  }
  return null;
}

function updateProjectMapFromFiber(fiber) {
  const owner = findPinnedStateOwner(fiber);
  if (!owner) return;
  readProjectMap(owner);
  // React keeps two fibers per component and renders them alternately, so the
  // one this was reached from can be a render behind. Reading both costs a
  // second walk over the same hooks and cannot go stale.
  if (owner.alternate) readProjectMap(owner.alternate);
}

function readProjectMap(cJb) {
  let h = cJb.memoizedState;
  while (h) {
    const val = h.memoizedState;
    if (Array.isArray(val)) {
      if (val.length > 0 && val[0]?.cascadeId) {
        for (const c of val) {
          const ws = c.summary?.workspaces?.[0];
          const uri = ws?.workspaceFolderAbsoluteUri || ws?.gitRootAbsoluteUri;
          if (c.cascadeId && uri) {
            const name = decodeURIComponent(uri.replace(/\/+$/, '').split('/').pop());
            if (name) conversationProjectMap.set(c.cascadeId, name);
          }
        }
      }
      if (val.length > 0 && val[0] && typeof val[0] === 'object' && (val[0].label || val[0].title) && Array.isArray(val[0].items)) {
        for (const g of val) {
          const projName = g.label || g.title;
          const projId = g.id;
          if (Array.isArray(g.items)) {
            for (const it of g.items) {
              const id = typeof it === 'string' ? it : (it?.cascadeId || it?.id);
              if (id) {
                if (projName) conversationProjectMap.set(id, projName);
                if (projId) conversationProjectMap.set(id + ':groupId', projId);
              }
            }
          }
        }
      }
    }
    h = h.next;
  }
}

function transformItems(items, fiber) {
  if (!Array.isArray(items) || items.length === 0) return items;

  const hasPinned = items.some(it => it && (it.id === 'section-pinned' || it.groupId === 'pinned'));
  if (!hasPinned) return items;

  if (fiber) updateProjectMapFromFiber(fiber);

  const pinnedRows = [];
  const baseItems = [];

  for (const it of items) {
    if (!it) continue;
    if (it.id === 'section-pinned' || it.id === 'spacer-section-pinned' || it.id === 'spacer-pinned-header') {
      continue;
    }
    if (it.type === 'row' && it.groupId === 'pinned') {
      pinnedRows.push(it);
      const cid = it.cascadeId || it.id;
      if (cid) conversationProjectMap.set(cid + ':pinned', true);
    } else {
      baseItems.push(it);
    }
  }

  if (pinnedRows.length === 0) return baseItems;

  const pinnedIds = new Set(pinnedRows.map(r => r.cascadeId || r.id));
  const cleanBase = baseItems.filter(it => !(it.type === 'row' && pinnedIds.has(it.cascadeId || it.id)));

  for (const it of cleanBase) {
    if (it && it.type === 'row') {
      const cid = it.cascadeId || it.id;
      if (cid && !pinnedIds.has(cid)) {
        conversationProjectMap.delete(cid + ':pinned');
      }
    }
  }

  const projectHeaders = new Map();
  for (let i = 0; i < cleanBase.length; i++) {
    const it = cleanBase[i];
    if (it && it.type === 'header') {
      const projId = (it.id || '').replace(/^header-/, '');
      if (it.label) projectHeaders.set(it.label.toLowerCase(), { index: i, header: it, projId });
      if (projId) projectHeaders.set(projId.toLowerCase(), { index: i, header: it, projId });
    }
  }

  const pinnedByHeaderIndex = new Map();
  const unassignedPinned = [];

  for (const pRow of pinnedRows) {
    const cid = pRow.cascadeId || pRow.id;
    const projName = conversationProjectMap.get(cid);
    const directGroupId = conversationProjectMap.get(cid + ':groupId');

    let matched = null;
    if (directGroupId && projectHeaders.has(directGroupId.toLowerCase())) {
      matched = projectHeaders.get(directGroupId.toLowerCase());
    } else if (projName && projectHeaders.has(projName.toLowerCase())) {
      matched = projectHeaders.get(projName.toLowerCase());
    } else if (projName) {
      for (const [key, entry] of projectHeaders) {
        if (key.includes(projName.toLowerCase()) || projName.toLowerCase().includes(key)) {
          matched = entry;
          break;
        }
      }
    }

    if (matched) {
      if (!pinnedByHeaderIndex.has(matched.index)) {
        pinnedByHeaderIndex.set(matched.index, []);
      }
      pinnedByHeaderIndex.get(matched.index).push({
        ...pRow,
        groupId: matched.projId,
        isIndented: false
      });
    } else {
      unassignedPinned.push({
        ...pRow,
        groupId: 'default',
        isIndented: false
      });
    }
  }

  const result = [];
  for (let i = 0; i < cleanBase.length; i++) {
    const it = cleanBase[i];
    result.push(it);

    if (pinnedByHeaderIndex.has(i)) {
      if (!it.isCollapsed) {
        result.push(...pinnedByHeaderIndex.get(i));
      }
    }

    if (unassignedPinned.length > 0 && it && it.type === 'section-header' && (it.id === 'section-recents' || (it.title || '').toLowerCase() === 'recents')) {
      if (!it.isCollapsed) {
        result.push(...unassignedPinned);
        unassignedPinned.length = 0;
      }
    }
  }

  if (unassignedPinned.length > 0) {
    result.unshift(...unassignedPinned);
  }

  return result;
}

/**
 * The array lives on a component above the scroller. Which one is not fixed —
 * the compiler decides how many wrappers sit in between — so the nearest
 * function component whose props carry an `items` array is taken, a few levels
 * up at most.
 */
function listFiberFor(scroller) {
  let fiber = plugin.react.getFiber(scroller);
  for (let depth = 0; fiber && depth < 6; depth += 1, fiber = fiber.return) {
    if (typeof fiber.type === 'function' && Array.isArray(fiber.memoizedProps?.items)) return fiber;
  }
  return null;
}

/** The fibers whose type this replaced, so switching the plugin off puts them back. */
const wrappedFibers = new Set();
const ORIGINAL = '__geminiOriginal';

function wrapItems(fiber) {
  const original = fiber.type;
  if (typeof original !== 'function' || original[ORIGINAL]) return;

  const wrapper = function (props, secondArg) {
    const items = props && Array.isArray(props.items) ? transformItems(props.items, fiber) : null;
    // transformItems hands back the array it was given when nothing is pinned,
    // and then the component is called with the props object it would have had.
    const next = items && items !== props.items ? { ...props, items } : props;
    return original.call(this, next, secondArg);
  };
  wrapper[ORIGINAL] = original;
  wrapper.displayName = original.displayName || original.name;

  // type is what React calls; elementType is what it reconciles on. Rule 2.
  fiber.type = wrapper;
  if (fiber.alternate) fiber.alternate.type = wrapper;
  wrappedFibers.add(fiber);
}

function unwrapItems() {
  for (const fiber of wrappedFibers) {
    for (const target of [fiber, fiber.alternate]) {
      const original = target?.type?.[ORIGINAL];
      if (original) target.type = original;
    }
  }
  wrappedFibers.clear();
}

/**
 * Installing the wrapper is the whole of it. The reordered list appears on the
 * host's next render of that component — pinning, unpinning, selecting a
 * conversation and scrolling all cause one — and asking for a render from here
 * is what made this a loop. Rule 1.
 */
function reorganizePinnedItems(scroller) {
  if (!scroller?.isConnected) return;
  const fiber = listFiberFor(scroller);
  if (fiber) wrapItems(fiber);
}

/*
 * One pass per frame at most. A pass writes only styles and attributes, never a
 * child of the scroller, which is all the observer below watches — so a pass
 * cannot schedule the next one.
 */
let sidebarPassScheduled = false;

function sidebarPass(scroller) {
  reorganizePinnedItems(scroller);
  document.querySelectorAll(HEADERBTN_SELECTOR).forEach((btn) => {
    updateProjectExpandedState(btn);
    alignSubheadingTitle(btn);
  });
  document.querySelectorAll('[data-testid="conversation-row-sidebar"]').forEach(hideConversationTime);
}

function scheduleSidebarPass(scroller) {
  if (sidebarPassScheduled) return;
  sidebarPassScheduled = true;
  requestAnimationFrame(() => {
    sidebarPassScheduled = false;
    if (scroller.isConnected) sidebarPass(scroller);
  });
}

plugin.dom.observe('[data-testid="conversation-list-sidebar"]', (scroller) => {
  const onUpdate = () => scheduleSidebarPass(scroller);
  scroller.addEventListener('scroll', onUpdate, { passive: true });
  const scrollerObs = new MutationObserver(onUpdate);
  scrollerObs.observe(scroller, { childList: true });
  remember(scroller, {
    disconnect: () => {
      scroller.removeEventListener('scroll', onUpdate);
      scrollerObs.disconnect();
    }
  });

  sidebarPass(scroller);
});

function hideConversationTime(row) {
  if (!row) return;
  const resting = row.querySelector('.pointer-events-auto > div > div:last-child, [class*="group-hover:opacity-0"]');
  if (!resting) return;

  const isPinned = row.getAttribute('data-pinned') === 'true' || row.closest('[data-title="Pinned Conversations"]') !== null;
  const hasUnread = !!resting.querySelector('[data-testid="status-unread-dot"]');
  const hasSpinner = !!resting.querySelector('svg, [class*="animate-spin"]');

  if (!isPinned && !hasUnread && !hasSpinner) {
    resting.style.setProperty('display', 'none', 'important');
  } else {
    resting.style.removeProperty('display');
    for (const child of Array.from(resting.children)) {
      if (!child.matches('[data-testid="status-unread-dot"]') &&
          !child.querySelector('[data-testid="status-unread-dot"]') &&
          !child.matches('svg') &&
          !child.querySelector('svg') &&
          !child.matches('[class*="animate-spin"]') &&
          !child.querySelector('[class*="animate-spin"]')) {
        child.style.setProperty('display', 'none', 'important');
      }
    }
    for (const node of Array.from(resting.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        node.textContent = '';
      }
    }
  }
}

plugin.dom.observe('[data-testid="conversation-row-sidebar"]', (row) => {
  hideConversationTime(row);
  const obs = new MutationObserver(() => hideConversationTime(row));
  obs.observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-pinned'] });
  remember(row, obs);
});

plugin.dom.observe('[data-testid="conversation-kebab"]', (kebab) => {
  const wrapper = kebab.parentElement;
  if (wrapper && wrapper.style) {
    wrapper.style.setProperty('background', 'transparent', 'important');
    wrapper.style.setProperty('background-image', 'none', 'important');
    wrapper.style.setProperty('box-shadow', 'none', 'important');
  }
});

/* ---------------------------------------------------------------------------
 * Conversation row kebab menu enhancer: adds Willow Pin & Archive actions
 * ------------------------------------------------------------------------- */
let activeConversationRow = null;

// Track the row whose kebab, context menu, or mouseover was activated
document.addEventListener('pointerdown', (e) => {
  const kebab = e.target.closest('[data-testid="conversation-kebab"]');
  if (kebab) {
    activeConversationRow = kebab.closest('[data-testid="conversation-row-sidebar"]');
  }
  const row = e.target.closest('[data-testid="conversation-row-sidebar"]');
  if (row) {
    activeConversationRow = row;
  }
}, true);

document.addEventListener('click', (e) => {
  const kebab = e.target.closest('[data-testid="conversation-kebab"]');
  if (kebab) {
    activeConversationRow = kebab.closest('[data-testid="conversation-row-sidebar"]');
  }
  const row = e.target.closest('[data-testid="conversation-row-sidebar"]');
  if (row) {
    activeConversationRow = row;
  }
}, true);

document.addEventListener('mouseover', (e) => {
  const row = e.target.closest('[data-testid="conversation-row-sidebar"]');
  if (row) {
    activeConversationRow = row;
  }
}, { passive: true, capture: true });

document.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('[data-testid="conversation-row-sidebar"]');
  if (row) {
    activeConversationRow = row;
  }
}, true);

function closeActiveMenu(menu) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  setTimeout(() => {
    if (menu?.isConnected) {
      document.body.click();
    }
  }, 20);
}

const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 -960 960 960" fill="currentColor" class="shrink-0"><path d="m640-480 80 80v40H520v240l-40 40-40-40v-240H240v-40l80-80v-280h-40v-40h400v40h-40v280Zm-286 80h252l-46-46v-314H400v314l-46 46Zm126 0Z"/></svg>`;

const UNPIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 -960 960 960" fill="currentColor" class="shrink-0"><path d="M660-820v60H620v307l-60-60V-760H400v87l-64.31-64.31l-20.31-43H300V-820H660ZM480-90l-30-30V-340H268.46v-60L340-471.54v-62.92l-254.77-256l42.15-42.15L817.23-142.77l-43.38,42.15L534.46-340H510v220L480-90ZM354-400H475.23l-74-73.23L400-446l-46,46ZM480-593ZM401.23-473.23Z"/></svg>`;

const ARCHIVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 -960 960 960" fill="currentColor" class="shrink-0"><path d="M480-256.16L626.15-402.31L584-444.46l-74,74v-178H450v178l-74-74l-42.15,42.15L480-256.16ZM200-643.85v431.54q0,5.39 3.46,8.85t8.85,3.46H747.69q5.39,0 8.85-3.46t3.46-8.85V-643.85H200ZM215.39-140q-29.92,0-52.65-22.73T140-215.39V-679.77q0-12.85 4.12-24.5t12.35-21.5l56.15-67.92q9.85-12.85 24.62-19.58T268.46-820h422.3q16.46,0 31.42,6.73T747-793.69L803.54-725q8.23,9.85 12.35,21.69T820-678.61v463.23q0,29.92-22.73,52.65T744.61-140H215.39Zm0.23-563.84H744l-43.62-51.92q-1.92-1.92-4.42-3.08T690.77-760H268.85q-2.69,0-5.19,1.15t-4.42,3.08l-43.62,51.92ZM480-421.92Z"/></svg>`;

function createConvMenuItem(id, iconSvg, text, onClick) {
  const item = document.createElement('div');
  item.id = id;
  item.setAttribute('role', 'menuitem');
  item.setAttribute('tabindex', '-1');
  item.className = 'gemini-menu-item';
  item.innerHTML = `
    <span class="gemini-menu-item-slot">${iconSvg}</span>
    <span class="gemini-menu-item-label">${text}</span>
    <span aria-hidden="true" class="gemini-menu-item-trailing"></span>
  `;
  item.addEventListener('click', onClick);
  return item;
}

function enhanceConversationMenu(menu) {
  // Ignore model selector, plus menu, or nested submenus that are not conversation actions
  if (menu.hasAttribute('data-gemini-plus-menu') || 
      menu.querySelector('[data-gemini-tools]') ||
      menu.querySelector('[data-gemini-row]') ||
      menu.querySelector('[data-gemini-label]') ||
      isPlusMenu(menu) ||
      menu.querySelector('[data-testid="model-selector-panel"]') || 
      menu.hasAttribute('data-nested')) {
    return;
  }

  const isConvTrigger = document.querySelector('[data-testid="conversation-kebab"][aria-expanded="true"]');
  const hasConvItems = !!menu.querySelector('[data-testid*="conversation-"]') ||
                       Array.from(menu.querySelectorAll('[role="menuitem"]')).some(el => {
                         const t = (el.textContent || '').trim().toLowerCase();
                         return t === 'rename' || t === 'delete' || t.startsWith('pin') || t.startsWith('unpin');
                       });

  if (!hasConvItems && !isConvTrigger) return;

  const row = activeConversationRow || 
              isConvTrigger?.closest('[data-testid="conversation-row-sidebar"]') ||
              document.querySelector('[data-testid="conversation-row-sidebar"]:hover');

  if (!row) return;

  menu.setAttribute('data-gemini-conversation-menu', 'true');
  menu.classList.remove('animate-slideIn');

  if (!row) return;

  const pinBtn = row.querySelector('[data-testid="conversation-pin-button"]');
  const archiveBtn = row.querySelector('[data-testid="conversation-archive-button"]');

  const isPinned = row.getAttribute('data-pinned') === 'true' || 
                   pinBtn?.getAttribute('aria-label')?.toLowerCase()?.includes('unpin') ||
                   row.closest('[data-title="Pinned Conversations"]') !== null;

  // 1. Injected Pin item
  let pinItem = menu.querySelector('#gemini-menu-item-pin');
  if (!pinItem && pinBtn) {
    pinItem = createConvMenuItem(
      'gemini-menu-item-pin',
      isPinned ? UNPIN_SVG : PIN_SVG,
      isPinned ? 'Unpin' : 'Pin',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        pinBtn.click();
        closeActiveMenu(menu);
        // The host's own click handler re-renders the list, and the wrapper is
        // already installed by then, so there is nothing to chase here.
      }
    );

    const renameItem = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(el => 
      el.id !== 'gemini-menu-item-pin' && el.id !== 'gemini-menu-item-archive' && el.textContent?.toLowerCase()?.includes('rename')
    );
    if (renameItem) {
      menu.insertBefore(pinItem, renameItem);
    } else {
      menu.insertBefore(pinItem, menu.firstElementChild);
    }
  } else if (pinItem) {
    const slot = pinItem.querySelector('.gemini-menu-item-slot');
    const label = pinItem.querySelector('.gemini-menu-item-label');
    if (slot) slot.innerHTML = isPinned ? UNPIN_SVG : PIN_SVG;
    if (label) label.textContent = isPinned ? 'Unpin' : 'Pin';
  }

  // 2. Injected Archive item
  let archiveItem = menu.querySelector('#gemini-menu-item-archive');
  if (!archiveItem && archiveBtn) {
    archiveItem = createConvMenuItem(
      'gemini-menu-item-archive',
      ARCHIVE_SVG,
      'Archive',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        archiveBtn.click();
        closeActiveMenu(menu);
      }
    );

    const deleteItem = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(el => 
      el.id !== 'gemini-menu-item-pin' && el.id !== 'gemini-menu-item-archive' && el.textContent?.toLowerCase()?.includes('delete')
    );
    if (deleteItem) {
      menu.insertBefore(archiveItem, deleteItem);
    } else {
      menu.appendChild(archiveItem);
    }
  }
}

plugin.dom.observe('[role="menu"]', (menu) => {
  enhanceConversationMenu(menu);
  const observer = new MutationObserver(() => enhanceConversationMenu(menu));
  observer.observe(menu, { childList: true });
  observers.set(menu, observer);
});

function onGlobalKeyDown(e) {
  const isModifier = isMac ? e.metaKey : e.ctrlKey;
  if (isModifier && e.shiftKey && e.key.toLowerCase() === "o") {
    const btn = document.querySelector(NEW_CONV_SELECTOR);
    if (btn) {
      e.preventDefault();
      btn.click();
    }
  }
}

window.addEventListener("keydown", onGlobalKeyDown);

plugin.onDispose(() => {
  window.removeEventListener("keydown", onGlobalKeyDown);

  // The three rows and the block that holds them inside the conversation list,
  // and the fade drawn over the top of it.
  document.getElementById("gemini-new-project-button")?.remove();
  document.getElementById("gemini-display-options-button")?.remove();
  document.getElementById("gemini-scheduled-tasks-button")?.remove();
  document.getElementById("gemini-scroll-nav")?.remove();
  document.getElementById("gemini-top-fade")?.remove();
  document.querySelectorAll(".gemini-logo-btn, .willow-sidenav-text, .gemini-sidebar-expand-rail, #gemini-experience-switch").forEach((el) => el.remove());
  document.querySelectorAll('[role="navigation"][aria-label="Sidebar"]').forEach((el) => el.removeAttribute("data-collapsed"));

  for (const [element, observer] of observers) {
    observer.disconnect();
    if (element.matches && element.matches(NEW_CONV_SELECTOR)) {
      element.removeAttribute("data-shortcut");
      /* Older builds of this plugin marked the route here; clear it so a
       * left-over attribute cannot outlive them on a React element that has
       * never heard of it. */
      element.removeAttribute("data-active");
    } else if (element.matches && element.matches(PILL_SELECTOR)) {
      const node = nameNode(element);
      const full = element.dataset.fullModelName;
      if (node && full) node.data = full;
      delete element.dataset.fullModelName;
    }
  }
  observers.clear();
  unwrapItems();
});

/* ---------------------------------------------------------------------------
 * The prompt box's plus menu
 * ---------------------------------------------------------------------------
 * Antigravity's plus menu holds the places context comes from — Media,
 * Mentions, Actions, and, when they are switched on, Browser and Screen
 * Recording. Its tools are not in there at all: they are reached by typing a
 * slash in the prompt box, which opens a typeahead over Goal, Boost, and the
 * rest. Willow's plus menu (features/chat/src/composer/PlusDropdownMenu.tsx)
 * keeps its tools in the menu — four on the card, the remainder behind "More
 * tools" — so this puts Antigravity's there too.
 *
 * Which tools those are is not something a plugin can know. The language
 * server assembles the set out of the workspace's workflows, its MCP servers'
 * prompts, and the built-in commands, so it differs per workspace and changes
 * without the app being rebuilt. It is therefore read from the component that
 * already has it: Antigravity's composer is handed a `getSlashCommandItems`
 * prop. Nothing below invents a command. All it decides is the order, the
 * glyph, and which four are promoted to the card.
 *
 * Picking a tool types its command into the prompt box and chooses it from
 * Antigravity's own typeahead, because that is what turns "/goal" from four
 * characters into the command the agent is actually sent. Building that node
 * directly means reaching four private Lexical helpers and a protobuf schema,
 * and getting any of it subtly wrong sends a message that looks right and does
 * nothing.
 *
 * styles/plus-menu.css draws all of it. Everything here either marks an element
 * for that stylesheet or is a row the stylesheet cannot invent.
 * ------------------------------------------------------------------------- */

const PLUS_TRIGGER = 'button[aria-label="Add context"]';
const INPUT_BOX = '[data-testid="agent-input-box"]';
/* Antigravity's slash and mention typeahead, and the label span inside a row. */
const TYPEAHEAD = "[data-mention-menu]";
const OPTION = '[role="option"]';
const OPTION_LABEL = '[data-testid="menu-option-label"]';

/**
 * The glyphs Willow draws from Google Symbols rather than Luminous Symbols.
 * The two faces are subsets and neither is a superset of the other, so which
 * face a name belongs to is a property of the name, not of the row it is on.
 * Every ligature below is one Willow itself asks for; a name absent from the
 * subset would render as its own letters rather than fall through to a
 * fallback icon, which is why the list is not extended by guesswork.
 */
const GOOGLE_SYMBOLS = new Set([
  "more_horiz",
  "computer",
  "school",
  "drive",
  "photos",
  "web",
  "edit_note",
  "terminal"
]);

/** Willow's glyph for each of Antigravity's own context rows, by label. */
const CONTEXT_GLYPHS = {
  "Media": "attach_file",
  "Mentions": "docs",
  "Files": "docs",
  "Docs": "docs",
  "Actions": "extension",
  "Browser": "chrome",
  "Screen Recording": "computer",
  "Terminal": "terminal"
};

/**
 * Glyphs for the tools. Keyed by command name reduced to its letters, longest
 * and most specific first, since a name is matched by prefix as well as whole:
 * a workspace's own "boost-review" workflow should draw Boost's glyph rather
 * than the fallback.
 */
const TOOL_GLYPHS = {
  "deepresearch": "deep_research",
  "guidedlearning": "guided_learning",
  "computeruse": "computer",
  "notebook": "notebook",
  "research": "deep_research",
  "schedule": "assignment",
  "canvas": "canvas",
  "search": "search_activity",
  "boost": "group",
  "goal": "flag",
  "plan": "edit_note",
  "learn": "guided_learning",
  "image": "image_create",
  "video": "movie",
  "music": "music",
  "skill": "school",
  "browser": "chrome"
};

/** Anything the map above does not name. Willow's own generic tool glyph. */
const FALLBACK_GLYPH = "extension";

/**
 * Willow's card carries exactly four tool rows and hides the rest behind "More
 * tools". These four are preferred for those places when the workspace offers
 * them; whatever is missing is made up from the front of the remaining list.
 */
const FEATURED = ["goal", "boost", "plan", "schedule"];
const FEATURED_COUNT = 4;

const DEFAULT_TOOLS = [
  { name: "goal", label: "Goal", description: "Long-running tasks with subagents", glyph: "flag" },
  { name: "boost", label: "Boost", description: "Deep reasoning and multi-perspective thinking", glyph: "group" },
  { name: "plan", label: "Plan", description: "Implementation plan mode", glyph: "edit_note" },
  { name: "schedule", label: "Schedule", description: "Schedule recurring or timer tasks", glyph: "assignment" }
];

/** Letters only, so "computer-use", "computer_use", and "Computer Use" agree. */
function glyphKey(name) {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function isSkillsName(name) {
  if (!name || typeof name !== "string") return false;
  const k = glyphKey(name);
  return k === "skill" || k === "skills" || k.startsWith("skill");
}

function glyphFor(name) {
  const key = glyphKey(name);
  if (!key) return FALLBACK_GLYPH;
  for (const [candidate, glyph] of Object.entries(TOOL_GLYPHS)) {
    if (key.startsWith(candidate) || `${key}s` === candidate) return glyph;
  }
  return FALLBACK_GLYPH;
}

/**
 * Which popup this is. Base UI portals a menu far from its trigger and links
 * the two with `aria-controls`, pointing at an id on the popup or on one of the
 * positioner elements above it — so the popup is named by walking up and asking
 * who controls each id on the way. This is the runtime's own way of doing it
 * (packages/runtime/src/world/ui/menu.ts).
 */
function triggerFor(popup) {
  for (let node = popup; node; node = node.parentElement) {
    if (!node.id) continue;
    const byControls = document.querySelector(`[aria-controls="${CSS.escape(node.id)}"]`);
    if (byControls) return byControls;
  }
  return null;
}

function isPlusMenu(popup) {
  const trigger = triggerFor(popup);
  return !!trigger && trigger.matches(PLUS_TRIGGER);
}

/**
 * The composer's props. Antigravity's bundle is Closure-compiled, so the
 * component's name is a mangled two letters and searching for it is worthless —
 * but prop names survive, and the composer is the one component inside the
 * prompt box holding both `getSlashCommandItems` and `lexicalRef`. The editor
 * component is handed the first of those too, hence asking for both.
 */
function composerProps() {
  const box = document.querySelector(INPUT_BOX);
  if (!box) return undefined;
  const fiber = plugin.react.findChild(
    box,
    (candidate) =>
      typeof candidate.memoizedProps?.getSlashCommandItems === "function" && !!candidate.memoizedProps?.lexicalRef,
    40
  );
  return fiber?.memoizedProps ?? undefined;
}

/**
 * One tool, as this file needs it: the text to show, the text to type, and the
 * glyph to draw.
 *
 * `getSlashCommandItems` returns three kinds of thing concatenated, and the
 * types that would tell them apart are compiled away, so they are told apart by
 * shape. A built-in slash command carries an `info` with the name the agent is
 * sent and a `title` for display; an MCP prompt carries a `serverName`; a
 * workflow carries a `path`. The last two are named by `name` alone.
 */
function toolFrom(item) {
  if (!item || typeof item !== "object") return undefined;
  const name = typeof item.info?.name === "string" ? item.info.name : item.name;
  if (typeof name !== "string" || !name.trim()) return undefined;
  const label = typeof item.title === "string" && item.title.trim() ? item.title.trim() : name.trim();
  const description = typeof item.description === "string" ? item.description.trim() : "";
  return { name: name.trim(), label, description, glyph: glyphFor(name) };
}

/* The resolved list, and the fetch in flight. `getSlashCommandItems` asks the
 * language server, so it is asked once and the answer kept: the menu opens and
 * closes far more often than a workspace's workflows change, and a card that
 * fills a frame late reads as a bug. A failed fetch leaves the cache cold so
 * the next open tries again. */
let tools;
let fetching;

function ensureTools(props) {
  if (tools) return Promise.resolve(tools);
  if (!fetching) {
    fetching = Promise.resolve()
      .then(() => props.getSlashCommandItems())
      .then((items) => {
        const seen = new Set();
        tools = [];
        for (const item of Array.isArray(items) ? items : []) {
          const tool = toolFrom(item);
          if (!tool || isSkillsName(tool.name) || isSkillsName(tool.label) || seen.has(tool.label.toLowerCase())) continue;
          seen.add(tool.label.toLowerCase());
          tools.push(tool);
        }
        return tools;
      })
      .catch(() => [])
      .finally(() => {
        fetching = undefined;
      });
  }
  return fetching;
}

/**
 * What to type to reach a tool. Antigravity matches a typeahead query against
 * the label it renders, lowercased with whitespace and a little punctuation
 * removed, and the regex that opens the typeahead at all refuses whitespace and
 * the characters stripped below. So the query is the label's own first word —
 * not the command's name, which is allowed to differ from it: "computer_use"
 * would never match a row labelled "Computer Use".
 */
function queryFor(tool) {
  const clean = (text) => text.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9_.-]/g, "");
  return clean(tool.label) || clean(tool.name);
}

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Base UI closes on Escape, which is also how the runtime's own menus close. */
function closeMenu(popup) {
  popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

/** Base UI hands focus back to the trigger as the popup unmounts, so wait it out. */
async function untilClosed(popup) {
  for (let step = 0; step < 24 && popup.isConnected; step += 1) await wait(16);
  await wait(16);
}

function caretToEnd(root) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * The prompt box's editable root. Nothing marks it — no test id, no role — but
 * Lexical stamps `__lexicalEditor` on whichever element it owns, so that is what
 * identifies it, and it hands over the editor itself at the same time. Anything
 * else editable inside the prompt box is not the prompt.
 */
function editorRoot() {
  const box = document.querySelector(INPUT_BOX);
  if (!box) return undefined;
  let fallback;
  for (const node of box.querySelectorAll("[contenteditable]")) {
    if (!node.isContentEditable) continue;
    if (node.__lexicalEditor) return node;
    fallback = fallback ?? node;
  }
  return fallback;
}

/**
 * Type the command. `execCommand` is deprecated and used deliberately: it
 * produces the `beforeinput` event Lexical builds its own edit from, which is
 * the difference between text Antigravity's typeahead reacts to and text
 * written straight into the DOM, which it never sees.
 *
 * Whether a space comes first is Antigravity's own rule: its typeahead opens on
 * a slash only at the start of the prompt or after whitespace, and its own plus
 * menu prefixes a space for the same reason. Antigravity reads that off an
 * `isConvoInputEmpty` prop; this asks the prompt itself, which cannot be a
 * render behind.
 */
function insert(props, text) {
  const root = editorRoot();
  if (!root) return false;
  const editor = props?.lexicalRef?.current ?? root.__lexicalEditor;
  if (editor && typeof editor.focus === "function") editor.focus();
  else root.focus();
  if (!root.contains(window.getSelection()?.anchorNode ?? null)) caretToEnd(root);
  const before = root.textContent ?? "";
  document.execCommand("insertText", false, before.trim() ? ` ${text}` : text);
  return (root.textContent ?? "") !== before;
}

/** Antigravity's own normaliser, so a row that matched the query matches here. */
const normalise = (text) => text.replace(/[*…\s"]/g, "").toLowerCase();

/**
 * Choose the tool out of Antigravity's typeahead. The rows handle
 * `onClickCapture`, so a click dispatched at one is enough — React runs the
 * capture phase down the path to the target either way. Enter would do it too
 * and is not used: if the typeahead has closed by then, Enter sends the
 * message.
 */
async function choose(label) {
  const wanted = normalise(label);
  for (let step = 0; step < 150; step += 1) {
    for (const option of document.querySelectorAll(`${TYPEAHEAD} ${OPTION}`)) {
      const text = option.querySelector(OPTION_LABEL)?.textContent ?? "";
      if (normalise(text) !== wanted) continue;
      option.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    }
    await wait(16);
  }
  // The typeahead never offered it. The command is typed and its menu is open,
  // so the prompt box is left exactly as it would be had the user typed it.
  return false;
}

async function pick(popup, tool) {
  const props = composerProps();
  const query = queryFor(tool);
  if (!query) return;
  closeMenu(popup);
  await untilClosed(popup);
  // The editor may still be handing focus back and forth with the trigger, so
  // typing is attempted until the text actually lands rather than once.
  let typed = false;
  for (let step = 0; step < 8 && !typed; step += 1) {
    typed = insert(props, `/${query}`);
    if (!typed) await wait(16);
  }
  if (typed) await choose(tool.label);
}

/**
 * A row. The host's own menu-item classes come along so that a row still reads
 * as a row if this plugin's stylesheet is ever missing, and because that is what
 * the runtime's own injected menu entries wear. Everything the Gemini look needs
 * on top is in styles/plus-menu.css, addressed through these marks.
 */
function row(kind, glyph, label, extra) {
  return plugin.ui.element(
    "div",
    {
      role: "menuitem",
      tabindex: "-1",
      class: plugin.ui.classes.menuItem,
      "data-gemini-row": kind,
      "data-gemini-glyph": glyph,
      "data-gemini-glyph-family": GOOGLE_SYMBOLS.has(glyph) ? "google-symbols" : undefined,
      ...extra
    },
    [plugin.ui.element("span", { "data-gemini-label": "", text: label })]
  );
}

/* ---------------------------------------------------------------------------
 * Prompt Box Multiline Expansion & Willow ToolChip State
 * ------------------------------------------------------------------------- */
let selectedToolState = null;

function getSelectedTool() {
  return selectedToolState || window.__bettergravity_selected_tool || null;
}

function setSelectedTool(tool) {
  selectedToolState = tool;
  window.__bettergravity_selected_tool = tool;
}

const TOOL_CHIP_LABELS = {
  images: "Images",
  image: "Images",
  createimage: "Images",
  video: "Videos",
  videos: "Videos",
  createvideo: "Videos",
  music: "Music",
  createmusic: "Music",
  canvas: "Canvas",
  research: "Deep research",
  deepresearch: "Deep research",
  learn: "Learn",
  guidedlearning: "Learn",
  plan: "Plan",
  goal: "Goal",
  computeruse: "Computer Use",
  "computer-use": "Computer Use",
  createpet: "Create pet",
  "create-pet": "Create pet",
  createskill: "Create skill",
  "create-skill": "Create skill",
  subagents: "Sub-agents",
  "sub-agents": "Sub-agents",
  personalintelligence: "Personal Intelligence",
  "personal-intelligence": "Personal Intelligence",
  schedule: "Schedule",
  boost: "Boost",
  browser: "Browser"
};

const TOOL_CHIP_GLYPHS = {
  images: "image_create",
  image: "image_create",
  createimage: "image_create",
  video: "movie",
  videos: "movie",
  createvideo: "movie",
  music: "music",
  createmusic: "music",
  canvas: "canvas",
  research: "deep_research",
  deepresearch: "deep_research",
  learn: "guided_learning",
  guidedlearning: "guided_learning",
  plan: "edit_note",
  goal: "flag",
  computeruse: "computer",
  "computer-use": "computer",
  createpet: "pets",
  "create-pet": "pets",
  createskill: "school",
  "create-skill": "school",
  subagents: "group",
  "sub-agents": "group",
  personalintelligence: "person",
  "personal-intelligence": "person",
  schedule: "assignment",
  boost: "group",
  browser: "chrome"
};

function chipLabelFor(tool) {
  const key = glyphKey(tool.name || tool.label || "");
  if (TOOL_CHIP_LABELS[key]) return TOOL_CHIP_LABELS[key];
  if (tool.chipLabel) return tool.chipLabel;
  return tool.label || tool.name;
}

function chipGlyphFor(tool) {
  const key = glyphKey(tool.name || tool.label || "");
  if (TOOL_CHIP_GLYPHS[key]) return TOOL_CHIP_GLYPHS[key];
  return tool.glyph || glyphFor(tool.name || tool.label);
}

function createToolChipElement(tool) {
  const chipLabel = chipLabelFor(tool);
  const glyph = chipGlyphFor(tool);
  const isGoogleSymbols = GOOGLE_SYMBOLS.has(glyph);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gemini-tool-chip";
  btn.setAttribute("data-gemini-tool-chip", "");
  btn.setAttribute("aria-label", `Deselect ${chipLabel}`);

  const inner = document.createElement("span");
  inner.className = "gemini-tool-chip-inner";

  const icon = document.createElement("span");
  icon.className = `gemini-tool-chip-icon${isGoogleSymbols ? " gemini-symbols-font" : ""}`;
  icon.setAttribute("data-gemini-glyph", glyph);
  icon.textContent = glyph;

  const label = document.createElement("span");
  label.className = "gemini-tool-chip-label";
  label.textContent = chipLabel;

  const close = document.createElement("span");
  close.className = "gemini-tool-chip-close";
  close.textContent = "close";

  inner.appendChild(icon);
  inner.appendChild(label);
  inner.appendChild(close);
  btn.appendChild(inner);

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    deselectTool();
  });

  return btn;
}

function mountToolChip(box, tool) {
  if (!box) box = document.querySelector(INPUT_BOX);
  if (!box) return;
  const card = box.querySelector(".bg-card");
  if (!card) return;

  const targetLabel = chipLabelFor(tool);
  const targetGlyph = chipGlyphFor(tool);

  const chips = box.querySelectorAll("[data-gemini-tool-chip]");
  if (chips.length > 0) {
    const existing = chips[0];
    for (let i = 1; i < chips.length; i++) chips[i].remove();

    if (existing.parentElement === card) {
      const curLabel = existing.querySelector(".gemini-tool-chip-label")?.textContent;
      const curGlyph = existing.querySelector(".gemini-tool-chip-icon")?.textContent;
      if (curLabel === targetLabel && curGlyph === targetGlyph) {
        return;
      }
      existing.replaceWith(createToolChipElement(tool));
      return;
    }
    existing.remove();
  }

  card.appendChild(createToolChipElement(tool));
}

function removeToolChip(box) {
  if (!box) box = document.querySelector(INPUT_BOX);
  if (!box) return;
  for (const chip of box.querySelectorAll("[data-gemini-tool-chip]")) {
    chip.remove();
  }
}

let scheduledExpansionCheck = null;

function hasAttachments(box) {
  if (!box) return false;
  // Strictly check for user attachments (images, PDFs, videos) inside the prompt box
  return !!(
    box.querySelector('[data-testid="input-attachment"]') ||
    box.querySelector('.relative.w-full img[alt*="attachment" i], .relative.w-full img[alt*="Image" i], .relative.w-full [alt*="PDF attachment" i], .relative.w-full [alt*="Video attachment" i]') ||
    box.querySelector('[data-testid="attachment-item"]')
  );
}

function getEditorTextRange(editor) {
  if (!editor) return null;
  const spans = editor.querySelectorAll('[data-lexical-text="true"]');
  if (spans.length > 0) {
    const range = document.createRange();
    range.setStartBefore(spans[0]);
    range.setEndAfter(spans[spans.length - 1]);
    return range;
  }
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const firstText = walker.nextNode();
  if (!firstText) return null;
  let lastText = firstText;
  let next;
  while ((next = walker.nextNode())) {
    lastText = next;
  }
  const range = document.createRange();
  range.setStart(firstText, 0);
  range.setEnd(lastText, lastText.length);
  return range;
}

function checkPromptExpansion(box) {
  if (!box || !box.isConnected) return;

  const currentTool = getSelectedTool();
  // 1. If a tool is selected, always expand and mount tool chip
  if (currentTool) {
    box.setAttribute("data-expanded", "true");
    mountToolChip(box, currentTool);
    return;
  } else {
    removeToolChip(box);
  }

  // 2. If an image or media attachment is present, always expand
  if (hasAttachments(box)) {
    box.setAttribute("data-expanded", "true");
    return;
  }

  // 3. Check editor and draft text
  const editor = box.querySelector('[role="combobox"][contenteditable]');
  if (!editor) {
    box.removeAttribute("data-expanded");
    return;
  }
  if (editor.style.transition !== "none") {
    editor.style.transition = "none";
  }

  const text = (editor.textContent || "").replace(/[\uFEFF\u200B]/g, "");
  if (!text.trim()) {
    box.removeAttribute("data-expanded");
    return;
  }

  // Explicit multiline (newlines or multiple paragraphs or non-only-child br)
  if (text.includes("\n") || editor.querySelector("p + p, div + div, p > br:not(:only-child)")) {
    box.setAttribute("data-expanded", "true");
    return;
  }

  const range = getEditorTextRange(editor);
  if (!range) {
    box.removeAttribute("data-expanded");
    return;
  }

  const card = box.querySelector(".bg-card");
  const isAlreadyExpanded = box.getAttribute("data-expanded") === "true";

  if (!isAlreadyExpanded) {
    // In single-row mode:
    // Check if text line wrapped onto a second line
    let hasWrapped = false;
    let rangeRect = null;
    try {
      const rects = range.getClientRects();
      rangeRect = range.getBoundingClientRect();

      if (rects.length > 1) {
        const firstTop = rects[0].top;
        for (let i = 1; i < rects.length; i++) {
          if (Math.abs(rects[i].top - firstTop) > 6) {
            hasWrapped = true;
            break;
          }
        }
      }
    } catch (_) {}

    if (hasWrapped) {
      box.setAttribute("data-expanded", "true");
      return;
    }

    // Check if the single text line reaches the point before the model selector and couldn't fit there
    if (rangeRect && card) {
      const pill = card.querySelector('[data-testid="model-selector-trigger"]');
      if (pill) {
        const pillRect = pill.getBoundingClientRect();
        if (pillRect.left > 0 && rangeRect.right >= pillRect.left - 6) {
          box.setAttribute("data-expanded", "true");
          return;
        }
      }
    }

    box.removeAttribute("data-expanded");
  } else {
    // In 2-row mode:
    // Check if text wrapped across multiple lines
    let hasWrapped = false;
    let textWidth = 0;
    try {
      const rects = range.getClientRects();
      const rangeRect = range.getBoundingClientRect();
      textWidth = rangeRect.width;

      if (rects.length > 1) {
        const firstTop = rects[0].top;
        for (let i = 1; i < rects.length; i++) {
          if (Math.abs(rects[i].top - firstTop) > 6) {
            hasWrapped = true;
            break;
          }
        }
      }
    } catch (_) {}

    if (hasWrapped) {
      box.setAttribute("data-expanded", "true");
      return;
    }

    if (card && card.clientWidth > 100) {
      const cardWidth = card.clientWidth;
      const pill = card.querySelector('[data-testid="model-selector-trigger"]');
      const mic = card.querySelector('button[aria-label="Record voice memo"]');
      const send = card.querySelector('[data-testid="send-button"], [data-tooltip-id="input-send-button-cancel-tooltip"], button[aria-label^="Cancel"]');
      const plus = card.querySelector('button[aria-label="Add context"]');

      const plusWidth = plus ? plus.offsetWidth : 32;
      const pillWidth = pill ? pill.offsetWidth : 85;
      const micWidth = mic ? mic.offsetWidth : 32;
      const sendWidth = (send && (send.offsetWidth > 0 || !send.disabled)) ? (send.offsetWidth || 32) : 32;

      const leftSpace = 20 + plusWidth + 4 + 4;
      const rightSpace = 8 + 4 + pillWidth + 4 + micWidth + 4 + sendWidth + 15;
      const availableSingleRowWidth = Math.max(100, cardWidth - leftSpace - rightSpace);

      // Collapse back to single row only when text width easily fits before model selector
      if (textWidth <= availableSingleRowWidth - 8) {
        box.removeAttribute("data-expanded");
        return;
      }
    }

    box.setAttribute("data-expanded", "true");
  }
}

function requestPromptExpansionCheck() {
  if (scheduledExpansionCheck) return;
  scheduledExpansionCheck = requestAnimationFrame(() => {
    scheduledExpansionCheck = null;
    const box = document.querySelector(INPUT_BOX);
    if (box) checkPromptExpansion(box);
  });
}

function selectTool(tool) {
  setSelectedTool(tool);
  const box = document.querySelector(INPUT_BOX);
  if (box) {
    box.setAttribute("data-expanded", "true");
    mountToolChip(box, tool);
    checkPromptExpansion(box);
  }

  const root = editorRoot();
  if (root) {
    const text = (root.textContent || "").trim();
    const cmd = `/${tool.name.toLowerCase()}`;
    if (
      text === tool.name ||
      text.toLowerCase() === cmd ||
      text.toLowerCase() === (tool.label || "").toLowerCase() ||
      (text.toLowerCase().startsWith(cmd + " ") && text.slice(cmd.length + 1).trim() === "")
    ) {
      try {
        root.textContent = "";
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      } catch (_) {}
    }
    root.focus();
  }
  requestAnimationFrame(() => {
    const b = document.querySelector(INPUT_BOX);
    const active = getSelectedTool();
    if (b && active) {
      mountToolChip(b, active);
      checkPromptExpansion(b);
    }
  });
}

function deselectTool() {
  setSelectedTool(null);
  const box = document.querySelector(INPUT_BOX);
  if (box) {
    removeToolChip(box);
    checkPromptExpansion(box);
  }
  const root = editorRoot();
  if (root) root.focus();
}

function toolRow(popup, tool) {
  const currentTool = getSelectedTool();
  const isSelected = currentTool && (glyphKey(currentTool.name || currentTool.label) === glyphKey(tool.name || tool.label));
  const node = row("tool", tool.glyph, tool.label, {
    ...(tool.description ? { title: tool.description } : {}),
    ...(isSelected ? { "data-selected": "true" } : {})
  });

  const onSelect = (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectTool(tool);
    closeMenu(popup);
  };

  node.addEventListener("pointerdown", onSelect, { capture: true });
  node.addEventListener("mousedown", onSelect, { capture: true });
  node.addEventListener("click", onSelect, { capture: true });
  return node;
}

/**
 * The "More tools" row and the card it opens. The card is a sibling of the row
 * rather than a child of it: rows are positioned, so a card inside one would
 * measure its offset against the row's content width instead of the menu's, and
 * land 16px short. It carries no role, which keeps the runtime's own scans for
 * `[role="menu"]` — including this file's — from taking it for a host menu.
 */
function moreRow(popup, rest) {
  const node = row("tool", "more_horiz", "More tools", { "aria-haspopup": "menu", "aria-expanded": "false" });
  const card = plugin.ui.element("div", { "data-gemini-submenu": "" });
  for (const tool of rest) card.append(toolRow(popup, tool));

  let timer;
  const close = () => {
    window.clearTimeout(timer);
    card.remove();
    node.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    window.clearTimeout(timer);
    node.setAttribute("aria-expanded", "true");
    if (!card.isConnected) node.parentElement?.append(card);

    // Willow default: land the card's content edge on the parent's, which is 8px
    // above the row that opened it.
    const defaultTop = node.offsetTop - 8;
    let top = defaultTop;
    const cardHeight = card.offsetHeight || (rest.length * 36 + 16);

    // If opening downwards would hang below the parent menu, align its bottom
    // edge with the parent menu's bottom edge.
    if (top + cardHeight > popup.clientHeight) {
      top = popup.clientHeight - cardHeight;
    }

    // Viewport collision detection: ensure the submenu never extends past the
    // bottom of the window / screen.
    const popupRect = popup.getBoundingClientRect();
    const idealBottomInViewport = popupRect.top + top + cardHeight;
    const maxBottom = window.innerHeight - 8;
    if (idealBottomInViewport > maxBottom) {
      top -= (idealBottomInViewport - maxBottom);
    }

    // Ensure it doesn't extend above the top of the viewport
    const minTop = 8 - popupRect.top;
    if (top < minTop) {
      top = minTop;
      card.style.maxHeight = `${window.innerHeight - 16}px`;
      card.style.overflowY = "auto";
    } else {
      card.style.maxHeight = "";
      card.style.overflowY = "";
    }

    card.style.top = `${top}px`;
    card.style.transformOrigin = top < defaultTop ? "0 100%" : "0 0";
  };
  const closeSoon = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(close, 140);
  };

  node.addEventListener("pointerenter", open);
  node.addEventListener("pointerleave", closeSoon);
  node.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (card.isConnected) close();
    else open();
  });
  card.addEventListener("pointerenter", () => window.clearTimeout(timer));
  card.addEventListener("pointerleave", closeSoon);
  return node;
}

/**
 * Mark one of Antigravity's own rows. Its label is the last element in the row —
 * safe, because these rows are an icon and a label and nothing else — and it is
 * marked rather than matched as `> span`, since the icon beside it is a ligature
 * span on three of the rows and an `svg` on the other two.
 *
 * A row whose label is not one this file knows keeps the fallback glyph rather
 * than none, so a row Antigravity adds later still draws in the icon column.
 */
function markContextRow(item) {
  if (item.getAttribute("data-gemini-row") === "tool") return;
  // React rebuilds a row's children on some updates, taking the mark with them.
  if (item.querySelector("[data-gemini-label]")) return;
  const label = item.lastElementChild;
  const text = (label?.textContent ?? "").trim();
  if (!label || !text) return;
  if (isSkillsName(text)) {
    item.remove();
    return;
  }
  const matchedKey = Object.keys(CONTEXT_GLYPHS).find((k) => k.toLowerCase() === text.toLowerCase());
  const glyph = matchedKey ? CONTEXT_GLYPHS[matchedKey] : (glyphFor(text) || FALLBACK_GLYPH);
  label.setAttribute("data-gemini-label", "");
  item.setAttribute("data-gemini-row", "context");
  item.setAttribute("data-gemini-glyph", glyph);
  if (GOOGLE_SYMBOLS.has(glyph)) item.setAttribute("data-gemini-glyph-family", "google-symbols");
  else item.removeAttribute("data-gemini-glyph-family");

  if (text.toLowerCase() === "browser" && !item.hasAttribute("data-gemini-browser-hooked")) {
    item.setAttribute("data-gemini-browser-hooked", "true");
    const onBrowserSelect = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const browserTool = { name: "browser", label: "Browser", glyph: "chrome" };
      selectTool(browserTool);
      const popup = item.closest('[role="menu"]');
      if (popup) closeMenu(popup);
    };
    item.addEventListener("pointerdown", onBrowserSelect, { capture: true });
    item.addEventListener("mousedown", onBrowserSelect, { capture: true });
    item.addEventListener("click", onBrowserSelect, { capture: true });
    item.addEventListener("mouseup", onBrowserSelect, { capture: true });
  }
}

/**
 * Add the tools below Antigravity's own rows: a divider, four on the card, and
 * the rest behind "More tools", which is the shape of Willow's menu.
 *
 * The rows go in a wrapper of no box of its own, so that one gap and one row
 * rhythm run down the whole card — and so that finding the wrapper is all it
 * takes to know this menu has been done already, however many times the host
 * re-renders inside it.
 */
function addTools(popup) {
  if (popup.querySelector("[data-gemini-tools]")) return;
  const props = composerProps();
  if (props && !tools) {
    void ensureTools(props).then(() => {
      if (tools && popup.isConnected) {
        const existing = popup.querySelector("[data-gemini-tools]");
        if (existing) existing.remove();
        addTools(popup);
      }
    });
  }

  const pool = (tools && tools.length > 0) ? tools : DEFAULT_TOOLS;
  const wrapper = plugin.ui.element("div", { "data-gemini-tools": "" });
  wrapper.style.display = "contents";
  popup.append(wrapper);

  // A command that is already a row up above — "browser" is one — is dropped,
  // by comparing the labels rather than by naming it here.
  const above = new Set();
  for (const label of popup.querySelectorAll('[data-gemini-row="context"] [data-gemini-label]')) {
    above.add((label.textContent ?? "").trim().toLowerCase());
  }
  const offer = pool.filter((tool) => 
    !above.has(tool.label.toLowerCase()) && 
    !above.has(tool.name.toLowerCase()) &&
    !isSkillsName(tool.name) &&
    !isSkillsName(tool.label)
  );
  if (offer.length === 0) return;

  const featured = [];
  for (const name of FEATURED) {
    const found = offer.find((tool) => tool.name.toLowerCase() === name);
    if (found) featured.push(found);
  }
  for (const tool of offer) {
    if (featured.length >= FEATURED_COUNT) break;
    if (!featured.includes(tool)) featured.push(tool);
  }
  const rest = offer.filter((tool) => !featured.includes(tool));

  wrapper.append(plugin.ui.element("div", { role: "separator", "aria-orientation": "horizontal" }));
  for (const tool of featured) wrapper.append(toolRow(popup, tool));
  if (rest.length > 0) wrapper.append(moreRow(popup, rest));
}

function decorate(popup) {
  if (!isPlusMenu(popup)) return;
  popup.setAttribute("data-gemini-plus-menu", "");
  popup.querySelector('#gemini-menu-item-pin')?.remove();
  popup.querySelector('#gemini-menu-item-archive')?.remove();

  for (const item of popup.querySelectorAll('[role="menuitem"]')) {
    const text = (item.textContent ?? "").trim();
    if (isSkillsName(text) || item.id === 'gemini-menu-item-pin' || item.id === 'gemini-menu-item-archive') {
      item.remove();
      continue;
    }
    markContextRow(item);
  }
  addTools(popup);
  const currentTool = getSelectedTool();
  if (currentTool) {
    const activeKey = glyphKey(currentTool.name || currentTool.label);
    for (const item of popup.querySelectorAll('[data-gemini-row="tool"]')) {
      const label = (item.querySelector('[data-gemini-label]')?.textContent ?? "").trim();
      if (glyphKey(label) === activeKey) {
        item.setAttribute("data-selected", "true");
      } else {
        item.removeAttribute("data-selected");
      }
    }
  } else {
    for (const item of popup.querySelectorAll('[data-gemini-row="tool"][data-selected]')) {
      item.removeAttribute("data-selected");
    }
  }
}

/* Watched separately from the model pill and the sidebar above: those restore a
 * label on dispose, and a menu popup is a different thing to put back. */
const menuWatchers = new Set();

const stopMenus = plugin.dom.observe('[role="menu"]', (popup) => {
  // Every menu in the app arrives here. One whose trigger is known and is not
  // the plus button is dropped at once; one whose trigger is not linked yet is
  // kept, since `decorate` asks again on each pass.
  const trigger = triggerFor(popup);
  if (trigger && !trigger.matches(PLUS_TRIGGER)) return;
  decorate(popup);
  // Antigravity fills the card after mounting it, and refills it as the
  // conversation changes which context is on offer, so the popup is watched for
  // as long as it lives. Every pass finds its own work already done, which is
  // what stops the writes above from feeding back into this.
  const watcher = new MutationObserver(() => {
    if (!popup.isConnected) {
      watcher.disconnect();
      menuWatchers.delete(watcher);
      return;
    }
    decorate(popup);
  });
  watcher.observe(popup, { childList: true, subtree: true });
  menuWatchers.add(watcher);
});

/* ---------------------------------------------------------------------------
 * Prompt Box Multiline & Tool Expansion Observer
 * ------------------------------------------------------------------------- */
plugin.dom.observe(INPUT_BOX, (box) => {
  checkPromptExpansion(box);

  const onInputOrKey = () => requestPromptExpansionCheck();
  box.addEventListener("input", onInputOrKey);
  box.addEventListener("keyup", onInputOrKey);

  const onPasteOrDrop = () => {
    requestAnimationFrame(() => requestPromptExpansionCheck());
    setTimeout(() => requestPromptExpansionCheck(), 50);
  };
  box.addEventListener("paste", onPasteOrDrop);
  box.addEventListener("drop", onPasteOrDrop);

  const editor = box.querySelector('[role="combobox"][contenteditable]');
  let ro = null;
  let mo = null;
  if (editor) {
    ro = new ResizeObserver(() => requestPromptExpansionCheck());
    ro.observe(editor);

    mo = new MutationObserver(() => requestPromptExpansionCheck());
    mo.observe(editor, { childList: true, subtree: true, characterData: true });
  }

  const boxRo = new ResizeObserver(() => requestPromptExpansionCheck());
  boxRo.observe(box);

  const boxMo = new MutationObserver(() => requestPromptExpansionCheck());
  boxMo.observe(box, { childList: true, subtree: true });

  remember(box, {
    disconnect: () => {
      box.removeEventListener("input", onInputOrKey);
      box.removeEventListener("keyup", onInputOrKey);
      box.removeEventListener("paste", onPasteOrDrop);
      box.removeEventListener("drop", onPasteOrDrop);
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
      boxRo.disconnect();
      boxMo.disconnect();
    }
  });
});


/* ---------------------------------------------------------------------------
 * Global Tooltips: Willow's Gemini-style native tooltip engine
 * ------------------------------------------------------------------------- */
const TOOLTIP_STASH_ATTR = 'data-willow-tooltip';
const TOOLTIP_OWNED_LABEL_ATTR = 'data-willow-tooltip-label';
const TOOLTIP_POSITION_ATTR = 'data-tooltip-position';
const TOOLTIP_POSITIONS = ['above', 'below', 'left', 'right'];
const TOOLTIP_PANE_CLASSES = TOOLTIP_POSITIONS.map((p) => `willow-tooltip-pane--${p}`);
const TOOLTIP_TRANSFORM_ORIGIN = {
  left: 'right center',
  right: 'left center',
  below: 'center top',
  above: 'center bottom',
};
const TOOLTIP_OPPOSITE = {
  left: 'right',
  right: 'left',
  below: 'above',
  above: 'below',
};
const TOOLTIP_OFFSET = 8;
const TOOLTIP_MARGIN_NEAR = 8;
const TOOLTIP_MARGIN_FAR = 15;
const TOOLTIP_HIDE_DURATION_MS = 75;

const tooltipClamp = (value, min, max) => (max < min ? min : Math.min(Math.max(value, min), max));

function isTooltipMultiline(surface) {
  const box = surface.getBoundingClientRect();
  return box.height > 24 && box.width >= 195;
}

function readTooltipPosition(el) {
  const raw = el.getAttribute(TOOLTIP_POSITION_ATTR);
  return TOOLTIP_POSITIONS.includes(raw) ? raw : 'below';
}

let tooltipOverlayContainer = null;
function getTooltipOverlayContainer() {
  if (tooltipOverlayContainer && tooltipOverlayContainer.isConnected) return tooltipOverlayContainer;
  const existing = document.querySelector('.willow-tooltip-container');
  if (existing) {
    tooltipOverlayContainer = existing;
    return existing;
  }
  const el = document.createElement('div');
  el.className = 'willow-tooltip-container';
  document.body.appendChild(el);
  tooltipOverlayContainer = el;
  return el;
}

let activeTooltipAnchor = null;
let activeTooltipPane = null;
let activeTooltipWrapper = null;
let activeTooltipSurface = null;
let activeTooltipPosition = 'below';
let activeTooltipHideTimer = null;

function repositionTooltip() {
  if (!activeTooltipAnchor || !activeTooltipAnchor.isConnected || !activeTooltipPane || !activeTooltipWrapper) return;

  activeTooltipPane.style.top = '0px';
  activeTooltipPane.style.left = '0px';
  activeTooltipPane.style.right = '';
  activeTooltipPane.style.bottom = '';

  const a = activeTooltipAnchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const w = activeTooltipPane.offsetWidth;
  const h = activeTooltipPane.offsetHeight;

  const fits = {
    below: a.bottom + TOOLTIP_OFFSET + h <= vh,
    above: a.top - TOOLTIP_OFFSET - h >= 0,
    right: a.right + TOOLTIP_OFFSET + w <= vw,
    left: a.left - TOOLTIP_OFFSET - w >= 0,
  };
  const placement = fits[activeTooltipPosition] || !fits[TOOLTIP_OPPOSITE[activeTooltipPosition]] ? activeTooltipPosition : TOOLTIP_OPPOSITE[activeTooltipPosition];

  activeTooltipPane.classList.remove(...TOOLTIP_PANE_CLASSES);
  activeTooltipPane.classList.add(`willow-tooltip-pane--${placement}`);
  activeTooltipPane.style.top = '';
  activeTooltipPane.style.right = '';
  activeTooltipPane.style.bottom = '';
  activeTooltipPane.style.left = '';

  const centredLeft = tooltipClamp(a.left + a.width / 2 - w / 2, TOOLTIP_MARGIN_NEAR, vw - TOOLTIP_MARGIN_FAR - w);
  const centredTop = tooltipClamp(a.top + a.height / 2 - h / 2, TOOLTIP_MARGIN_NEAR, vh - TOOLTIP_MARGIN_FAR - h);

  switch (placement) {
    case 'below':
      activeTooltipPane.style.top = `${a.bottom}px`;
      activeTooltipPane.style.left = `${centredLeft}px`;
      break;
    case 'above':
      activeTooltipPane.style.bottom = `${vh - a.top}px`;
      activeTooltipPane.style.left = `${centredLeft}px`;
      break;
    case 'right':
      activeTooltipPane.style.left = `${a.right}px`;
      activeTooltipPane.style.top = `${centredTop}px`;
      break;
    case 'left':
      activeTooltipPane.style.right = `${vw - a.left}px`;
      activeTooltipPane.style.top = `${centredTop}px`;
      break;
  }

  activeTooltipWrapper.style.transformOrigin = TOOLTIP_TRANSFORM_ORIGIN[placement];

  if (activeTooltipSurface) {
    activeTooltipSurface.classList.toggle('willow-tooltip-surface--multiline', isTooltipMultiline(activeTooltipSurface));
  }
}

function restoreTooltipAnchor(el) {
  if (!el) return;
  const stashed = el.getAttribute(TOOLTIP_STASH_ATTR);
  if (stashed !== null) {
    if (!el.hasAttribute('title')) el.setAttribute('title', stashed);
    el.removeAttribute(TOOLTIP_STASH_ATTR);
  }
  if (el.hasAttribute(TOOLTIP_OWNED_LABEL_ATTR)) {
    el.removeAttribute('aria-label');
    el.removeAttribute(TOOLTIP_OWNED_LABEL_ATTR);
  }
}

function closeTooltipImmediate() {
  clearTimeout(activeTooltipHideTimer);
  if (activeTooltipAnchor) {
    restoreTooltipAnchor(activeTooltipAnchor);
    activeTooltipAnchor = null;
  }
  if (activeTooltipPane) {
    activeTooltipPane.remove();
    activeTooltipPane = null;
    activeTooltipWrapper = null;
    activeTooltipSurface = null;
  }
}

function closeTooltip() {
  if (!activeTooltipAnchor) return;
  restoreTooltipAnchor(activeTooltipAnchor);
  activeTooltipAnchor = null;

  if (activeTooltipWrapper && activeTooltipPane) {
    const pane = activeTooltipPane;
    const wrapper = activeTooltipWrapper;
    wrapper.classList.remove('willow-tooltip--show');
    wrapper.classList.add('willow-tooltip--hide');

    const done = () => {
      pane.remove();
      if (activeTooltipPane === pane) {
        activeTooltipPane = null;
        activeTooltipWrapper = null;
        activeTooltipSurface = null;
      }
    };
    wrapper.addEventListener('animationend', done, { once: true });
    activeTooltipHideTimer = setTimeout(done, TOOLTIP_HIDE_DURATION_MS + 50);
  }
}

function showTooltipOverlay(anchor, text, position) {
  clearTimeout(activeTooltipHideTimer);
  if (activeTooltipPane) {
    activeTooltipPane.remove();
    activeTooltipPane = null;
  }

  const container = getTooltipOverlayContainer();

  const pane = document.createElement('div');
  pane.className = `willow-tooltip-pane willow-tooltip-pane--${position}`;

  const wrapper = document.createElement('div');
  wrapper.className = 'willow-tooltip willow-tooltip--show';
  wrapper.setAttribute('aria-hidden', 'true');

  const surface = document.createElement('div');
  surface.className = 'willow-tooltip-surface';
  surface.textContent = text;

  wrapper.appendChild(surface);
  pane.appendChild(wrapper);
  container.appendChild(pane);

  activeTooltipAnchor = anchor;
  activeTooltipPane = pane;
  activeTooltipWrapper = wrapper;
  activeTooltipSurface = surface;
  activeTooltipPosition = position;

  repositionTooltip();
}

function openTooltipFor(el) {
  if (activeTooltipAnchor === el) return;
  closeTooltipImmediate();

  const title = el.getAttribute('title');
  if (title && title.trim()) {
    el.setAttribute(TOOLTIP_STASH_ATTR, title);
    el.removeAttribute('title');
    if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.textContent?.trim()) {
      el.setAttribute('aria-label', title);
      el.setAttribute(TOOLTIP_OWNED_LABEL_ATTR, '');
    }
  }

  // If this element already has Base UI tooltip trigger, Base UI will render its own styled popup
  if (el.hasAttribute('data-base-ui-tooltip-trigger') || el.closest('[data-base-ui-tooltip-trigger]')) {
    return;
  }

  const text = title || el.getAttribute(TOOLTIP_STASH_ATTR);
  if (!text || !text.trim()) return;

  showTooltipOverlay(el, text.trim(), readTooltipPosition(el));
}

function setupGlobalTooltips() {
  const onOver = (e) => {
    const el = e.target?.closest?.('[title]');
    if (el) openTooltipFor(el);
    else if (activeTooltipAnchor && !activeTooltipAnchor.contains(e.target)) closeTooltip();
  };

  const onOut = (e) => {
    if (!activeTooltipAnchor) return;
    const next = e.relatedTarget;
    if (!next || !activeTooltipAnchor.contains(next)) closeTooltip();
  };

  const onFocusIn = (e) => {
    const el = e.target?.closest?.('[title]');
    if (el && el.matches(':focus-visible')) openTooltipFor(el);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') closeTooltip();
  };

  const onClick = (e) => {
    const el = activeTooltipAnchor;
    if (!el || !el.contains(e.target)) {
      closeTooltip();
      return;
    }
    requestAnimationFrame(() => {
      if (activeTooltipAnchor !== el || !el.isConnected) {
        closeTooltip();
        return;
      }
      const next = el.getAttribute('title');
      if (next && next.trim()) {
        el.setAttribute(TOOLTIP_STASH_ATTR, next);
        el.removeAttribute('title');
        if (activeTooltipSurface) activeTooltipSurface.textContent = next.trim();
        repositionTooltip();
      }
    });
  };

  const onScrollOrResize = () => {
    if (activeTooltipAnchor) repositionTooltip();
  };

  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('mouseout', onOut, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', closeTooltip, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);
  window.addEventListener('blur', closeTooltip);

  return () => {
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('mouseout', onOut, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', closeTooltip, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize);
    window.removeEventListener('blur', closeTooltip);
    closeTooltipImmediate();
    if (tooltipOverlayContainer) {
      tooltipOverlayContainer.remove();
      tooltipOverlayContainer = null;
    }
  };
}

const stopGlobalTooltips = setupGlobalTooltips();

// Also observe host Base UI / react-tooltip popups to ensure multiline left-align and arrow hiding
plugin.dom.observe('[role="tooltip"]', (tooltip) => {
  if (tooltip.classList.contains('willow-tooltip-description') || tooltip.closest('.willow-tooltip-container')) {
    return;
  }
  const checkMultiline = () => {
    const box = tooltip.getBoundingClientRect();
    if (box.height > 24 && box.width >= 195) {
      tooltip.classList.add('willow-tooltip-surface--multiline');
    } else {
      tooltip.classList.remove('willow-tooltip-surface--multiline');
    }
  };
  checkMultiline();
  const arrow = tooltip.querySelector('[data-base-ui-tooltip-arrow], [class*="arrow"], svg');
  if (arrow) arrow.style.setProperty('display', 'none', 'important');

  const obs = new MutationObserver(checkMultiline);
  obs.observe(tooltip, { childList: true, subtree: true, characterData: true });
  observers.set(tooltip, {
    disconnect: () => obs.disconnect()
  });
});

/* ---------------------------------------------------------------------------
 * Conversation session scrollbar: Willow's gemini-chat-scrollbar
 * ------------------------------------------------------------------------- */
const CONV_VIEW_SELECTOR = '[data-testid="conversation-view"]';

function applyConversationScrollbar(view) {
  if (!view || !view.isConnected) return;

  const innerScrollers = view.querySelectorAll('.overflow-y-auto');
  if (innerScrollers.length > 0) {
    if (view.style.overflowY !== 'hidden') view.style.overflowY = 'hidden';
    if (view.style.scrollbarGutter !== 'auto') view.style.scrollbarGutter = 'auto';
    if (view.style.scrollbarWidth !== 'none') view.style.scrollbarWidth = 'none';

    for (const scroller of innerScrollers) {
      if (!scroller.classList.contains('gemini-chat-scrollbar')) {
        scroller.classList.add('gemini-chat-scrollbar');
      }
      if (scroller.style.scrollbarWidth !== 'auto') {
        scroller.style.removeProperty('scrollbar-width');
        scroller.style.scrollbarWidth = 'auto';
      }
      if (scroller.style.scrollbarColor !== 'auto') {
        scroller.style.removeProperty('scrollbar-color');
        scroller.style.scrollbarColor = 'auto';
      }
      if (scroller.style.scrollbarGutter !== 'stable') {
        scroller.style.scrollbarGutter = 'stable';
      }
    }
  } else {
    if (!view.classList.contains('gemini-chat-scrollbar')) {
      view.classList.add('gemini-chat-scrollbar');
    }
    if (view.style.scrollbarWidth !== 'auto') {
      view.style.removeProperty('scrollbar-width');
      view.style.scrollbarWidth = 'auto';
    }
    if (view.style.scrollbarColor !== 'auto') {
      view.style.removeProperty('scrollbar-color');
      view.style.scrollbarColor = 'auto';
    }
    if (view.style.scrollbarGutter !== 'stable') {
      view.style.scrollbarGutter = 'stable';
    }
  }
}

function updateTurnFooters(view) {
  if (!view || !view.isConnected) return;
  const turns = Array.from(view.querySelectorAll('.flex.items-start:has([role="article"][aria-label="Agent response"])'));
  if (turns.length === 0) return;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const isLatest = (i === turns.length - 1);
    const attr = isLatest ? "true" : "false";
    if (turn.getAttribute("data-gemini-latest-turn") !== attr) {
      turn.setAttribute("data-gemini-latest-turn", attr);
    }
  }
}

plugin.dom.observe(CONV_VIEW_SELECTOR, (view) => {
  applyConversationScrollbar(view);
  updateTurnFooters(view);
  const obs = new MutationObserver(() => {
    applyConversationScrollbar(view);
    updateTurnFooters(view);
  });
  obs.observe(view, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  remember(view, obs);
});


/* ---------------------------------------------------------------------------
 * Changed files review card: Willow Spark style
 * ------------------------------------------------------------------------- */
function getBasename(pathOrUri) {
  if (!pathOrUri) return "";
  const clean = String(pathOrUri).split("?")[0].split("#")[0];
  const parts = clean.split(/[/\\]/).filter(Boolean);
  const name = parts[parts.length - 1] || clean;
  try {
    return decodeURIComponent(name);
  } catch (_) {
    return name;
  }
}

function getTurnDiff(el) {
  try {
    const key = Object.keys(el).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (!key) return null;
    let cur = el[key];
    for (let i = 0; i < 30 && cur; i++) {
      if (cur.memoizedProps?.turnDiff) return cur.memoizedProps.turnDiff;
      if (cur.pendingProps?.turnDiff) return cur.pendingProps.turnDiff;
      if (cur.memoizedProps?.diff) return cur.memoizedProps.diff;
      cur = cur.return;
    }
  } catch (_) {}
  return null;
}

function extractFileNames(turnDiff) {
  if (!turnDiff || !turnDiff.fileDiffs) return [];
  const entries = Object.entries(turnDiff.fileDiffs);
  let files = entries
    .filter(([, diff]) => !diff?.isArtifactFile)
    .map(([pathOrUri]) => getBasename(pathOrUri));

  if (files.length === 0 && entries.length > 0) {
    files = entries.map(([pathOrUri]) => getBasename(pathOrUri));
  }
  return files;
}

function applyWillowFileCard(header) {
  if (!header || !header.isConnected) return;
  const textCol = header.querySelector(".overflow-hidden");
  if (!textCol) return;

  const turnDiff = getTurnDiff(header);
  const fileNames = extractFileNames(turnDiff);
  const subtitleText = fileNames.length > 0 ? fileNames.join(", ") : "";

  let subtitle = textCol.querySelector(".spark-file-card-subtitle");
  if (!subtitle) {
    subtitle = document.createElement("span");
    subtitle.className = "spark-file-card-subtitle";
    textCol.appendChild(subtitle);
  }

  if (subtitleText && subtitle.textContent !== subtitleText) {
    subtitle.textContent = subtitleText;
    subtitle.title = subtitleText;
  }

  if (!header.dataset.willowCardAttached) {
    header.dataset.willowCardAttached = "true";
    header.addEventListener("click", (e) => {
      // If clicking directly on or inside the review button, let its native handler run
      if (e.target.closest(".review-button")) return;
      // Otherwise, prevent default accordion toggle and trigger Review
      e.preventDefault();
      e.stopPropagation();
      const btn = header.querySelector(".review-button");
      if (btn) btn.click();
    }, true);
  }
}

plugin.dom.observe(".files-changed-header", (header) => {
  applyWillowFileCard(header);
  requestAnimationFrame(() => applyWillowFileCard(header));
  setTimeout(() => applyWillowFileCard(header), 150);

  const obs = new MutationObserver(() => applyWillowFileCard(header));
  obs.observe(header, { childList: true, subtree: true, characterData: true });
  remember(header, obs);
});

/* ---------------------------------------------------------------------------
 * Prompt box AI disclaimer: "Antigravity is AI and can make mistakes."
 * Willow (Composer.tsx:1108-1114, SparkTaskDetail.css:3245-3255):
 * 13px/17px weight 400 in #c4c7c5, centered beneath the prompt box.
 * ------------------------------------------------------------------------- */
const PROMPT_BOX_SELECTOR = '[data-testid="agent-input-box"]';
const DISCLAIMER_TEXT = "Antigravity is AI and can make mistakes.";

function ensureAiDisclaimer(box) {
  if (!box || !box.isConnected) return;

  let disclaimer = box.querySelector(".gemini-ai-disclaimer");
  if (!disclaimer) {
    disclaimer = document.createElement("p");
    disclaimer.className = "gemini-ai-disclaimer";
    disclaimer.textContent = DISCLAIMER_TEXT;
    box.appendChild(disclaimer);
  } else {
    if (disclaimer.textContent !== DISCLAIMER_TEXT) {
      disclaimer.textContent = DISCLAIMER_TEXT;
    }
    if (box.lastElementChild !== disclaimer) {
      box.appendChild(disclaimer);
    }
  }
}

plugin.dom.observe(PROMPT_BOX_SELECTOR, (box) => {
  ensureAiDisclaimer(box);
  const obs = new MutationObserver(() => ensureAiDisclaimer(box));
  obs.observe(box, { childList: true });
  remember(box, obs);
});

plugin.onDispose(() => {
  stopMenus();
  stopGlobalTooltips();
  for (const watcher of menuWatchers) watcher.disconnect();
  menuWatchers.clear();
  for (const [, obs] of observers) {
    if (typeof obs?.disconnect === 'function') obs.disconnect();
  }
  observers.clear();
  // The added rows go first, so what is left to unmark is only Antigravity's own.
  for (const added of document.querySelectorAll("#gemini-experience-switch, [data-gemini-tools], [data-gemini-submenu], .spark-file-card-subtitle, .gemini-ai-disclaimer")) added.remove();
  for (const popup of document.querySelectorAll("[data-gemini-plus-menu]")) {
    popup.removeAttribute("data-gemini-plus-menu");
    for (const item of popup.querySelectorAll("[data-gemini-row]")) {
      item.removeAttribute("data-gemini-row");
      item.removeAttribute("data-gemini-glyph");
      item.removeAttribute("data-gemini-glyph-family");
    }
    for (const label of popup.querySelectorAll("[data-gemini-label]")) label.removeAttribute("data-gemini-label");
  }
});

/* ---------------------------------------------------------------------------
 * The home screen's greeting, and the composer's slide into a conversation.
 *
 * styles/home-composer.css centres the composer and draws the greeting above
 * it. Two things about them cannot be done in CSS.
 *
 * The greeting's text, because it carries a name. Willow takes the first word of
 * the signed-in profile's display name (features/media/src/MediaHome.tsx:
 * 205-231). That name is nowhere in Antigravity's own state, but it is in the
 * Chromium profile Antigravity signs into Google through, which BetterGravity
 * reads on the page's behalf as `plugin.account`.
 *
 * And the slide, because its distance is not known until it happens.
 * Antigravity renders a different tree for a conversation than for the home
 * screen — measured live, the docked composer has no `z-[1]` group around it and
 * no workspace button above the card — so the composer at the bottom of a new
 * conversation is a different element from the one that was in the middle of the
 * screen, with no position of its own to leave. Where the old one was is
 * recorded on submit, and the new one is animated from there, over Willow's own
 * 250ms on cubic-bezier(0.2, 0, 0, 1) (features/chat/src/ChatView.tsx:4560).
 *
 * Only a submit arms it. Willow plays the same slide when an existing
 * conversation is opened from the sidebar; that one is deliberately left alone,
 * so opening a conversation puts its composer where it belongs without
 * travelling there first.
 * ------------------------------------------------------------------------- */
const HOME_SCROLLER = 'div[class*="pt-[30vh]"]';
const HOME_GROUP = `${HOME_SCROLLER} > div[class*="z-[1]"]`;
const COMPOSER_BOX = '[data-testid="agent-input-box"]';
const SEND_BUTTON = '[data-testid="send-button"]';
const SIDEBAR_NAV = '[role="navigation"][aria-label="Sidebar"]';

/** Willow's own layout transition: `{ duration: 0.25, ease: [0.2, 0, 0, 1] }`. */
const SLIDE_MS = 250;
const SLIDE_EASING = "cubic-bezier(0.2, 0, 0, 1)";

/**
 * How long a submit stays armed. The conversation opens within a frame or two of
 * it; anything slower is a navigation that is no longer the submit's.
 */
const SLIDE_WINDOW_MS = 1500;

/**
 * The greeting, or null while the name is still unknown.
 *
 * Willow shows nothing rather than a nameless version first, because the name is
 * inside the string: building it early does not produce "a greeting without a
 * name", it produces a different greeting that then has to be replaced
 * (MediaHome.tsx:160-191, from a refresh that went `Let's chat` ->
 * `Let's chat, there` -> `Let's chat, Yashjit`).
 *
 * A runtime too old for `plugin.account` is the other case Willow has, and takes
 * Willow's answer to it: signed out short-circuits the wait, because the nameless
 * greeting is the final text then rather than a placeholder for one.
 */
const DEFAULT_ACCOUNT = {
  fullName: "Yashjit Pal",
  email: "yashjitp@gmail.com",
  pictureUrl: "https://lh3.googleusercontent.com/a/ACg8ocKqEYIsGZrCJjp8w8AW541NMrnAGJtzPJ061R9IIUyv1ilpE1Mk=s96-c"
};

let userAccountProfile = { ...DEFAULT_ACCOUNT };

function updateAllUserCards(profile) {
  if (!profile) return;
  for (const pill of document.querySelectorAll("#gemini-sidebar-user-pill")) {
    const nameEl = pill.querySelector(".gemini-user-name");
    const emailEl = pill.querySelector(".gemini-user-email");
    const imgEl = pill.querySelector(".gemini-user-avatar");
    const fallbackEl = pill.querySelector(".gemini-user-avatar-fallback");

    if (nameEl && profile.fullName) nameEl.textContent = profile.fullName;
    if (emailEl && profile.email) emailEl.textContent = profile.email;
    if (imgEl && profile.pictureUrl) {
      imgEl.src = profile.pictureUrl;
      imgEl.style.display = "";
      if (fallbackEl) fallbackEl.style.display = "none";
    }
    if (fallbackEl && profile.fullName) {
      fallbackEl.textContent = profile.fullName.charAt(0).toUpperCase();
    }
    if (profile.fullName || profile.email) {
      pill.title = `${profile.fullName || ""} (${profile.email || ""})`.trim();
    }
  }
}

let greeting = plugin.account ? null : "Hello there";

if (plugin.account) {
  plugin.account
    .read()
    .then((profile) => {
      // `firstName` is Google's own `given_name`, or the first word of the full
      // name when Google did not give one.
      greeting = profile?.firstName ? `Hello there, ${profile.firstName}` : "Hello there";
      if (profile?.fullName) userAccountProfile.fullName = profile.fullName;
      if (profile?.email) userAccountProfile.email = profile.email;
      if (profile?.pictureUrl) userAccountProfile.pictureUrl = profile.pictureUrl;
      updateAllUserCards(userAccountProfile);

      // The home screen may already be up, its observer having been and gone
      // with nothing to show.
      for (const group of document.querySelectorAll(HOME_GROUP)) ensureHomeGreeting(group);
    })
    // `read()` answers `{}` rather than throwing, so this is only reached by a
    // runtime broken enough that no name is ever coming.
    .catch(() => {});
}

/**
 * `Hello there, <name>` above the composer, as Willow's `PinnedChatGreeting`.
 *
 * The stylesheet positions the block absolutely, so where it sits among the
 * group's children changes nothing on screen; it goes first because that is the
 * order it reads in.
 */
function ensureHomeGreeting(group) {
  if (!group.isConnected || greeting === null) return;

  // Antigravity discards this group when a conversation opens rather than
  // restyling it, so a greeting cannot be carried into a docked composer. The
  // check is here in case that ever changes, because the block would then be an
  // unstyled heading pushing the composer down.
  if (!group.matches(HOME_GROUP)) {
    for (const stale of group.querySelectorAll("[data-gemini-greeting]")) stale.remove();
    return;
  }

  const existing = group.querySelector(":scope > [data-gemini-greeting]");
  if (existing) {
    const heading = existing.querySelector("[data-gemini-greeting-text]");
    if (heading && heading.textContent !== greeting) heading.textContent = greeting;
    return;
  }

  const block = document.createElement("div");
  block.dataset.geminiGreeting = "";
  const fade = document.createElement("div");
  fade.dataset.geminiGreetingFade = "";
  const heading = document.createElement("h1");
  heading.dataset.geminiGreetingText = "";
  heading.textContent = greeting;
  fade.append(heading);
  block.append(fade);
  group.prepend(block);
}

plugin.dom.observe(HOME_GROUP, (group) => {
  ensureHomeGreeting(group);
  const obs = new MutationObserver(() => ensureHomeGreeting(group));
  obs.observe(group, { childList: true });
  remember(group, obs);
});

let pendingSlide = null;

function cancelComposerSlide() {
  if (!pendingSlide) return;
  pendingSlide.watcher.disconnect();
  window.clearTimeout(pendingSlide.timer);
  pendingSlide = null;
}

/**
 * Records where the home screen's composer is, and slides the next one up to
 * that spot and back down.
 *
 * A MutationObserver rather than a frame callback: its callback runs at the end
 * of the task that inserted the conversation, before that task's frame is
 * painted, so the new composer is never seen at the bottom before it starts
 * travelling there. It also does not care whether Antigravity reused the box or
 * built a new one, since it measures whatever is there.
 */
function armComposerSlide() {
  // The home screen is the only place the slide starts from.
  if (!document.querySelector(HOME_SCROLLER)) return;
  const box = document.querySelector(COMPOSER_BOX);
  if (!box) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  cancelComposerSlide();
  const from = box.getBoundingClientRect().top;

  const watcher = new MutationObserver(() => {
    // Still on the home screen: the submit has not opened anything yet.
    if (document.querySelector(HOME_SCROLLER)) return;
    const docked = document.querySelector(COMPOSER_BOX);
    if (!docked) return;

    cancelComposerSlide();
    const distance = from - docked.getBoundingClientRect().top;
    if (Math.abs(distance) < 1) return;
    docked.animate(
      [{ transform: `translateY(${distance}px)` }, { transform: "translateY(0px)" }],
      { duration: SLIDE_MS, easing: SLIDE_EASING }
    );
  });

  watcher.observe(document.documentElement, { childList: true, subtree: true });
  pendingSlide = { watcher, timer: window.setTimeout(cancelComposerSlide, SLIDE_WINDOW_MS) };
}

function onComposerSubmitKey(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest(COMPOSER_BOX) && !target?.closest(INPUT_BOX)) return;

  const currentTool = getSelectedTool();
  if (currentTool) {
    const root = editorRoot();
    if (root) {
      const text = (root.textContent || "").trim();
      const cmd = `/${currentTool.name}`;
      if (!text.startsWith(cmd)) {
        try {
          const range = document.createRange();
          range.selectNodeContents(root);
          range.collapse(true);
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
          }
          document.execCommand("insertText", false, `${cmd} `);
        } catch (_) {}
      }
    }
    setTimeout(() => {
      deselectTool();
    }, 50);
    window.requestAnimationFrame(() => requestPromptExpansionCheck());
  }

  armComposerSlide();
}

function onComposerSubmitClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  if (target.closest(SEND_BUTTON) || target.closest('[data-testid="send-button"]')) {
    const currentTool = getSelectedTool();
    if (currentTool) {
      const root = editorRoot();
      if (root) {
        const text = (root.textContent || "").trim();
        const cmd = `/${currentTool.name}`;
        if (!text.startsWith(cmd)) {
          try {
            const range = document.createRange();
            range.selectNodeContents(root);
            range.collapse(true);
            const sel = window.getSelection();
            if (sel) {
              sel.removeAllRanges();
              sel.addRange(range);
            }
            document.execCommand("insertText", false, `${cmd} `);
          } catch (_) {}
        }
      }
      setTimeout(() => {
        deselectTool();
      }, 50);
      window.requestAnimationFrame(() => requestPromptExpansionCheck());
    }

    armComposerSlide();
    return;
  }
  // Opening a conversation from the sidebar is the one navigation that must not
  // slide. It can only collide with a pending submit if both happen inside the
  // window above, and then the composer that arrives is the sidebar's.
  if (target.closest(SIDEBAR_NAV)) cancelComposerSlide();
}

// Capture, so a submit is seen before whatever Antigravity's editor does with
// the key or the click.
document.addEventListener("keydown", onComposerSubmitKey, true);
document.addEventListener("click", onComposerSubmitClick, true);

/* ---------------------------------------------------------------------------
 * Sidebar User Profile Card (Willow's lower-left account card)
 * ------------------------------------------------------------------------- */
const SETTINGS_BTN_SELECTOR = '[role="navigation"][aria-label="Sidebar"] [data-testid="settings-button"]';

function ensureSidebarUserCard(footer) {
  if (!footer || !footer.isConnected) return;
  const settingsBtn = footer.querySelector('[data-testid="settings-button"]');
  if (!settingsBtn) return;

  let pill = footer.querySelector("#gemini-sidebar-user-pill");
  if (!pill) {
    pill = document.createElement("button");
    pill.id = "gemini-sidebar-user-pill";
    pill.className = "gemini-sidebar-user";
    pill.type = "button";
    pill.setAttribute("aria-label", "User profile and settings");

    const avatarUrl = userAccountProfile.pictureUrl || DEFAULT_ACCOUNT.pictureUrl;
    const name = userAccountProfile.fullName || DEFAULT_ACCOUNT.fullName;
    const email = userAccountProfile.email || DEFAULT_ACCOUNT.email;
    const initial = (name || "Y").charAt(0).toUpperCase();

    pill.title = `${name} (${email})`;
    if (isSidebarCollapsed()) {
      pill.setAttribute("data-tooltip-position", "right");
    }

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "gemini-user-avatar-wrap";

    const img = document.createElement("img");
    img.className = "gemini-user-avatar";
    img.src = avatarUrl;
    img.alt = "";

    const fallback = document.createElement("div");
    fallback.className = "gemini-user-avatar-fallback";
    fallback.textContent = initial;

    img.addEventListener("error", () => {
      img.style.display = "none";
      fallback.style.display = "flex";
    });

    avatarWrap.appendChild(img);
    avatarWrap.appendChild(fallback);

    const textDiv = document.createElement("div");
    textDiv.className = "gemini-user-text";

    const nameSpan = document.createElement("span");
    nameSpan.className = "gemini-user-name";
    nameSpan.textContent = name;

    const emailSpan = document.createElement("span");
    emailSpan.className = "gemini-user-email";
    emailSpan.textContent = email;

    textDiv.appendChild(nameSpan);
    textDiv.appendChild(emailSpan);

    pill.appendChild(avatarWrap);
    pill.appendChild(textDiv);

    pill.addEventListener("click", (e) => {
      e.preventDefault();
      settingsBtn.click();
    });

    footer.insertBefore(pill, settingsBtn);
  } else if (pill.nextElementSibling !== settingsBtn) {
    footer.insertBefore(pill, settingsBtn);
  }
  if (isSidebarCollapsed()) {
    pill.setAttribute("data-tooltip-position", "right");
  } else {
    pill.removeAttribute("data-tooltip-position");
  }
}

plugin.dom.observe(SETTINGS_BTN_SELECTOR, (btn) => {
  const footer = btn.parentElement;
  if (!footer) return;
  ensureSidebarUserCard(footer);
  const obs = new MutationObserver(() => ensureSidebarUserCard(footer));
  obs.observe(footer, { childList: true });
  remember(footer, obs);
});

/* ---------------------------------------------------------------------------
 * Code blocks: Willow display language labels (CSS, JavaScript, Python, etc.)
 * ------------------------------------------------------------------------- */
const WILLOW_LANGUAGE_LABELS = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  go: "Go",
  html: "HTML",
  java: "Java",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  kotlin: "Kotlin",
  markdown: "Markdown",
  md: "Markdown",
  php: "PHP",
  plaintext: "Code",
  python: "Python",
  py: "Python",
  ruby: "Ruby",
  rust: "Rust",
  sh: "Bash",
  sql: "SQL",
  svg: "SVG",
  swift: "Swift",
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML"
};

function formatCodeBlockLanguage(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.data.trim();
      if (!raw) continue;
      const lower = raw.toLowerCase();
      const mapped = WILLOW_LANGUAGE_LABELS[lower] || (raw.length <= 4 ? raw.toUpperCase() : raw.charAt(0).toUpperCase() + raw.slice(1));
      if (node.data !== mapped) {
        node.data = mapped;
      }
    }
  }
}

plugin.dom.observe(".min-h-7 > .font-sans", (el) => {
  formatCodeBlockLanguage(el);
  const obs = new MutationObserver(() => formatCodeBlockLanguage(el));
  obs.observe(el, { characterData: true, childList: true });
  remember(el, obs);
});

plugin.onDispose(() => {
  document.removeEventListener("keydown", onComposerSubmitKey, true);
  document.removeEventListener("click", onComposerSubmitClick, true);
  if (typeof cancelComposerSlide === "function") cancelComposerSlide();
  for (const [, obs] of observers) {
    if (typeof obs?.disconnect === "function") obs.disconnect();
  }
  observers.clear();
  for (const added of document.querySelectorAll("[data-gemini-greeting]")) added.remove();
  for (const pill of document.querySelectorAll("#gemini-sidebar-user-pill")) pill.remove();
  if (!window.BetterGravity?.plugins?.isRunning?.("gemini-app")) {
    for (const chip of document.querySelectorAll("[data-gemini-tool-chip]")) chip.remove();
    for (const box of document.querySelectorAll(INPUT_BOX)) box.removeAttribute("data-expanded");
  }
});

/* ---------------------------------------------------------------------------
 * The workspace name and the local/git mode, in the pane's top bar
 *
 * Willow keeps the name of what you are in at the top left of the pane, with one
 * small control beside it (apps/studio/src/shell/TopDropdown.tsx:39-64).
 * Antigravity keeps both of those in the composer instead: the workspace button
 * in a row above the card, the environment button in a collapsible row inside it
 * — the row that made the home screen's card 96px tall where a conversation's is
 * 64px. conversation.css 3f draws the chips and home-composer.css takes the two
 * rows out of the composer's flow; this builds the stand-ins and hands their
 * clicks back to the originals.
 *
 * A stand-in rather than the original moved, for the reason a black screen taught
 * this plugin once already: both triggers are base-ui popovers mounted by React,
 * and a node React later cannot find where it left it takes the renderer down
 * with it. So the original stays in its tree, and a click on the copy parks the
 * original under the copy for as long as its menu is open, then clicks it there.
 * The menu opens under the chip because for that moment the anchor *is* the
 * chip's box: base-ui measures the trigger's `getBoundingClientRect()`, and the
 * trigger has been given the chip's.
 *
 * Parked rather than hidden, both here and in the stylesheet. An element with no
 * box has nothing for floating-ui to measure, and its menu lands in the corner of
 * the window.
 * ------------------------------------------------------------------------- */
const TOP_BAR_MORE = '[data-testid="titlebar-more-actions"]';

/**
 * Each chip, its original, and the row the original arrived in. The rows are
 * marked rather than described in CSS because neither has a name of its own: one
 * is `.no-focus-agent-input`, which is a focus behaviour and not a row, and the
 * other is a grid whose only distinguishing class is the property it animates.
 *
 * Both selectors exclude the chips themselves. A chip carries its original's
 * `aria-label` so a screen reader hears the same control, which makes the second
 * of these selectors match the chip too — and the chip comes first in the
 * document, so every lookup would answer with it. The environment chip would then
 * park itself and click itself, which is a click handler calling itself.
 */
const TOP_CHIPS = [
  { id: "workspace", trigger: '[data-testid="project-selector-trigger"]:not([data-gemini-top-chip])', row: ".no-focus-agent-input" },
  { id: "environment", trigger: '[aria-label="Select Environment"]:not([data-gemini-top-chip])', row: 'div[class*="transition-[grid-template-rows]"]' }
];

/**
 * The home route, and the box the chips are in while the app is on it.
 *
 * Together they are the tick's bail-out below: both originals belong to the home
 * screen's composer, so anywhere else there is nothing to build, and the only
 * reason to look at the document at all is to take away what the last screen
 * left behind.
 */
const HOME_ROUTE = "/";
let topChipHostEl = null;

/** The half of the pane's top bar the ⋮ button is not in. */
function topBarSlot() {
  const more = document.querySelector(TOP_BAR_MORE);
  const bar = more?.closest("div.justify-between");
  if (!bar) return null;
  for (const slot of bar.children) {
    if (!slot.contains(more)) return slot;
  }
  return null;
}

/**
 * The box the chips live in, appended to that slot.
 *
 * Appended, never inserted among React's own children: the slot holds
 * Antigravity's breadcrumb inside a conversation, and appending is the one edit
 * to a React parent that its next render can undo without noticing.
 */
function topChipHost() {
  const slot = topBarSlot();
  if (!slot) return null;
  let host = slot.querySelector(":scope > [data-gemini-top-chips]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.geminiTopChips = "";
    // The top bar is a window drag region. Antigravity marks its own controls
    // inside it this way, and the property behind the attribute is in the CSS.
    host.setAttribute("data-no-drag", "");
    slot.appendChild(host);
  }
  return host;
}

/** The label Antigravity shows in the trigger: the folder name, or "Local". */
function topChipLabel(trigger) {
  return (trigger.querySelector("span")?.textContent || trigger.textContent || "").trim();
}

/**
 * One chip, kept in step with its original.
 *
 * The contents are the original's own children, cloned — Antigravity's folder
 * glyph, its label, its caret — so the chip says what the trigger says and the
 * stylesheet decides which of those to draw. Cloned rather than serialised
 * through `innerHTML`, so a folder name is never text that gets parsed again.
 *
 * Rebuilt only when the label changes, because a rebuild throws away the nodes
 * the pointer may be over, and React rewrites this trigger on far more than a
 * change of folder.
 */
function ensureTopChip(spec, host) {
  const trigger = document.querySelector(spec.trigger);
  const existing = host.querySelector(`:scope > [data-gemini-top-chip="${spec.id}"]:not([data-gemini-top-static])`);
  if (!trigger) {
    existing?.remove();
    return;
  }

  // The row goes out of the composer's flow only once there is a chip standing in
  // for it. The guard is for a class that ever grows to cover the card itself:
  // a row with the editor or the send button in it is not a row.
  const row = trigger.closest(spec.row);
  if (row && !("geminiParkedRow" in row.dataset) && !row.querySelector('[contenteditable="true"], [data-testid="send-button"]')) {
    row.dataset.geminiParkedRow = "";
  }

  const label = topChipLabel(trigger);
  let chip = existing;
  if (!chip) {
    chip = document.createElement("button");
    chip.type = "button";
    chip.dataset.geminiTopChip = spec.id;
    chip.setAttribute("data-no-drag", "");
    chip.setAttribute("aria-expanded", "false");
    // Whether the press that is about to become a click found the menu open.
    // base-ui closes a popup on any pointer press outside it, and a chip is
    // outside its own menu, so by the time the click arrives the menu is already
    // gone and reopening it is what a second click would otherwise do.
    let wasOpen = false;
    chip.addEventListener("pointerdown", () => {
      wasOpen = chip.hasAttribute("data-gemini-open");
    });
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      // Still open here only if base-ui ignored the press, in which case closing
      // is this click's job after all.
      if (wasOpen) closeChipMenu(spec);
      else openChipMenu(spec, chip);
      wasOpen = false;
    });
    host.appendChild(chip);
  }

  if (chip.dataset.geminiTopChipLabel !== label || !chip.firstChild) {
    chip.dataset.geminiTopChipLabel = label;
    chip.replaceChildren(...Array.from(trigger.childNodes, (node) => node.cloneNode(true)));
  }

  // The label as the accessible name, which for the workspace chip is the only
  // place the word "project" survives. No `title`: this plugin's tooltips are
  // drawn for `[title]` alone, and Antigravity's own chips do not carry one.
  const aria = trigger.getAttribute("aria-label");
  if (aria && chip.getAttribute("aria-label") !== aria) chip.setAttribute("aria-label", aria);
  const haspopup = trigger.getAttribute("aria-haspopup");
  if (haspopup && chip.getAttribute("aria-haspopup") !== haspopup) chip.setAttribute("aria-haspopup", haspopup);
}

/**
 * The one trigger currently standing in for a chip, and everything needed to put
 * it back. One, because two menus are never open at once.
 */
let parkedTrigger = null;

function releaseParkedTrigger() {
  if (!parkedTrigger) return;
  const { trigger, chip, style, watcher, timer } = parkedTrigger;
  parkedTrigger = null;
  watcher?.disconnect();
  window.clearTimeout(timer);
  // The whole attribute rather than the properties it set: React writes inline
  // styles on these triggers, and this puts back exactly what was there.
  if (style === null) trigger.removeAttribute("style");
  else trigger.setAttribute("style", style);
  trigger.removeAttribute("data-gemini-parked");
  chip.removeAttribute("data-gemini-open");
  chip.setAttribute("aria-expanded", "false");
}

/** Closes the menu, if this chip's is the one still open. */
function closeChipMenu(spec) {
  const trigger = document.querySelector(spec.trigger);
  if (parkedTrigger && trigger && parkedTrigger.trigger === trigger) trigger.click();
}

function openChipMenu(spec, chip) {
  const trigger = document.querySelector(spec.trigger);
  if (!trigger) return;
  releaseParkedTrigger();

  const entry = { trigger, chip, style: trigger.getAttribute("style"), watcher: null, timer: 0 };
  const target = chip.getBoundingClientRect();
  const s = trigger.style;
  s.position = "fixed";
  s.margin = "0px";
  s.top = "0px";
  s.left = "0px";
  s.width = `${target.width}px`;
  s.height = `${target.height}px`;
  s.opacity = "0";
  s.pointerEvents = "none";
  // `position: fixed` is relative to the nearest transformed ancestor, not the
  // window, and on the home screen the composer's group is transformed
  // (home-composer.css centres it there). So the corner asked for above is not
  // the window's: measure where it landed and move by the difference.
  const landed = trigger.getBoundingClientRect();
  s.top = `${target.top - landed.top}px`;
  s.left = `${target.left - landed.left}px`;

  trigger.setAttribute("data-gemini-parked", "");
  chip.setAttribute("data-gemini-open", "");
  chip.setAttribute("aria-expanded", "true");

  let opened = false;
  const releaseIfCurrent = () => {
    if (parkedTrigger === entry) releaseParkedTrigger();
  };
  // Released on the way down, not on a timer: a trigger unparked while its menu
  // is open drags the menu back to where the trigger really lives, which is the
  // middle of the composer. So it stays parked until the menu has gone.
  entry.watcher = new MutationObserver(() => {
    if (trigger.getAttribute("aria-expanded") === "true") {
      opened = true;
      return;
    }
    if (opened) releaseIfCurrent();
  });
  entry.watcher.observe(trigger, { attributes: true, attributeFilter: ["aria-expanded"] });
  // Nothing opened at all: without this the trigger would stay parked, and its
  // row would stay marked, for the rest of the session.
  entry.timer = window.setTimeout(() => {
    if (!opened) releaseIfCurrent();
  }, 500);

  parkedTrigger = entry;
  trigger.click();
}

/** Both chips against whatever is on screen now. Hidden when inside a session. */
function reconcileTopChips() {
  // React can rebuild a trigger while its menu is open, which closes the menu
  // without ever writing `aria-expanded` on the node that was parked.
  if (parkedTrigger && !parkedTrigger.trigger.isConnected) releaseParkedTrigger();

  // Top chips only appear on screens where live triggers exist (e.g. home screen),
  // and do not appear when already inside a session.
  const live = TOP_CHIPS.some((spec) => document.querySelector(spec.trigger));
  const host = live ? topChipHost() : null;
  for (const stray of document.querySelectorAll("[data-gemini-top-chips]")) {
    if (stray !== host) stray.remove();
  }
  topChipHostEl = host;
  if (!host) return;
  for (const spec of TOP_CHIPS) ensureTopChip(spec, host);
}

/* Arrivals are caught as they happen, by the observer the runtime already runs
 * for every plugin selector. Departures are the ones nothing reports: no
 * element-scoped observer fires for its own element being taken away, and the
 * obvious answer — a `childList, subtree` observer on the document — is the
 * expensive one, because it then allocates a record for every mutation of a
 * streaming response for the rest of the session.
 *
 * So departures are noticed by a tick instead. It costs a handful of selector
 * matches, and it does that on every screen that shows the name, which since the
 * name follows the app into a conversation is every screen. What it never does is
 * grow with the page's own work: a reply arriving is thousands of mutations and
 * none of them reach this.
 *
 * A timer rather than a frame callback because a minimised window never runs a
 * frame, and a plugin that stops reconciling while the window is hidden comes
 * back to a page it no longer agrees with.
 */
plugin.dom.observe(TOP_BAR_MORE, () => reconcileTopChips());
for (const spec of TOP_CHIPS) plugin.dom.observe(spec.trigger, () => reconcileTopChips());

const topChipsTicker = window.setInterval(() => {
  if (location.pathname !== HOME_ROUTE && !topChipHostEl) return;
  reconcileTopChips();
}, 250);
reconcileTopChips();

plugin.onDispose(() => {
  window.clearInterval(topChipsTicker);
  releaseParkedTrigger();
  for (const host of document.querySelectorAll("[data-gemini-top-chips]")) host.remove();
  for (const row of document.querySelectorAll("[data-gemini-parked-row]")) row.removeAttribute("data-gemini-parked-row");
  const s = document.getElementById("gemini-theme-dynamic-styles");
  if (s) s.remove();
});


