// Computer Use — Desktop automation and agent cursor physics for Windows
//
// Brings OpenAI Codex & ChatGPT Computer Use capabilities to BetterGravity:
// - 7-spring Euler integrator physics engine
// - Quadratic Bezier trajectory planner with dynamic squash & stretch
// - Neon cyan/blue glow drop-shadow cursor
// - Three-tense verb formatting with Windows app normalizer
// - Cadenced shimmer sweep (steps(48, end)) & animated 3-dot wave
// - App security boundary & Codex approval modal
// - Audio click feedback synthesis via Web Audio
// - Composer @Computer mention pill
// - Real-time HTTP event bridge to MCP server & skills on port 51829

/* ── Settings Definition ─────────────────────────────────────────────────── */

let isConnected = false;
let currentAction = null;

const settings = plugin.settings.define({
  showCursor: {
    type: "boolean",
    label: "Show agent cursor",
    description: "Display simulated 7-spring cursor movement and neon glow when performing desktop actions.",
    default: true
  },
  requireApproval: {
    type: "boolean",
    label: "Require app approval",
    description: "Prompt for user confirmation before allowing the AI to control new desktop applications.",
    default: true
  },
  clickSounds: {
    type: "select",
    label: "Audio feedback",
    description: "Play sound effects when the AI performs mouse actions.",
    default: "foregroundClicks",
    options: [
      { value: "foregroundAndBackgroundClicks", label: "Play sounds for foreground and background clicks" },
      { value: "foregroundClicks", label: "Play sounds for foreground clicks" },
      { value: "off", label: "Don’t play sounds" }
    ]
  },
  lockedUse: {
    type: "boolean",
    label: "Locked use",
    description: "Allow controlling applications when Windows is locked.",
    default: false
  },
  status: {
    type: "note",
    label: "Bridge status",
    read() {
      return isConnected
        ? `Connected to Computer Use bridge (port 51829)${currentAction ? ` — ${currentAction}` : " — idle"}`
        : "Waiting for Computer Use agent on port 51829";
    }
  },
  resetPermissions: {
    type: "action",
    label: "App permissions",
    description: "Clear saved app approvals so all applications ask for permission again.",
    action: "Reset allowed apps",
    onSelect() {
      approvalManager.clearAlwaysAllowed();
      plugin.storage.set("alwaysAllowed", []);
      return "App permissions reset. Applications will ask for approval on next use.";
    }
  }
});

/* ── Extracted Cursor Asset & Config ─────────────────────────────────────── */

const CURSOR_BASE64 = "data:image/png;base64,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";

const CURSOR_CONFIG = {
  containerSize: 24,
  originOffset: 12,
  assetWidth: 23,
  assetHeight: 24,
  translateX: 12,
  translateY: -2.5,
  defaultRotationDeg: 44,
  glowProperty: "--browser-agent-cursor-glow-color",
  defaultGlowColor: "var(--color-accent-blue, #007aff)",
  springs: {
    stretch: { dampingFraction: 0.85, response: 0.2 },
    visibility: { dampingFraction: 0.86, response: 0.42 },
    press: { dampingFraction: 0.94, response: 0.19 },
    position: { dampingFraction: 0.9, response: 0.19 },
    rotation: { dampingFraction: 0.9, response: 0.12 },
    scootRotation: { dampingFraction: 0.82, response: 0.055 },
    scootStretch: { dampingFraction: 0.86, response: 0.12 }
  },
  minMoveThreshold: 0.5,
  bezierThreshold: 196
};

/* ── 7-Spring Euler Physics Integrator ───────────────────────────────────── */

class Spring {
  constructor(initialValue, targetValue, { dampingFraction = 0.85, response = 0.2 } = {}) {
    this.value = initialValue;
    this.target = targetValue;
    this.velocity = 0;
    this.dampingFraction = dampingFraction;
    this.response = response;
  }

  reset(val = 0) {
    this.value = val;
    this.target = val;
    this.velocity = 0;
  }

  step(dt) {
    if (this.response <= 0) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }

    const omega = (2 * Math.PI) / this.response;
    const zeta = this.dampingFraction;
    const f = 1.0 + 2.0 * dt * zeta * omega;
    const oo = omega * omega;
    const hoo = dt * oo;
    const hhoo = dt * hoo;
    const detInv = 1.0 / (f + hhoo);
    const detX = f * this.value + dt * this.velocity + hhoo * this.target;
    const detV = this.velocity + hoo * (this.target - this.value);

    this.value = detX * detInv;
    this.velocity = detV * detInv;

    const isSettled = Math.abs(this.velocity) < 0.001 && Math.abs(this.value - this.target) < 0.001;
    if (isSettled) {
      this.value = this.target;
      this.velocity = 0;
    }
    return !isSettled;
  }
}

function distance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function planBezierPath(start, end, bounds) {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const dist = distance(start, end);

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const perpAngle = angle + (Math.PI / 2) * (start.x > end.x ? 1 : -1);
  const arcHeight = Math.min(dist * 0.25, 80);

  const ctrlX = Math.max(0, Math.min(bounds?.width || window.innerWidth || 1920, midX + Math.cos(perpAngle) * arcHeight));
  const ctrlY = Math.max(0, Math.min(bounds?.height || window.innerHeight || 1080, midY + Math.sin(perpAngle) * arcHeight));

  return { start, ctrl: { x: ctrlX, y: ctrlY }, end, dist };
}

function evaluateBezier(path, t) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  return {
    x: uu * path.start.x + 2 * u * t * path.ctrl.x + tt * path.end.x,
    y: uu * path.start.y + 2 * u * t * path.ctrl.y + tt * path.end.y
  };
}

/* ── Agent Cursor Controller ─────────────────────────────────────────────── */

class AgentCursor {
  constructor(container, {
    assetUrl = CURSOR_BASE64,
    glowColor = CURSOR_CONFIG.defaultGlowColor,
    onArrived = null
  } = {}) {
    this.container = container;
    this.assetUrl = assetUrl;
    this.glowColor = glowColor;
    this.onArrived = onArrived;

    this.rafId = null;
    this.isDestroyed = false;
    this.lastTime = performance.now();
    this.arrivedSequence = null;

    this.dom = this.createDom();

    this.point = { x: 100, y: 100 };
    this.targetPoint = { x: 100, y: 100 };
    this.motion = null;
    this.thinkStartedAt = null;

    const { springs } = CURSOR_CONFIG;
    this.positionXSpring = new Spring(100, 100, springs.position);
    this.positionYSpring = new Spring(100, 100, springs.position);
    this.rotationSpring = new Spring(-CURSOR_CONFIG.defaultRotationDeg, -CURSOR_CONFIG.defaultRotationDeg, springs.rotation);
    this.scootAxisSpring = new Spring(0, 0, springs.rotation);
    this.scootRotationSpring = new Spring(0, 0, springs.scootRotation);
    this.scootStretchSpring = new Spring(1, 1, springs.scootStretch);
    this.stretchSpring = new Spring(1, 1, springs.stretch);
    this.visibilitySpring = new Spring(0, 0, springs.visibility);

    this.tick = this.tick.bind(this);
  }

  createDom() {
    const layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.className = "agent-cursor-container";

    const cursor = document.createElement("div");
    cursor.className = "agent-cursor-element agent-cursor-hidden";
    cursor.dataset.testid = "browser-agent-cursor";
    cursor.style.opacity = "0";
    cursor.style.display = "none";

    const offsetWrapper = document.createElement("div");
    offsetWrapper.style.transform = `translate3d(${CURSOR_CONFIG.translateX}px, ${CURSOR_CONFIG.translateY}px, 0)`;

    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    img.src = this.assetUrl;
    img.className = "agent-cursor-asset";
    img.width = CURSOR_CONFIG.assetWidth;
    img.height = CURSOR_CONFIG.assetHeight;
    img.style.transform = `rotate(${CURSOR_CONFIG.defaultRotationDeg}deg) scale(1)`;
    img.style.setProperty(CURSOR_CONFIG.glowProperty, this.glowColor);

    offsetWrapper.appendChild(img);
    cursor.appendChild(offsetWrapper);
    layer.appendChild(cursor);
    this.container.appendChild(layer);

    return { layer, cursor, img, offsetWrapper };
  }

  setState({ cursor = null, isVisible = true, viewportSize = { width: window.innerWidth || 1920, height: window.innerHeight || 1080 } }) {
    const isVisibleBool = isVisible !== false && cursor?.visible !== false && cursor != null;
    const animate = cursor?.animateMovement !== false;

    if (!isVisibleBool || cursor == null) {
      this.thinkStartedAt = null;
      this.visibilitySpring.target = 0;
      this.visibilitySpring.value = 0;
      this.visibilitySpring.velocity = 0;
      this.dom.cursor.classList.add("agent-cursor-hidden");
      this.dom.cursor.style.opacity = "0";
      this.dom.cursor.style.display = "none";
      return;
    }

    this.dom.cursor.classList.remove("agent-cursor-hidden");
    this.dom.cursor.style.display = "";
    this.visibilitySpring.target = 1;

    this.thinkStartedAt = null;
    const newTarget = { x: cursor.x, y: cursor.y };
    const dist = distance(this.point, newTarget);

    if (!animate || dist < CURSOR_CONFIG.minMoveThreshold) {
      this.point = { ...newTarget };
      this.targetPoint = { ...newTarget };
      this.positionXSpring.reset(newTarget.x);
      this.positionYSpring.reset(newTarget.y);
      this.motion = null;
      this.applyTransform();
      this.notifyArrival(cursor.moveSequence);
      return;
    }

    if (dist > CURSOR_CONFIG.bezierThreshold) {
      const path = planBezierPath(this.point, newTarget, viewportSize);
      this.motion = {
        mode: "bezier",
        path,
        progressSpring: new Spring(0, 1, { dampingFraction: 0.86, response: Math.max(0.35, Math.min(0.65, dist / 800)) })
      };
    } else {
      this.motion = null;
      this.positionXSpring.target = newTarget.x;
      this.positionYSpring.target = newTarget.y;
    }

    const angle = Math.atan2(newTarget.y - this.point.y, newTarget.x - this.point.x);
    this.scootAxisSpring.target = (angle * 180) / Math.PI;
    this.scootStretchSpring.value = Math.min(1.4, 1.0 + dist / 600);
    this.targetPoint = newTarget;
    this.currentSequence = cursor.moveSequence ?? null;

    this.startLoop();
  }

  notifyArrival(sequence) {
    if (sequence != null && this.arrivedSequence !== sequence) {
      this.arrivedSequence = sequence;
      this.onArrived?.(sequence);
    }
  }

  startLoop() {
    if (this.rafId == null && !this.isDestroyed) {
      this.lastTime = performance.now();
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  tick(time) {
    this.rafId = null;
    if (this.isDestroyed) return;

    const dt = Math.max(0.001, Math.min(0.1, (time - this.lastTime) / 1000));
    this.lastTime = time;

    let isBusy = false;
    isBusy = this.visibilitySpring.step(dt) || isBusy;

    if (this.motion && this.motion.mode === "bezier") {
      const motionBusy = this.motion.progressSpring.step(dt);
      isBusy = motionBusy || isBusy;
      const pos = evaluateBezier(this.motion.path, this.motion.progressSpring.value);
      this.point = pos;
      this.positionXSpring.reset(pos.x);
      this.positionYSpring.reset(pos.y);

      if (!motionBusy) {
        this.motion = null;
        this.point = { ...this.targetPoint };
        this.notifyArrival(this.currentSequence);
      }
    } else {
      const xBusy = this.positionXSpring.step(dt);
      const yBusy = this.positionYSpring.step(dt);
      isBusy = xBusy || yBusy || isBusy;
      this.point = { x: this.positionXSpring.value, y: this.positionYSpring.value };

      if (!xBusy && !yBusy && this.currentSequence != null) {
        this.notifyArrival(this.currentSequence);
      }
    }

    isBusy = this.scootStretchSpring.step(dt) || isBusy;
    isBusy = this.scootAxisSpring.step(dt) || isBusy;
    isBusy = this.stretchSpring.step(dt) || isBusy;
    isBusy = this.rotationSpring.step(dt) || isBusy;

    let idleTilt = 0;
    let idleScale = 1;
    if (this.thinkStartedAt != null) {
      const elapsed = (time - this.thinkStartedAt) / 1000;
      idleTilt = Math.sin(elapsed * 2.5) * 4;
      idleScale = 1.0 + Math.sin(elapsed * 3.2) * 0.05;
      isBusy = true;
    }

    this.applyTransform(idleTilt, idleScale);

    if (isBusy) {
      this.startLoop();
    }
  }

  applyTransform(idleTilt = 0, idleScale = 1) {
    const { cursor, img } = this.dom;
    const x = this.point.x;
    const y = this.point.y;
    const stretch = this.scootStretchSpring.value * idleScale;
    const squash = (1.0 / Math.sqrt(Math.max(0.2, stretch))) * idleScale;
    const rotation = this.rotationSpring.value + idleTilt;
    const axisAngle = this.scootAxisSpring.value;

    cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    const opacity = Math.max(0, Math.min(1, this.visibilitySpring.value));
    cursor.style.opacity = String(opacity);
    if (opacity < 0.01) {
      cursor.style.display = "none";
      cursor.classList.add("agent-cursor-hidden");
    } else {
      cursor.style.display = "";
      cursor.classList.remove("agent-cursor-hidden");
    }

    img.style.transform = `
      rotate(${axisAngle}deg)
      scale(${stretch}, ${squash})
      rotate(${-axisAngle}deg)
      rotate(${rotation}deg)
    `;
  }

  destroy() {
    this.isDestroyed = true;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.dom.layer.remove();
  }
}

/* ── Web Audio Feedback ──────────────────────────────────────────────────── */

let audioContext = null;

function playClickSound() {
  if (settings.clickSounds === "off") return;
  try {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioContext = new AudioCtx();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(850, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.024);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(now);
    osc.stop(now + 0.03);
  } catch {}
}

function shouldPlaySound(toolName) {
  if (settings.clickSounds === "off") return false;
  const isMouseAction = toolName === "click" || toolName === "drag" || toolName === "press_key" || toolName === "perform_accessibility_action";
  if (!isMouseAction) return false;
  if (settings.clickSounds === "foregroundClicks") {
    if (typeof document !== "undefined" && typeof document.hasFocus === "function") {
      return document.hasFocus();
    }
  }
  return true;
}

/* ── Windows App Normalizer & Three-Tense Tool Labels ────────────────────── */

const TOOL_LABELS_WINDOWS = {
  list_apps: {
    active: "Listing desktop apps",
    activeWithApp: "Listing desktop apps",
    completed: "Listed desktop apps",
    completedWithApp: "Listed desktop apps"
  },
  click: {
    active: "Clicking",
    activeWithApp: "Clicking in {appName}",
    completed: "Clicked",
    completedWithApp: "Clicked in {appName}"
  },
  drag: {
    active: "Dragging",
    activeWithApp: "Dragging in {appName}",
    completed: "Dragged",
    completedWithApp: "Dragged in {appName}"
  },
  get_app_state: {
    active: "Looking",
    activeWithApp: "Looking at {appName}",
    completed: "Looked",
    completedWithApp: "Looked at {appName}"
  },
  get_state: {
    active: "Looking",
    activeWithApp: "Looking at {appName}",
    completed: "Looked",
    completedWithApp: "Looked at {appName}"
  },
  perform_accessibility_action: {
    active: "Performing accessibility action",
    activeWithApp: "Performing action in {appName}",
    completed: "Performed accessibility action",
    completedWithApp: "Performed action in {appName}"
  },
  press_key: {
    active: "Pressing key",
    activeWithApp: "Pressing key in {appName}",
    completed: "Pressed key",
    completedWithApp: "Pressed key in {appName}"
  },
  scroll: {
    active: "Scrolling",
    activeWithDirection: "Scrolling {detail}",
    activeWithDirectionAndApp: "Scrolling {detail} in {appName}",
    activeWithApp: "Scrolling in {appName}",
    completed: "Scrolled",
    completedWithDirection: "Scrolled {detail}",
    completedWithDirectionAndApp: "Scrolled {detail} in {appName}",
    completedWithApp: "Scrolled in {appName}"
  },
  set_value: {
    active: "Setting value",
    activeWithDetail: "Setting to “{detail}”",
    activeWithDetailAndApp: "Setting to “{detail}” in {appName}",
    activeWithApp: "Setting value in {appName}",
    completed: "Set value",
    completedWithDetail: "Set to “{detail}”",
    completedWithDetailAndApp: "Set to “{detail}” in {appName}",
    completedWithApp: "Set value in {appName}"
  },
  type_text: {
    active: "Typing text",
    activeWithDetail: "Typing text “{detail}”",
    activeWithDetailAndApp: "Typing text “{detail}” in {appName}",
    activeWithApp: "Typing text in {appName}",
    completed: "Typed text",
    completedWithDetail: "Typed text “{detail}”",
    completedWithDetailAndApp: "Typed text “{detail}” in {appName}",
    completedWithApp: "Typed text in {appName}"
  }
};

function extractAppName(args) {
  if (!args) return null;
  const appObj = typeof args.app === "object" ? args.app : null;
  const directApp = typeof args.app === "string" ? args.app : null;

  const candidate = [
    directApp,
    appObj?.displayName,
    appObj?.display_name,
    appObj?.appName,
    appObj?.app_name,
    appObj?.name,
    appObj?.title,
    args.targetAppName,
    args.target_app_name,
    args.appName,
    args.app_name,
    args.displayName,
    args.display_name
  ].find((v) => v != null && typeof v === "string" && v.trim().length > 0);

  if (!candidate) return null;

  let cleaned = candidate.trim();
  if (cleaned.toLowerCase().startsWith("process:")) {
    cleaned = cleaned.slice(8).trim();
  }

  const uwpMatch = cleaned.match(/^[A-Za-z0-9.-]+_([A-Za-z0-9]+)!([A-Za-z0-9.-]+)/);
  if (uwpMatch) {
    const pkg = cleaned.split("_")[0];
    const parts = pkg.split(".");
    return parts[parts.length - 1];
  }

  if (cleaned.includes("\\") || cleaned.includes("/")) {
    cleaned = cleaned.split(/[\\/]/).pop();
  }

  if (cleaned.toLowerCase().endsWith(".exe")) {
    cleaned = cleaned.slice(0, -4);
  }

  const commonWindowsApps = {
    notepad: "Notepad",
    calc: "Calculator",
    msedge: "Microsoft Edge",
    excel: "Microsoft Excel",
    powerpnt: "Microsoft PowerPoint",
    winword: "Microsoft Word",
    explorer: "File Explorer",
    cmd: "Command Prompt",
    powershell: "PowerShell",
    windowsterminal: "Terminal"
  };

  const lower = cleaned.toLowerCase();
  if (commonWindowsApps[lower]) {
    return commonWindowsApps[lower];
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function extractActionDetail(toolName, args) {
  if (!args) return null;
  switch (toolName) {
    case "scroll":
      return args.direction || null;
    case "set_value":
      return args.value || args.targetValue || null;
    case "type_text":
      return args.text ? (args.text.length > 20 ? `${args.text.slice(0, 18)}…` : args.text) : null;
    default:
      return null;
  }
}

function formatToolLabel({ toolName, completed = false, toolArguments = {}, fallbackAppName = "PC" }) {
  const labels = TOOL_LABELS_WINDOWS[toolName] || TOOL_LABELS_WINDOWS.click;
  const appName = extractAppName(toolArguments) || fallbackAppName;
  const detail = extractActionDetail(toolName, toolArguments);

  let template = "";
  if (detail != null && appName != null) {
    template = completed
      ? (labels.completedWithDetailAndApp || labels.completedWithDirectionAndApp || labels.completedWithApp || labels.completed)
      : (labels.activeWithDetailAndApp || labels.activeWithDirectionAndApp || labels.activeWithApp || labels.active);
  } else if (detail != null) {
    template = completed
      ? (labels.completedWithDetail || labels.completedWithDirection || labels.completed)
      : (labels.activeWithDetail || labels.activeWithDirection || labels.active);
  } else if (appName != null) {
    template = completed
      ? (labels.completedWithApp || labels.completed)
      : (labels.activeWithApp || labels.active);
  } else {
    template = completed ? labels.completed : labels.active;
  }

  return template
    .replace("{appName}", appName)
    .replace("{detail}", detail || "");
}

/* ── App Security & Approval Manager ─────────────────────────────────────── */

class AppApprovalManager {
  constructor() {
    const saved = plugin.storage.get("alwaysAllowed");
    const initial = Array.isArray(saved) ? saved : ["process:notepad.exe", "process:calc.exe", "notepad.exe", "calc.exe"];
    this.alwaysAllowed = new Set(initial);
    this.sessionAllowed = new Set();
    this.pendingResolvers = new Map();
  }

  isAppAllowed(appId) {
    if (!appId || BetterGravity.plugins.isRunning("yolo")) return true;
    const normalized = appId.toLowerCase();
    return this.alwaysAllowed.has(normalized) || this.sessionAllowed.has(normalized);
  }

  allowSession(appId) {
    if (appId) this.sessionAllowed.add(appId.toLowerCase());
  }

  allowAlways(appId) {
    if (appId) {
      const normalized = appId.toLowerCase();
      this.alwaysAllowed.add(normalized);
      plugin.storage.set("alwaysAllowed", Array.from(this.alwaysAllowed));
    }
  }

  clearAlwaysAllowed() {
    this.alwaysAllowed.clear();
  }
}

const approvalManager = new AppApprovalManager();

/* ── Approval Modal Dialog ───────────────────────────────────────────────── */

let currentModal = null;

function showApprovalDialog({ appName, appId, toolName, onApprove, onAlwaysApprove, onCancel }) {
  if (currentModal) {
    currentModal.remove();
    currentModal = null;
  }

  const backdrop = document.createElement("div");
  backdrop.className = "cu-modal-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");

  const card = document.createElement("div");
  card.className = "cu-modal-card cu-surface";

  card.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
      <div style="width: 38px; height: 38px; border-radius: 9px; background: linear-gradient(135deg, #007aff, #5856d6); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; font-size: 16px; flex-shrink: 0;">
        ${(appName && appName[0]) ? appName[0].toUpperCase() : "A"}
      </div>
      <div>
        <h3 style="margin: 0; font-size: 17px; font-weight: 600;">Allow Antigravity to use ${appName}?</h3>
        <p style="margin: 2px 0 0; font-size: 13px; color: var(--text-secondary, #8e8e93);">
          Action requested: <code>${toolName}</code>
        </p>
      </div>
    </div>
    <p style="font-size: 14px; line-height: 1.5; margin: 0 0 20px 0; color: var(--text-primary, inherit);">
      Antigravity is requesting control to interact with <strong>${appName}</strong> on your computer.
      You can approve this conversation or always allow access.
    </p>
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <button type="button" class="cu-btn-primary" id="cu-approve-session">Allow this conversation</button>
      <button type="button" class="cu-btn-secondary" id="cu-approve-always">Always allow</button>
      <button type="button" class="cu-btn-cancel" id="cu-approve-cancel">Cancel</button>
    </div>
  `;

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);
  currentModal = backdrop;

  const close = () => {
    if (currentModal === backdrop) {
      backdrop.remove();
      currentModal = null;
    }
  };

  card.querySelector("#cu-approve-session").addEventListener("click", () => {
    close();
    onApprove?.();
  });
  card.querySelector("#cu-approve-always").addEventListener("click", () => {
    close();
    onAlwaysApprove?.();
  });
  card.querySelector("#cu-approve-cancel").addEventListener("click", () => {
    close();
    onCancel?.();
  });
}

/* ── Activity Status Badge & Cadenced Shimmer ────────────────────────────── */

let activityElement = null;
let activityDismissTimer = null;

function ensureActivityBadge() {
  if (!activityElement || !activityElement.isConnected) {
    activityElement = document.createElement("div");
    activityElement.className = "cu-activity-container cu-floating-activity cu-surface";
    activityElement.style.display = "none";
    document.body.appendChild(activityElement);
  }
  return activityElement;
}

function updateActivityBadge({ label, isRunning = true }) {
  const el = ensureActivityBadge();
  if (activityDismissTimer) {
    clearTimeout(activityDismissTimer);
    activityDismissTimer = null;
  }

  const iconSvg = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; color: var(--color-accent-blue, #007aff);">
      <rect width="14" height="8" x="5" y="2" rx="2"/>
      <rect width="20" height="8" x="2" y="14" rx="2"/>
      <path d="M6 18h2"/>
      <path d="M12 18h6"/>
    </svg>
  `;

  if (isRunning) {
    el.innerHTML = `
      ${iconSvg}
      <span class="cu-cadenced-shimmer">
        <span>${label}</span>
        <span class="cu-cadenced-sweep" aria-hidden="true">
          <span class="cu-cadenced-highlight">${label}</span>
        </span>
        <span class="cu-dot-wave">
          <span class="cu-dot"></span>
          <span class="cu-dot"></span>
          <span class="cu-dot"></span>
        </span>
      </span>
    `;
    el.style.display = "flex";
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  } else {
    el.innerHTML = `
      ${iconSvg}
      <span class="cu-detail-solid">${label}</span>
    `;
    el.style.display = "flex";
    activityDismissTimer = setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(8px)";
      setTimeout(() => {
        if (el.style.opacity === "0") el.style.display = "none";
      }, 300);
    }, 2400);
  }
}

/* ── Agent Cursor Mounting ───────────────────────────────────────────────── */

let cursorInstance = null;

function cleanupStuckDomCursors() {
  try {
    const stuck = document.querySelectorAll(".agent-cursor-element, .agent-cursor-container");
    stuck.forEach((el) => {
      if (cursorInstance && (el === cursorInstance.dom?.layer || el === cursorInstance.dom?.cursor)) return;
      el.remove();
    });
  } catch {}
}

function setupAgentCursor() {
  cleanupStuckDomCursors();
  if (cursorInstance) return;
  cursorInstance = new AgentCursor(document.body, {
    glowColor: "var(--color-accent-blue, #007aff)"
  });
}

function tearDownAgentCursor() {
  if (cursorInstance) {
    cursorInstance.destroy();
    cursorInstance = null;
  }
  cleanupStuckDomCursors();
}

setupAgentCursor();

/* ── Mention Pill (Omitted in favor of native Antigravity tool chip) ── */

/* ── Title Bar Toggle Button ─────────────────────────────────────────────── */

let titleBarButton = null;
try {
  const COMPUTER_ICON = "M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-640v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H160v400Zm240 0v-400 400Z";
  titleBarButton = plugin.ui.button({
    area: "titleBar",
    label: "Computer",
    icon: COMPUTER_ICON,
    tooltip: "Toggle Computer Use agent cursor",
    onClick() {
      settings.showCursor = !settings.showCursor;
      titleBarButton?.setActive(settings.showCursor);
      if (cursorInstance) {
        cursorInstance.setState({ isVisible: settings.showCursor });
      }
    }
  });
  titleBarButton.setActive(settings.showCursor);
} catch {}

/* ── HTTP Event Bridge from mcp-server.cjs on port 51829 ─────────────────── */

const BRIDGE_PORT = 51829;
let processedEvents = new Set();
const lastActiveArgsByTool = new Map();

function extractCoordinates(args) {
  if (!args) return null;
  const candidates = [args.target, args.to, args.from, args.coordinates, args.point, args.pos];
  for (const c of candidates) {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      return { x: c[0], y: c[1] };
    }
    if (c && typeof c === "object" && typeof c.x === "number" && typeof c.y === "number") {
      return { x: c.x, y: c.y };
    }
  }
  if (typeof args.x === "number" && typeof args.y === "number") {
    return { x: args.x, y: args.y };
  }
  return null;
}

function handleBridgeEvent(event) {
  if (!event || !event.type) return;

  const eventKey = event.id != null ? `id:${event.id}` : `${event.type}:${event.toolName || ""}:${event.timestamp || ""}`;
  if (processedEvents.has(eventKey)) return;
  processedEvents.add(eventKey);
  if (processedEvents.size > 300) {
    const first = processedEvents.values().next().value;
    processedEvents.delete(first);
  }

  const { type, toolName, args = {} } = event;

  if (type === "tool_start") {
    lastActiveArgsByTool.set(toolName, args);
    currentAction = formatToolLabel({ toolName, completed: false, toolArguments: args });
    const appName = extractAppName(args);
    const appId = (typeof args.app === "string" ? args.app : args.app?.id || appName) || "";

    // Security check
    if (settings.requireApproval && appId && !approvalManager.isAppAllowed(appId)) {
      showApprovalDialog({
        appName: appName || appId,
        appId,
        toolName,
        onApprove: () => {
          approvalManager.allowSession(appId);
        },
        onAlwaysApprove: () => {
          approvalManager.allowAlways(appId);
        },
        onCancel: () => {}
      });
    }

    // UI Updates
    updateActivityBadge({ label: currentAction, isRunning: true });
    if (shouldPlaySound(toolName)) {
      playClickSound();
    }

    // Cursor Movement
    if (settings.showCursor && cursorInstance) {
      const coords = extractCoordinates(args);
      if (coords) {
        cursorInstance.setState({
          cursor: {
            x: coords.x,
            y: coords.y,
            visible: true,
            animateMovement: true
          },
          isVisible: true
        });
      }
    }
  } else if (type === "tool_complete") {
    const effectiveArgs = (args && Object.keys(args).length > 0) ? args : (lastActiveArgsByTool.get(toolName) || {});
    lastActiveArgsByTool.delete(toolName);
    const completedLabel = formatToolLabel({ toolName, completed: true, toolArguments: effectiveArgs });
    currentAction = null;
    updateActivityBadge({ label: completedLabel, isRunning: false });

    if (cursorInstance) {
      cursorInstance.setState({ cursor: null, isVisible: false });
    }
  }
}

// 1. Server-Sent Events stream connection
let eventSource = null;

function connectEventSource() {
  try {
    eventSource = new EventSource(`http://127.0.0.1:${BRIDGE_PORT}/events`);
    eventSource.onopen = () => {
      isConnected = true;
    };
    eventSource.onerror = () => {
      isConnected = false;
    };
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handleBridgeEvent(data);
      } catch {}
    };
  } catch {}
}

connectEventSource();

// 2. Periodic poll fallback when SSE is not active
const pollInterval = setInterval(() => {
  if (isConnected && eventSource && eventSource.readyState === 1) return;
  fetch(`http://127.0.0.1:${BRIDGE_PORT}/poll`)
    .then((r) => r.json())
    .then((events) => {
      if (Array.isArray(events)) {
        if (events.length > 0) isConnected = true;
        for (const ev of events) {
          handleBridgeEvent(ev);
        }
      }
    })
    .catch(() => {});
}, 600);

/* ── Cleanup on Plugin Dispose ───────────────────────────────────────────── */

plugin.onDispose(() => {
  tearDownAgentCursor();
  titleBarButton?.remove();
  if (activityElement) {
    activityElement.remove();
    activityElement = null;
  }
  if (currentModal) {
    currentModal.remove();
    currentModal = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  clearInterval(pollInterval);
  if (audioContext) {
    try { audioContext.close(); } catch {}
    audioContext = null;
  }
});
