var CodexBrowserCursor = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // <stdin>
  var stdin_exports = {};
  __export(stdin_exports, {
    createCursor: () => createCursor
  });

  // cursor:cursor-init
  var n = (initialize) => {
    let initialized = false;
    return () => {
      if (!initialized) {
        initialized = true;
        initialize();
      }
    };
  };

  // cursor:cursor-math
  function bNn({ bounds: e, end: t, start: n2 }) {
    return kNn(wNn({ bounds: e, config: JNn, end: t, start: n2 }), e, JNn);
  }
  function xNn(e, t) {
    let n2 = YO(t, 0, 1), r = n2 === 1 ? e.segments.length - 1 : n2 * e.segments.length, i = Math.floor(r), a = e.segments[i];
    if (a == null) throw Error(`Cursor motion path has no segment for progress`);
    let o = e.segments[i - 1], s = i === 0 ? e.start : o?.end;
    if (s == null) throw Error(`Cursor motion path segment is missing its start point`);
    let c2 = n2 === 1 ? 1 : r - i;
    return { point: INn(s, a, c2), tangent: RNn(s, a, c2) };
  }
  function SNn(e) {
    if (JO({ x: 0, y: 0 }, e) < 1e-3) return UNn(-44);
    let t = BNn(e);
    return UNn(Math.atan2(t.y, t.x) * (180 / Math.PI) + 90);
  }
  function JO(e, t) {
    let n2 = t.x - e.x, r = t.y - e.y;
    return Math.sqrt(n2 * n2 + r * r);
  }
  function CNn(e) {
    return { dampingFraction: WNn, response: NNn(e) };
  }
  function YO(e, t, n2) {
    return Math.max(t, Math.min(n2, e));
  }
  function wNn({ bounds: e, config: t, end: n2, start: r }) {
    let i = FNn(t.clickAngleDegrees), a = JO(r, n2), o = { x: n2.x - r.x, y: n2.y - r.y }, s = BNn(o), c2 = Math.max(48, Math.min(640, a * t.startHandle, a * 0.9)), l2 = Math.max(48, Math.min(640, a * t.endpointHandle, a * 0.9)), u2 = { x: -i.x, y: -i.y }, d2 = PNn(e, r, i, c2), f2 = PNn(e, n2, u2, l2), p2 = { x: -s.y, y: s.x }, m2 = p2.x * i.x + p2.y * i.y >= 0 ? 1 : -1, h2 = { x: p2.x * m2, y: p2.y * m2 }, g2 = zNn(r, n2), _2 = PNn(e, r, i, c2 * 0.65), v2 = PNn(e, n2, u2, l2 * 0.65), y2 = BNn(o), b2 = Math.max(50, Math.min(520, a * t.arcSize)), x2 = Math.max(38, Math.min(440, a * t.arcFlow)), S2 = [0.55, 0.8, 1.05], C2 = [0.65, 1, 1.35], w2 = [DNn(r, n2, d2, f2), DNn(r, n2, _2, v2)];
    for (let e2 of S2) for (let t2 of C2) TNn({ arcDistanceBase: b2, arcDistanceScale: e2, arcHandleDistanceBase: x2, arcHandleScale: t2, arcTangent: y2, candidates: w2, end: n2, endControl: f2, midpoint: g2, naturalArcNormal: h2, start: r, startControl: d2, startControlDistance: c2, clickTangent: i });
    return w2.slice(0, t.candidateCount);
  }
  function TNn({ arcDistanceBase: e, arcDistanceScale: t, arcHandleDistanceBase: n2, arcHandleScale: r, arcTangent: i, candidates: a, clickTangent: o, end: s, endControl: c2, midpoint: l2, naturalArcNormal: u2, start: d2, startControl: f2, startControlDistance: p2 }) {
    ENn({ arcDistanceBase: e, arcDistanceScale: t, arcHandleDistanceBase: n2, arcHandleScale: r, arcNormal: u2, arcTangent: i, candidates: a, clickTangent: o, end: s, endControl: c2, midpoint: l2, start: d2, startControl: f2, startControlDistance: p2 }), ENn({ arcDistanceBase: e, arcDistanceScale: t, arcHandleDistanceBase: n2, arcHandleScale: r, arcNormal: { x: -u2.x, y: -u2.y }, arcTangent: i, candidates: a, clickTangent: o, end: s, endControl: c2, midpoint: l2, start: d2, startControl: f2, startControlDistance: p2 });
  }
  function ENn({ arcDistanceBase: e, arcDistanceScale: t, arcHandleDistanceBase: n2, arcHandleScale: r, arcNormal: i, arcTangent: a, candidates: o, clickTangent: s, end: c2, endControl: l2, midpoint: u2, start: d2, startControl: f2, startControlDistance: p2 }) {
    let m2 = e * t, h2 = n2 * r, g2 = { x: u2.x + i.x * m2 + s.x * p2 * 0.16, y: u2.y + i.y * m2 + s.y * p2 * 0.16 }, _2 = { x: g2.x - a.x * h2, y: g2.y - a.y * h2 }, v2 = { x: g2.x + a.x * h2, y: g2.y + a.y * h2 };
    o.push(ONn({ arc: g2, arcIn: _2, arcOut: v2, end: c2, endControl: l2, start: d2, startControl: f2 }));
  }
  function DNn(e, t, n2, r) {
    return { arc: null, arcIn: null, arcOut: null, end: t, endControl: r, segments: [{ control1: n2, control2: r, end: t }], start: e, startControl: n2 };
  }
  function ONn({ arc: e, arcIn: t, arcOut: n2, end: r, endControl: i, start: a, startControl: o }) {
    return { arc: e, arcIn: t, arcOut: n2, end: r, endControl: i, segments: [{ control1: o, control2: t, end: e }, { control1: n2, control2: i, end: r }], start: a, startControl: o };
  }
  function kNn(e, t, n2) {
    let r = e[0];
    if (r == null) throw Error(`Cursor motion requires at least one candidate`);
    let i = r, a = 1 / 0, o = r, s = 1 / 0;
    for (let r2 of e) {
      let e2 = ANn(r2, t, n2), c2 = jNn(r2, e2);
      c2 < s && (o = r2, s = c2), e2.staysInBounds && c2 < a && (i = r2, a = c2);
    }
    return a === 1 / 0 ? o : i;
  }
  function ANn(e, t, n2) {
    let r = 0, i = 0, a = 0, o = 0, s = null, c2 = t == null || n2 == null || VNn(e.start, t, n2.boundsMargin), l2 = e.start, u2 = e.start;
    for (let d2 of e.segments) {
      for (let e2 = 1; e2 <= 24; e2 += 1) {
        let f2 = e2 / 24, p2 = LNn(l2, d2.control1, d2.control2, d2.end, f2);
        r += JO(u2, p2), t != null && n2 != null && (c2 &&= VNn(p2, t, n2.boundsMargin));
        let m2 = { x: p2.x - u2.x, y: p2.y - u2.y };
        if (JO({ x: 0, y: 0 }, m2) > 0.01) {
          let e3 = Math.atan2(m2.y, m2.x);
          if (s != null) {
            let t2 = HNn(s, e3);
            i += t2 * t2, a = Math.max(a, Math.abs(t2)), o += Math.abs(t2);
          }
          s = e3;
        }
        u2 = p2;
      }
      l2 = d2.end;
    }
    return { angleChangeEnergy: i, length: r, maxAngleChange: a, staysInBounds: c2, totalTurn: o };
  }
  function jNn(e, t) {
    let n2 = Math.max(1, JO(e.start, e.end)), r = Math.max(0, t.length / n2 - 1), i = e.arc == null ? 0 : 45, a = MNn(e);
    return t.length + r * 320 + t.angleChangeEnergy * 140 + t.maxAngleChange * 180 + t.totalTurn * 18 + a * 90 + i;
  }
  function MNn(e) {
    let t = FNn(-44), n2 = BNn({ x: e.end.x - e.start.x, y: e.end.y - e.start.y });
    return YO((-(n2.x * t.x + n2.y * t.y) - 0.08) / 0.92, 0, 1);
  }
  function NNn(e) {
    let t = ANn(e), n2 = Math.max(1, JO(e.start, e.end)), r = Math.max(0, t.length / n2 - 1), i = YO((t.length - 180) / 760, 0, 1), a = YO(r / 0.55, 0, 1), o = YO(t.totalTurn / (Math.PI * 1.4), 0, 1), s = YO(t.angleChangeEnergy / 1.25, 0, 1), c2 = YO(a * 0.42 + o * 0.38 + s * 0.2, 0, 1), l2 = MNn(e), u2 = e.arc == null ? 0 : 0.04, d2 = l2 * 0.28, f2 = e.arc == null ? 1 : 0.9;
    return YO((0.42 + i * 0.22 + c2 * 0.12 + d2 + u2) * qNn * f2, KNn, GNn);
  }
  function PNn(e, t, n2, r) {
    let i = r;
    return n2.x < 0 && (i = Math.min(i, t.x / -n2.x)), n2.x > 0 && (i = Math.min(i, (e.width - t.x) / n2.x)), n2.y < 0 && (i = Math.min(i, t.y / -n2.y)), n2.y > 0 && (i = Math.min(i, (e.height - t.y) / n2.y)), { x: t.x + n2.x * Math.max(0, i), y: t.y + n2.y * Math.max(0, i) };
  }
  function FNn(e) {
    let t = Math.PI / 180 * e;
    return { x: Math.sin(t), y: -Math.cos(t) };
  }
  function INn(e, t, n2) {
    return LNn(e, t.control1, t.control2, t.end, n2);
  }
  function LNn(e, t, n2, r, i) {
    let a = 1 - i, o = a * a * a, s = 3 * a * a * i, c2 = 3 * a * i * i, l2 = i * i * i;
    return { x: e.x * o + t.x * s + n2.x * c2 + r.x * l2, y: e.y * o + t.y * s + n2.y * c2 + r.y * l2 };
  }
  function RNn(e, t, n2) {
    let r = 1 - n2;
    return { x: 3 * r * r * (t.control1.x - e.x) + 6 * r * n2 * (t.control2.x - t.control1.x) + 3 * n2 * n2 * (t.end.x - t.control2.x), y: 3 * r * r * (t.control1.y - e.y) + 6 * r * n2 * (t.control2.y - t.control1.y) + 3 * n2 * n2 * (t.end.y - t.control2.y) };
  }
  function zNn(e, t) {
    return { x: (e.x + t.x) / 2, y: (e.y + t.y) / 2 };
  }
  function BNn(e) {
    let t = Math.sqrt(e.x * e.x + e.y * e.y);
    return t < 1e-3 ? { x: 1, y: 0 } : { x: e.x / t, y: e.y / t };
  }
  function VNn(e, t, n2) {
    return e.x >= n2 && e.x <= t.width - n2 && e.y >= n2 && e.y <= t.height - n2;
  }
  function HNn(e, t) {
    let n2 = t - e;
    for (; n2 > Math.PI; ) n2 -= Math.PI * 2;
    for (; n2 < -Math.PI; ) n2 += Math.PI * 2;
    return n2;
  }
  function UNn(e) {
    let t = e % 360;
    return t < 0 ? t + 360 : t;
  }
  var WNn;
  var GNn;
  var KNn;
  var qNn;
  var JNn;
  var YNn = (() => {
    WNn = 0.9, GNn = 2.2, KNn = 0.12, qNn = 0.7, JNn = { arcFlow: 0.5783555327868779, arcSize: 0.2765523188064277, boundsMargin: 20, candidateCount: 20, clickAngleDegrees: -44, endpointHandle: 0.15, startHandle: 0.41960295031576633 };
  });

  // cursor:cursor-renderer
  function c(e, { assetUrl: n2, dataTestId: r = `browser-agent-cursor`, glowColor: i, onArrived: a }) {
    let o = l(e, n2, r, i), s = null, c2 = I(), f2 = null, p2 = null, m2 = null, h2 = null, g2 = null, _2 = null, v2 = false, y2 = false, x2 = () => {
      m2 == null || p2 == null || g2 === p2 || (g2 = p2, a?.(m2));
    }, S2 = () => {
      s != null || f2 == null || y2 || (s = fe((e2) => {
        s = null;
        let t = f2;
        if (t == null) return;
        let n3 = v2 ? q : Math.max(q, (e2 - c2) / 1e3);
        v2 = false, c2 = e2;
        let r2 = ee(t, n3, e2);
        b(o, t), r2 && x2(), te(t) && S2();
      }));
    };
    return { destroy: () => {
      y2 = true, s != null && (pe(s), s = null), o.layer.remove();
    }, setState: (e2) => {
      let n3 = e2.turnKey ?? ``, r2 = e2.cursor != null, i2 = ne({ cursorX: e2.cursor?.x, cursorY: e2.cursor?.y, viewportHeight: e2.viewportSize.height, viewportWidth: e2.viewportSize.width }), a2 = e2.isVisible !== false && e2.cursor?.visible !== false, s2 = e2.cursor?.animateMovement !== false, c3 = a2 && !r2;
      if (m2 = e2.cursor?.moveSequence ?? null, p2 = m2 == null ? null : `${n3}:${m2}`, f2 ??= u(i2, a2), f2.visibilitySpring.target = +!!a2, c3 && h2 !== n3 && (h2 = n3, A(f2.visibilitySpring, 1), f2.thinkStartedAt = I()), !r2) {
        T(f2, i2), b(o, f2), S2();
        return;
      }
      let l2 = e2.cursor?.moveSequence != null && a2 && f2.visibilitySpring.value <= 1e-3 && _2 !== n3;
      f2.thinkStartedAt = null;
      let ee2 = JO(f2.point, i2);
      if (!s2 || l2 || ee2 < 0.5) {
        l2 && (_2 = n3, A(f2.visibilitySpring, 1)), T(f2, i2), s2 || (f2.stretchSpring.force = 0, f2.stretchSpring.value = 1, f2.stretchSpring.velocity = 0), b(o, f2), x2(), S2();
        return;
      }
      d(f2, i2, e2.viewportSize), v2 = true, b(o, f2), S2();
    } };
  }
  function l(e, t, n2, r) {
    let i = document.createElement(`div`);
    i.setAttribute(`aria-hidden`, `true`), i.style.inset = `0`, i.style.overflow = `hidden`, i.style.pointerEvents = `none`, i.style.position = `absolute`, i.style.zIndex = `20`;
    let a = document.createElement(`div`);
    a.dataset.testid = n2, a.style.height = `${L}px`, a.style.left = `0`, a.style.position = `absolute`, a.style.top = `0`, a.style.transformOrigin = `${R}px ${R}px`, a.style.willChange = `transform`, a.style.width = `${L}px`;
    let o = document.createElement(`div`);
    o.style.transform = `translate3d(${V}px, ${H}px, 0)`;
    let s = document.createElement(`img`);
    return s.alt = ``, s.dataset.browserAgentCursorAsset = ``, s.dataset.testid = `${n2}-asset`, s.draggable = false, s.height = B, s.src = t, s.style.display = `block`, s.style.setProperty(W, r), s.style.filter = G, s.style.transform = `rotate(${U}deg) scale(1)`, s.style.transformOrigin = `0 0`, s.width = z, o.appendChild(s), a.appendChild(o), i.appendChild(a), e.appendChild(i), { cursor: a, layer: i };
  }
  function u(e, t) {
    let n2 = +!!t, r = P(-44);
    return { motion: null, point: e, positionXSpring: k(e.x, e.x, Q), positionYSpring: k(e.y, e.y, Q), rotation: r, rotationSpring: k(r, r, $), scootAxisRotation: 0, scootAxisSpring: k(0, 0, $), scootRotationSpring: k(0, 0, ke), scootStretchSpring: k(1, 1, Ae), stretchSpring: k(1, 1, Ee), thinkStartedAt: null, visibilitySpring: k(n2, n2, De) };
  }
  function d(e, n2, r) {
    e.thinkStartedAt = null;
    let o = { x: e.point.x, y: e.point.y };
    if (JO(o, n2) <= Se) {
      f(e, o, n2);
      return;
    }
    let s = bNn({ bounds: r, end: n2, start: o }), c2 = CNn(s);
    C(e, oe(c2.response), c2.dampingFraction), e.motion = { mode: `bezier`, path: s, progressSpring: k(0, 1, c2) };
  }
  function f(e, t, n2) {
    let r = p(t, n2);
    C(e, Q.response, Q.dampingFraction), e.positionXSpring.target = n2.x, e.positionYSpring.target = n2.y, D(e.rotationSpring, P(-44)), D(e.scootAxisSpring, r.axisRotation), e.motion = { axisRotation: r.axisRotation, end: n2, mode: `scoot`, progressSpring: k(0, 1, Oe), rotationTarget: r.rotationTarget, start: t };
  }
  function p(e, t) {
    let n2 = ue({ x: t.x - e.x, y: t.y - e.y });
    return { axisRotation: m(n2), rotationTarget: h(n2) };
  }
  function m(e) {
    return JO({ x: 0, y: 0 }, e) < 1e-3 ? 0 : Math.atan2(e.y, e.x) * (180 / Math.PI);
  }
  function h(e) {
    return YO(e.x * 0.75 + -e.y * 0.62, -1, 1) * Ce;
  }
  function ee(e, t, n2) {
    let r = g(e, t, n2);
    return j(e.visibilitySpring, t), j(e.stretchSpring, t), j(e.scootStretchSpring, t), j(e.scootRotationSpring, t), r;
  }
  function g(e, t, n2) {
    if (e.motion == null) return e.stretchSpring.target = 1, e.scootStretchSpring.target = 1, e.scootRotationSpring.target = 0, false;
    let r = Math.max(0, t);
    return e.thinkStartedAt = null, e.motion.mode === `scoot` ? v(e, r, n2) : _(e, r, n2);
  }
  function _(e, t, i) {
    let a = e.motion;
    if (a?.mode !== `bezier`) return false;
    e.scootStretchSpring.target = 1, e.scootRotationSpring.target = 0, j(a.progressSpring, t);
    let o = YO(a.progressSpring.value, 0, 1), c2 = xNn(a.path, o), l2 = SNn(c2.tangent);
    e.positionXSpring.target = c2.point.x, e.positionYSpring.target = c2.point.y, D(e.rotationSpring, l2), D(e.scootAxisSpring, 0);
    let u2 = se(e, t);
    if (e.stretchSpring.target = ie(u2.speed), o >= 0.999 && Math.abs(a.progressSpring.velocity) < 0.01 && ce(e, c2.point)) {
      let t2 = xNn(a.path, 1), r = SNn(t2.tangent);
      return w(e, t2.point), A(e.rotationSpring, r), e.rotation = r, A(e.scootAxisSpring, 0), e.scootAxisRotation = 0, A(e.stretchSpring, 1), e.motion = null, e.thinkStartedAt = i, true;
    }
    return false;
  }
  function v(e, t, n2) {
    let r = e.motion;
    if (r?.mode !== `scoot`) return false;
    j(r.progressSpring, t), e.positionXSpring.target = r.end.x, e.positionYSpring.target = r.end.y, D(e.scootAxisSpring, r.axisRotation), D(e.rotationSpring, P(-44));
    let i = le(se(e, t).point, r.start, r.end), a = Math.sin(Math.min(1, i) * Math.PI);
    return e.stretchSpring.target = 1, e.scootStretchSpring.target = ae(i), e.scootRotationSpring.target = r.rotationTarget * a, i >= 0.999 && Math.abs(r.progressSpring.velocity) < 0.01 && ce(e, r.end) ? (w(e, r.end), A(e.rotationSpring, P(-44)), e.rotation = e.rotationSpring.value, E(e), A(e.stretchSpring, 1), e.motion = null, e.thinkStartedAt = n2, true) : false;
  }
  function te(e) {
    return e.motion != null || e.thinkStartedAt != null || !y(e.positionXSpring) || !y(e.positionYSpring) || !y(e.rotationSpring) || !y(e.scootAxisSpring) || !y(e.scootRotationSpring) || !y(e.scootStretchSpring) || !y(e.stretchSpring) || !y(e.visibilitySpring);
  }
  function y(e) {
    return e.value === e.target && M(e);
  }
  function b(e, t) {
    let n2 = re(t, I());
    x(e.cursor, { point: t.point, rotation: n2, scootAxisRotation: t.scootAxisRotation, scootRotation: t.scootRotationSpring.value, scootStretch: t.scootStretchSpring.value, stretch: t.stretchSpring.value, visibility: t.visibilitySpring.value });
  }
  function x(e, t) {
    let n2 = S(t);
    e.style.transform = n2.transform, e.style.opacity = `${n2.opacity}`, e.style.filter = n2.filter;
  }
  function S({ point: e, rotation: t, scootAxisRotation: n2, scootRotation: i, scootStretch: a, stretch: o, visibility: s }) {
    let c2 = YO(s, 0, 1), l2 = N(me, 1, c2), u2 = N(K, 0, c2), d2 = YO(a, Y, 1), f2 = [`translate3d(${F(e.x - R)}px, ${F(e.y - R)}px, 0)`];
    return (Math.abs(O(0, n2)) > 1e-3 || Math.abs(d2 - 1) > 1e-3) && f2.push(`rotate(${F(n2)}deg)`, `scale(1, ${F(d2)})`, `rotate(${F(-n2)}deg)`), f2.push(`rotate(${F(P(t + i))}deg)`, `scale(${F(o * l2)}, ${F(l2)})`), { filter: `blur(${F(u2)}px)`, opacity: F(c2), transform: f2.join(` `) };
  }
  function ne({ cursorX: e, cursorY: t, viewportHeight: n2, viewportWidth: i }) {
    return { x: YO(e ?? Math.round(i * ye), 0, i), y: YO(t ?? Math.round(n2 * be), 0, n2) };
  }
  function re(e, t) {
    if (e.thinkStartedAt == null) return e.rotation;
    let n2 = (t - e.thinkStartedAt) / 1e3 - he;
    if (n2 < 0) return e.rotation;
    let r = Math.min(1, n2 / ge), i = Math.sin(r * Math.PI), a = Math.sin(n2 / _e * Math.PI * 2) * i;
    return r >= 1 ? (e.thinkStartedAt = null, e.rotation) : e.rotation + a * ve;
  }
  function ie(e) {
    return YO(1 - e / 5500, 0.65, 1);
  }
  function ae(e) {
    let t = Math.sin(YO(e, 0, 1) * Math.PI);
    return N(1, N(1, Y, t), we);
  }
  function oe(e) {
    return YO(e * 0.18, 0.035, 0.12);
  }
  function C(e, t, n2) {
    e.positionXSpring.response = t, e.positionYSpring.response = t, e.positionXSpring.dampingFraction = n2, e.positionYSpring.dampingFraction = n2;
  }
  function se(e, n2) {
    let r = e.point;
    j(e.positionXSpring, n2), j(e.positionYSpring, n2), j(e.rotationSpring, n2), j(e.scootAxisSpring, n2);
    let i = { x: e.positionXSpring.value, y: e.positionYSpring.value }, a = JO(r, i) / Math.max(n2, 1 / 240);
    return e.point = i, e.rotation = e.rotationSpring.value, e.scootAxisRotation = e.scootAxisSpring.value, { point: i, speed: a };
  }
  function ce(e, n2) {
    return JO(e.point, n2) <= xe && Math.abs(e.positionXSpring.velocity) <= J && Math.abs(e.positionYSpring.velocity) <= J;
  }
  function w(e, t) {
    e.point = t, A(e.positionXSpring, t.x), A(e.positionYSpring, t.y);
  }
  function T(e, t) {
    e.motion = null, w(e, t), A(e.rotationSpring, P(-44)), e.rotation = e.rotationSpring.value, E(e), A(e.stretchSpring, 1);
  }
  function E(e) {
    A(e.scootAxisSpring, 0), A(e.scootRotationSpring, 0), A(e.scootStretchSpring, 1), e.scootAxisRotation = 0;
  }
  function le(e, t, n2) {
    let i = { x: n2.x - t.x, y: n2.y - t.y }, a = i.x * i.x + i.y * i.y;
    return a < 1e-3 ? 1 : YO(((e.x - t.x) * i.x + (e.y - t.y) * i.y) / a, 0, 1);
  }
  function D(e, t) {
    e.target = e.value + O(e.value, t);
  }
  function O(e, t) {
    let n2 = t - e;
    for (; n2 > 180; ) n2 -= 360;
    for (; n2 < -180; ) n2 += 360;
    return n2;
  }
  function ue(e) {
    let t = Math.sqrt(e.x * e.x + e.y * e.y);
    return t < 1e-3 ? { x: 1, y: 0 } : { x: e.x / t, y: e.y / t };
  }
  function k(e, t, n2) {
    return { dampingFraction: n2.dampingFraction, force: 0, response: n2.response, simulationTime: 0, scriptTime: 0, target: t, value: e, velocity: 0 };
  }
  function A(e, t) {
    e.force = 0, e.simulationTime = 0, e.scriptTime = 0, e.target = t, e.value = t, e.velocity = 0;
  }
  function j(e, t) {
    let n2 = Math.max(1e-3, e.response), r = 1 / (2 * X ** 2), i = Math.min((Math.PI * 2) ** 2 / n2 ** 2, r), a = Math.sqrt(i) * 2 * e.dampingFraction;
    for (e.scriptTime += Math.max(0, t), e.scriptTime - e.simulationTime > Te && (e.simulationTime = e.scriptTime - q); e.simulationTime < e.scriptTime; ) de(e, i, a), e.simulationTime += X;
    M(e) && (e.value = e.target);
  }
  function de(e, t, n2) {
    let r = X / 2, i = e.velocity + e.force * r;
    e.value += i * X, e.force = i * -n2 + (e.target - e.value) * t, e.velocity = i + e.force * r;
  }
  function M(e) {
    if (Math.max(e.velocity * e.velocity, e.force * e.force) > Z * Z) return false;
    let t = e.target * 0.01, n2 = e.target - e.value;
    return t === 0 || n2 * n2 <= t * t;
  }
  function N(e, t, n2) {
    return e + (t - e) * n2;
  }
  function P(e) {
    let t = e % 360;
    return t < 0 ? t + 360 : t;
  }
  function F(e) {
    return Math.round(e * 1e3) / 1e3;
  }
  function I() {
    return typeof performance > `u` ? Date.now() : performance.now();
  }
  function fe(e) {
    return typeof window < `u` && window.requestAnimationFrame != null ? window.requestAnimationFrame(e) : typeof window < `u` ? window.setTimeout(() => e(I()), q * 1e3) : (e(I()), 0);
  }
  function pe(e) {
    if (typeof window < `u` && window.cancelAnimationFrame != null) {
      window.cancelAnimationFrame(e);
      return;
    }
    typeof window < `u` && window.clearTimeout(e);
  }
  var L;
  var R;
  var z;
  var B;
  var V;
  var H;
  var U;
  var W;
  var G;
  var K;
  var me;
  var he;
  var ge;
  var _e;
  var ve;
  var ye;
  var be;
  var q;
  var xe;
  var J;
  var Se;
  var Ce;
  var we;
  var Y;
  var X;
  var Te;
  var Z;
  var Ee;
  var De;
  var Oe;
  var Q;
  var $;
  var ke;
  var Ae;
  var je = n((() => {
    YNn(), L = 24, R = L / 2, z = 23, B = 24, V = 12, H = -2.5, U = 44, W = `--browser-agent-cursor-glow-color`, G = `drop-shadow(0 0 6px color-mix(in srgb, var(${W}) 90%, transparent)) drop-shadow(0 0 15px color-mix(in srgb, var(${W}) 48%, transparent))`, K = 5, me = 0.4, he = 0, ge = 1.41, _e = 0.66, ve = 12.5, ye = 0.58, be = 0.55, q = 1 / 60, xe = 0.85, J = 12, Se = 196, Ce = 70, we = 0.15, Y = 0, X = 1 / 240, Te = 1, Z = 1e-3 * 60, Ee = { dampingFraction: 0.85, response: 0.2 }, De = { dampingFraction: 0.86, response: 0.42 }, Oe = { dampingFraction: 0.94, response: 0.19 }, Q = { dampingFraction: 0.9, response: 0.19 }, $ = { dampingFraction: 0.9, response: 0.12 }, ke = { dampingFraction: 0.82, response: 0.055 }, Ae = { dampingFraction: 0.86, response: 0.12 };
  }));
  var Me = n((() => {
    je();
  }));
  var Ne;
  var Pe = n((() => {
    Ne = `data:image/png;base64,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`;
  }));

  // <stdin>
  je();
  Pe();
  var createCursor = (container, options = {}) => c(container, { assetUrl: Ne, glowColor: "#339cff", ...options });
  return __toCommonJS(stdin_exports);
})();
