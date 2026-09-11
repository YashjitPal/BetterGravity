/**
 * Agent Cursor Physics Engine
 * Extracted and reconstructed from module 2672
 * Features:
 * - 7-spring Euler integrator
 * - Bezier curve trajectory planner for arc movements
 * - Dynamic squash & stretch based on velocity
 * - Directional scoot rotation
 * - Thinking/breathing idle state oscillation
 * - Arrival event dispatch
 */

import { CURSOR_BASE64, CURSOR_CONFIG } from "./cursor-asset.js";

/**
 * Spring Simulation Model
 */
export class Spring {
  constructor(initialValue, targetValue, { dampingFraction = 0.85, response = 0.2 } = {}) {
    this.value = initialValue;
    this.target = targetValue;
    this.velocity = 0;
    this.dampingFraction = dampingFraction;
    this.response = response;
  }

  setConfig({ dampingFraction, response }) {
    if (dampingFraction != null) this.dampingFraction = dampingFraction;
    if (response != null) this.response = response;
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

/**
 * 2D Distance Helper
 */
function distance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate quadratic Bezier curve control point for natural mouse arcs
 */
function planBezierPath(start, end, bounds) {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const dist = distance(start, end);

  // Arc curvature perpendicular to direction
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const perpAngle = angle + (Math.PI / 2) * (start.x > end.x ? 1 : -1);
  const arcHeight = Math.min(dist * 0.25, 80);

  const ctrlX = Math.max(0, Math.min(bounds?.width || 1920, midX + Math.cos(perpAngle) * arcHeight));
  const ctrlY = Math.max(0, Math.min(bounds?.height || 1080, midY + Math.sin(perpAngle) * arcHeight));

  return { start, ctrl: { x: ctrlX, y: ctrlY }, end, dist };
}

function evaluateBezier(path, t) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  return {
    x: uu * path.start.x + 2 * u * t * path.ctrl.x + tt * path.end.x,
    y: uu * path.start.y + 2 * u * t * path.ctrl.y + tt * path.end.y,
  };
}

/**
 * Agent Cursor Controller
 */
export class AgentCursor {
  constructor(container, {
    assetUrl = CURSOR_BASE64,
    glowColor = CURSOR_CONFIG.defaultGlowColor,
    onArrived = null,
    dataTestId = "browser-agent-cursor",
  } = {}) {
    this.container = container;
    this.assetUrl = assetUrl;
    this.glowColor = glowColor;
    this.onArrived = onArrived;
    this.dataTestId = dataTestId;

    this.rafId = null;
    this.isDestroyed = false;
    this.lastTime = performance.now();
    this.arrivedSequence = null;

    // DOM Elements
    this.dom = this.createDom();

    // Physics State
    this.point = { x: 0, y: 0 };
    this.targetPoint = { x: 0, y: 0 };
    this.motion = null; // Bezier motion or direct spring
    this.thinkStartedAt = null;

    // 7 Springs
    const { springs } = CURSOR_CONFIG;
    this.positionXSpring = new Spring(0, 0, springs.position);
    this.positionYSpring = new Spring(0, 0, springs.position);
    this.rotationSpring = new Spring(-CURSOR_CONFIG.defaultRotationDeg, -CURSOR_CONFIG.defaultRotationDeg, springs.rotation);
    this.scootAxisSpring = new Spring(0, 0, springs.rotation);
    this.scootRotationSpring = new Spring(0, 0, springs.scootRotation);
    this.scootStretchSpring = new Spring(1, 1, springs.scootStretch);
    this.stretchSpring = new Spring(1, 1, springs.stretch);
    this.visibilitySpring = new Spring(0, 0, springs.visibility);

    // Bind loop
    this.tick = this.tick.bind(this);
  }

  createDom() {
    const layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "inset:0;overflow:hidden;pointer-events:none;position:absolute;z-index:9999;";

    const cursor = document.createElement("div");
    cursor.dataset.testid = this.dataTestId;
    cursor.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: ${CURSOR_CONFIG.containerSize}px;
      height: ${CURSOR_CONFIG.containerSize}px;
      transform-origin: ${CURSOR_CONFIG.originOffset}px ${CURSOR_CONFIG.originOffset}px;
      will-change: transform;
      opacity: 0;
    `;

    const offsetWrapper = document.createElement("div");
    offsetWrapper.style.transform = `translate3d(${CURSOR_CONFIG.translateX}px, ${CURSOR_CONFIG.translateY}px, 0)`;

    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    img.src = this.assetUrl;
    img.width = CURSOR_CONFIG.assetWidth;
    img.height = CURSOR_CONFIG.assetHeight;
    img.style.cssText = `
      display: block;
      transform-origin: 0 0;
      transform: rotate(${CURSOR_CONFIG.defaultRotationDeg}deg) scale(1);
      filter: ${CURSOR_CONFIG.getFilter(CURSOR_CONFIG.glowProperty)};
    `;
    img.style.setProperty(CURSOR_CONFIG.glowProperty, this.glowColor);

    offsetWrapper.appendChild(img);
    cursor.appendChild(offsetWrapper);
    layer.appendChild(cursor);
    this.container.appendChild(layer);

    return { layer, cursor, img, offsetWrapper };
  }

  /**
   * Update cursor target and state
   */
  setState({ cursor = null, isVisible = true, viewportSize = { width: 1920, height: 1080 }, turnKey = "" }) {
    const isVisibleBool = isVisible !== false && cursor?.visible !== false;
    const animate = cursor?.animateMovement !== false;
    this.visibilitySpring.target = isVisibleBool ? 1 : 0;

    if (cursor == null) {
      if (this.thinkStartedAt == null) {
        this.thinkStartedAt = performance.now();
      }
      this.startLoop();
      return;
    }

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

    // Bezier arc trajectory for long travels
    if (dist > CURSOR_CONFIG.bezierThreshold) {
      const path = planBezierPath(this.point, newTarget, viewportSize);
      this.motion = {
        mode: "bezier",
        path,
        progressSpring: new Spring(0, 1, { dampingFraction: 0.86, response: Math.max(0.35, Math.min(0.65, dist / 800)) }),
      };
    } else {
      this.motion = null;
      this.positionXSpring.target = newTarget.x;
      this.positionYSpring.target = newTarget.y;
    }

    // Velocity-based squash and stretch
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

    // Step visibility
    isBusy = this.visibilitySpring.step(dt) || isBusy;

    // Step motion
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

    // Step stretch and rotation springs
    isBusy = this.scootStretchSpring.step(dt) || isBusy;
    isBusy = this.scootAxisSpring.step(dt) || isBusy;
    isBusy = this.stretchSpring.step(dt) || isBusy;
    isBusy = this.rotationSpring.step(dt) || isBusy;

    // Apply Thinking / Idle breathing oscillation
    let idleTilt = 0;
    let idleScale = 1;
    if (this.thinkStartedAt != null) {
      const elapsed = (time - this.thinkStartedAt) / 1000;
      idleTilt = Math.sin(elapsed * 2.5) * 4; // subtle 4 deg breathing swing
      idleScale = 1.0 + Math.sin(elapsed * 3.2) * 0.05; // 5% scale pulse
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
    cursor.style.opacity = String(Math.max(0, Math.min(1, this.visibilitySpring.value)));

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
