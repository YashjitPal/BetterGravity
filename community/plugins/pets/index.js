// Pets — the Codex desktop pet, rebuilt for Antigravity.
//
// Codex's pet is not a decoration inside its window. It stands on the desktop,
// in a transparent always-on-top window of its own, and it reports: a coloured
// indicator under its feet, and a stack of cards naming every thread that is
// running, waiting, blocked, or has something unread. That is the whole feature,
// and all four parts of it are here.
//
// HOW IT IS PUT TOGETHER. The file has two halves.
//
//   petSurface() is the pet. It is one self-contained function that draws into
//   whatever document it finds itself in and talks to the outside world through
//   exactly one message channel. It is called twice from the same text: once
//   here in Antigravity's window, and once — after being turned into a string by
//   plugin.overlay and re-evaluated on the other side — inside the transparent
//   desktop window. That is why it closes over nothing at all. The two pets are
//   not two implementations that agree; they are one implementation run twice.
//
//   The sensor is everything after it. Codex reads its own notification tray;
//   Antigravity has no tray, so the same activity entries are built by reading
//   its sidebar. A read of the live conversation store also keeps work visible
//   when rows are filtered or virtualised. Notification priority, timing, and
//   geometry follow the Codex reference; working loops while any agent is active.
//
// Copy this folder into %APPDATA%\BetterGravity\plugins\ and turn on developer
// mode to run it.

/* ═══ PART ONE — the pet ═══════════════════════════════════════════════════ */

/**
 * The pet, its indicator, and its activity stack.
 *
 * Nothing outside this function is in scope: it is stringified and re-evaluated
 * in another renderer, where the only things that exist are the document, the
 * `host` it is handed, and the JSON in `data`. Adding a reference to anything
 * above this line breaks the desktop half and nothing else, which is the kind of
 * bug that takes an afternoon — so everything the pet needs lives inside.
 *
 * @param {object} host the overlay API, or the page's stand-in for it
 * @param {object} data configuration, serialised across
 */
function petSurface(host, data) {
  /* ── The sheet ──────────────────────────────────────────────────────────
   *
   * codex-pet-assets: the v2 sheet. Nine animation rows, then two rows holding
   * the sixteen directions the pet can look in.
   */

  const SHEET = {
    columns: 8,
    rows: 11,
    cellWidth: 192,
    cellHeight: 208
  };

  /* ── The frame table ────────────────────────────────────────────────────
   *
   * Timing is per frame rather than a fixed rate, and every row holds its last
   * frame roughly twice as long, which is what stops a loop from feeling like a
   * metronome.
   */

  /** One row of the sheet as a run of frames. */
  const row = (rowIndex, count, ms, lastMs) =>
    Array.from({ length: count }, (_unused, columnIndex) => ({
      rowIndex,
      columnIndex,
      frameDurationMs: columnIndex === count - 1 ? lastMs : ms
    }));

  // Idle is the only row whose frames are all timed by hand: a long settle, two
  // quick frames, two medium, then a long hold. It is the breathing loop, so it
  // gets the attention.
  const IDLE_FRAMES = [
    { rowIndex: 0, columnIndex: 0, frameDurationMs: 280 },
    { rowIndex: 0, columnIndex: 1, frameDurationMs: 110 },
    { rowIndex: 0, columnIndex: 2, frameDurationMs: 110 },
    { rowIndex: 0, columnIndex: 3, frameDurationMs: 140 },
    { rowIndex: 0, columnIndex: 4, frameDurationMs: 140 },
    { rowIndex: 0, columnIndex: 5, frameDurationMs: 320 }
  ];

  // Those durations are for a deliberate idle beat; the resting loop runs six
  // times slower. Codex applies this unconditionally, so idle at rest is always
  // the slow version.
  const IDLE_MULTIPLIER = 6;
  const IDLE = IDLE_FRAMES.map((frame) => ({
    ...frame,
    frameDurationMs: frame.frameDurationMs * IDLE_MULTIPLIER
  }));

  /** Every state the pet has, in Codex's own row order. */
  const STATES = {
    idle: IDLE_FRAMES,
    "running-right": row(1, 8, 120, 220),
    "running-left": row(2, 8, 120, 220),
    waving: row(3, 4, 140, 280),
    jumping: row(4, 5, 140, 280),
    failed: row(5, 8, 140, 240),
    waiting: row(6, 6, 150, 260),
    running: row(7, 6, 120, 220),
    review: row(8, 6, 150, 280)
  };

  /* ── Sequencing ─────────────────────────────────────────────────────────
   *
   * Idle loops forever. Reactions use Codex's three bursts and slow idle tail.
   * Working keeps its own row looping until the last active agent stops; an
   * unchanged activity snapshot must not need a hover to restart the animation.
   *
   * Reduced motion is a single frame held still. Not a slower animation: the
   * shipped code returns one frame and no loop, so the pet becomes a picture.
   */
  function buildSequence(state, reducedMotion) {
    const frames = STATES[state] ?? STATES.idle;
    if (reducedMotion) return { frames: [frames[0]], loopStartIndex: null };
    if (state === "idle") return { frames: IDLE, loopStartIndex: 0 };
    if (state === "running") return { frames, loopStartIndex: 0 };
    const burst = [...frames, ...frames, ...frames];
    return { frames: [...burst, ...IDLE], loopStartIndex: burst.length };
  }

  /*
   * A frame as a background-position.
   *
   * Percentages, not pixels: a percentage background position aligns that point
   * of the image with the same point of the box, so column i of 8 lands exactly
   * at i / 7 of the way across. The whole thing is then resolution-independent
   * and the pet's size is just a width.
   */
  const backgroundPositionFor = (frame) =>
    `${(frame.columnIndex / (SHEET.columns - 1)) * 100}% ${(frame.rowIndex / (SHEET.rows - 1)) * 100}%`;

  /* ── Looking at something ───────────────────────────────────────────────
   *
   * The pet turns its head towards a point, and Codex is particular about which
   * point. frame 3805 is the whole rule:
   *
   *   _t = w?.caretPoint ?? Re
   *
   * `caretPoint` rides on `follow-up-editor-changed` (frame 6653) — the caret in
   * the follow-up reply, sent on every keystroke. `Re` is set from
   * `avatar-overlay-computer-use-cursor-changed` (frame 3722), which is the
   * cursor the *agent* is driving during computer use. Both are null by default
   * (page 2997), and when the point is null so is the look frame: the pet just
   * plays its animation.
   *
   * So Codex's pet does not watch the mouse. It watches you type, and it watches
   * itself work. Antigravity has no computer use, which leaves the caret and
   * nothing else — the pointer is read here for proximity and hit testing, never
   * for a direction to face.
   */

  /** 360 / 16. The last two rows hold sixteen directions, one every 22.5°. */
  const LOOK_SECTOR_DEGREES = 22.5;
  const LOOK_DIRECTIONS = 16;
  /** The first of the two direction rows. */
  const LOOK_FIRST_ROW = 9;
  /** Closer than this to the pet's centre there is no direction to face. */
  const LOOK_DEAD_ZONE_PX = 1;

  /**
   * The direction frame for a cursor at `pointer`, or null when the cursor is on
   * top of the pet's own centre.
   *
   * atan2 is called with the arguments swapped and dy negated so that zero is
   * straight up and the angle grows clockwise, which is the order the sixteen
   * frames are laid out in. Rounding rather than flooring means each frame
   * covers the 22.5° centred on the direction it draws.
   */
  function lookFrameFor(rect, pointer) {
    const dx = pointer.x - (rect.left + rect.width / 2);
    const dy = pointer.y - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) <= LOOK_DEAD_ZONE_PX) return null;

    const degrees = (Math.atan2(dx, -dy) * (180 / Math.PI) + 360) % 360;
    const sector = Math.round(degrees / LOOK_SECTOR_DEGREES) % LOOK_DIRECTIONS;

    return {
      rowIndex: LOOK_FIRST_ROW + Math.floor(sector / SHEET.columns),
      columnIndex: sector % SHEET.columns,
      frameDurationMs: 0
    };
  }

  /*
   * Only these three states look up from what they are doing. A pet mid-jump or
   * mid-panic keeps its own head, which is the difference between a pet that is
   * alive and a weather vane.
   */
  const LOOKING_STATES = new Set(["idle", "running", "waving"]);

  /** The properties mi() copies onto its mirror, in its own order. */
  const MIRROR_STYLES = [
    "border",
    "boxSizing",
    "direction",
    "font",
    "letterSpacing",
    "overflowWrap",
    "padding",
    "tabSize",
    "textAlign",
    "textIndent",
    "textTransform",
    "width",
    "wordBreak"
  ];

  /**
   * Where the caret is in a text field, in client coordinates — mi(), frame 3388.
   *
   * A caret has no box of its own, so it is measured by proxy: a hidden div is
   * given the field's own metrics, filled with the text up to the caret, and a
   * zero-width span put on the end of that text. Wherever the span lands is where
   * the caret is. `pre` rather than the field's white-space because an input keeps
   * its text on one line however it wraps in the mirror, and the far edge of the
   * selection because that is the end the caret sits at — unless the selection was
   * made backwards, in which case it sits at the near one.
   *
   * Codex returns the point relative to the content frame it found by ancestry,
   * and in that frame's *unscaled* units: it divides the whole delta by the zoom
   * and takes the scroll off afterwards. Ours is wanted in client pixels, to sit
   * in the same space as the pet's own box and the cursor. That makes the mirror
   * measurements free — two client rects subtracted are already scaled — and
   * leaves only the scroll offsets needing the factor, because a field reports
   * those in its own local pixels. At zoom 1 the two forms are identical.
   */
  function caretPointOf(field) {
    const rect = field.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;

    const style = window.getComputedStyle(field);
    const mirror = document.createElement("div");
    for (const property of MIRROR_STYLES) mirror.style[property] = style[property];
    mirror.style.position = "fixed";
    mirror.style.left = "0";
    mirror.style.top = "0";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre";

    const end =
      field.selectionDirection === "backward" ? field.selectionStart : field.selectionEnd;
    mirror.textContent = field.value.slice(0, end ?? field.value.length);

    const tail = document.createElement("span");
    tail.textContent = "​";
    mirror.append(tail);
    document.body.append(mirror);

    const mirrorRect = mirror.getBoundingClientRect();
    const tailRect = tail.getBoundingClientRect();
    mirror.remove();

    const scale = field.offsetWidth === 0 ? 1 : rect.width / field.offsetWidth;
    return {
      x: rect.left + (tailRect.left - mirrorRect.left) - field.scrollLeft * scale,
      y:
        rect.top +
        (tailRect.top - mirrorRect.top + tailRect.height / 2) -
        field.scrollTop * scale
    };
  }

  /* ── Dragging and throwing ──────────────────────────────────────────────
   *
   * avatar-overlay-native-page for the pointer half, main for the momentum half.
   * On the desktop these are screen coordinates, exactly as Codex has them; in
   * the window they are client coordinates. Same arithmetic either way, which is
   * the point of the pet not knowing which document it is in.
   */

  /** Movement before a press counts as a drag rather than a click. */
  const DRAG_THRESHOLD_PX = 4;
  /** Sideways movement before the pet turns and runs that way. */
  const RUN_THRESHOLD_PX = 4;
  /** Only pointer samples from this recently are used to measure a throw. */
  const SAMPLE_WINDOW_MS = 160;
  /** A floor on the measured interval, so a 0 ms gap cannot divide by nothing. */
  const MIN_SAMPLE_DT_MS = 8;
  /** Below this, a release is a let-go rather than a throw. */
  const MIN_THROW_SPEED = 320;
  /** Ceiling on release speed, before the multiplier. */
  const MAX_THROW_SPEED = 1600;
  /** Codex throws at three times the speed the hand was moving. */
  const THROW_MULTIPLIER = 3;

  /** The momentum tick, and the interval the friction figure is expressed per. */
  const TICK_MS = 16;
  /** A tick longer than this is treated as this long — a backgrounded window. */
  const MAX_TICK_DT_MS = 32;
  /** Speed kept per 16 ms. */
  const FRICTION = 0.88;
  /** Speed kept when it bounces off an edge. */
  const RESTITUTION = 0.7;
  /** Below this the throw is over. */
  const STOP_SPEED = 65;
  /** And it is over regardless after this long. */
  const MAX_MOMENTUM_MS = 900;

  // Codex's own clamp on the pet's width, from avatar-overlay-mascot-size.
  const MIN_WIDTH_PX = 80;
  const MAX_WIDTH_PX = 224;
  /** 7 rem, Codex's default, at a 16 px root — main/src 17846. */
  const DEFAULT_WIDTH_PX = 112;

  /* ── What a status looks like ───────────────────────────────────────────
   *
   * rr() in avatar-overlay-native-frame, as a table. It is checked in this order
   * — loading, then warning, danger, success, and info as the fallback — and
   * each level decides four things at once: the colour of the indicator, the
   * glyph on the right of the card, the words used when a thread has none of its
   * own, and which animation the pet plays. The strings are Codex's, verbatim.
   *
   * `label` is deliberately not card text. Kr() (js 2774) only ever puts it in
   * an aria label — what the card shows is the thread's own title. It is kept
   * here because the indicator's tooltip is the one place it is read aloud.
   *
   * `icon` is na()'s switch (js 7282), and `spinner` is the interesting one: it
   * renders nothing at all. A running card's whole status indication is the
   * shimmer over its text, which is why `loading` also collapses the space the
   * text leaves free on the right.
   */
  const LEVELS = {
    running: {
      tone: "info",
      label: "Running",
      body: "Thinking",
      mascot: "running",
      icon: "spinner",
      loading: true
    },
    waiting: {
      tone: "warning",
      label: "Needs input",
      body: "Needs input",
      mascot: "waiting",
      icon: "clock",
      loading: false
    },
    failed: {
      tone: "danger",
      label: "Blocked",
      body: "Blocked",
      mascot: "failed",
      icon: "warning",
      loading: false
    },
    review: {
      tone: "success",
      label: "Ready",
      body: "Ready",
      mascot: "review",
      icon: "check-circle",
      loading: false
    },
    // ar in rr(): the fallback level. Codex gives it the same info tone as
    // running and tells them apart by the pale background it fills; here the
    // indicator is six pixels of colour, so idle gets a tone of its own to be
    // quiet with. Same level, one more name for it.
    idle: {
      tone: "idle",
      label: "Info",
      body: "Info",
      mascot: "idle",
      icon: "clock",
      loading: false
    },
    /*
     * or, the greeting: `{...ar, mascotState: 'waving'}` (frame 1814).
     *
     * The only level rr() reaches before looking at anything else — `kind ===
     * 'first-awake'` is its first line — and the only one that differs from the
     * fallback in a single field. So the greeting is idle's tone, idle's clock and
     * idle's label, with the pet waving over the top of it.
     *
     * `controls` is the one thing a level says here that Codex says per
     * notification: Ti() gives the greeting `controlTarget: null` and
     * `notificationPreferenceId: null`, which takes away reply and stop (`me`,
     * frame 5933), the actions button (`_e`, 5936) and the fade that only exists to
     * clear them (`ke`, 6141). The green tick was never on the table — that one
     * wants a check-circle level. A card with nothing to press.
     */
    greeting: {
      tone: "idle",
      label: "Info",
      body: "Info",
      mascot: "waving",
      icon: "clock",
      loading: false,
      controls: "none"
    }
  };

  /* ── The glyphs ─────────────────────────────────────────────────────────
   *
   * Five icons, as the markup they are in app-initial and native-frame. They are
   * written out rather than drawn because the desktop half has no bundler, no
   * React, and no way to import anything: this function arrives there as text.
   *
   * The paths are verbatim. clock is Xns, warning is HK, the tick is aI, reply
   * is Ln, stop is uX, and the dismiss cross is the one inline in yi().
   */

  const ICON_CLOCK =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<path fill="currentColor" d="M8.00037 4.14209C8.29009 4.14235 8.52478 4.37769 8.52478 4.66748V7.86279C8.52464 8.0901 8.43446 8.30843 8.2738 8.46924L6.70447 10.0386C6.49954 10.2433 6.16728 10.2432 5.96228 10.0386C5.75731 9.8336 5.75742 9.50142 5.96228 9.29639L7.47498 7.78369V4.66748C7.47498 4.37753 7.71042 4.14209 8.00037 4.14209Z"/>' +
    '<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M8.00037 1.4751C11.604 1.4751 14.5258 4.39683 14.5258 8.00049C14.5258 11.6041 11.604 14.5259 8.00037 14.5259C4.39671 14.5259 1.47498 11.6041 1.47498 8.00049C1.47498 4.39683 4.39671 1.4751 8.00037 1.4751ZM8.00037 2.52588C4.97661 2.52588 2.52576 4.97673 2.52576 8.00049C2.52576 11.0242 4.97661 13.4751 8.00037 13.4751C11.0241 13.4751 13.475 11.0242 13.475 8.00049C13.475 4.97673 11.0241 2.52588 8.00037 2.52588Z"/>' +
    "</svg>";

  const ICON_WARNING =
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
    '<path d="M9.995 12.315c.489 0 .875.37.875.842 0 .473-.386.843-.875.843-.488 0-.875-.37-.875-.843 0-.472.387-.842.875-.842ZM10.001 6c.478 0 .778.295.778.79 0 .042 0 .107-.006.16l-.08 3.716c-.016.456-.252.725-.698.725-.445 0-.681-.269-.692-.725L9.217 6.95c0-.053-.006-.118-.006-.16 0-.495.307-.79.79-.79Z"/>' +
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M10 2.085a7.915 7.915 0 1 1 0 15.83 7.915 7.915 0 0 1 0-15.83Zm0 1.33a6.585 6.585 0 1 0 0 13.17 6.585 6.585 0 0 0 0-13.17Z"/>' +
    "</svg>";

  const ICON_CHECK =
    '<svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">' +
    '<path fill="currentColor" d="M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z"/>' +
    "</svg>";

  const ICON_REPLY =
    '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">' +
    '<path fill="currentColor" d="M12.6961 20.1078C12.9614 20.1078 13.1788 20.0232 13.348 19.8539C13.5173 19.6846 13.602 19.4765 13.602 19.2294V16.3196H13.8216C15.2948 16.3196 16.5186 16.5484 17.4931 17.0059C18.4676 17.4634 19.2843 18.3098 19.9431 19.5451C20.0712 19.7922 20.2176 19.9477 20.3824 20.0118C20.5471 20.0758 20.7118 20.1078 20.8765 20.1078C21.0778 20.1078 21.2608 20.0232 21.4255 19.8539C21.5902 19.6846 21.6725 19.4353 21.6725 19.1059C21.6725 17.2301 21.3958 15.6105 20.8422 14.2471C20.2886 12.8837 19.433 11.8337 18.2755 11.0971C17.118 10.3605 15.6333 9.99216 13.8216 9.99216H13.602V7.09608C13.602 6.84902 13.5173 6.63399 13.348 6.45098C13.1788 6.26797 12.9569 6.17647 12.6824 6.17647C12.4993 6.17647 12.3346 6.21993 12.1882 6.30686C12.0418 6.39379 11.8725 6.52876 11.6804 6.71176L5.6549 12.3255C5.5085 12.4627 5.40784 12.6 5.35294 12.7373C5.29804 12.8745 5.27059 13.0118 5.27059 13.149C5.27059 13.2771 5.29804 13.4098 5.35294 13.5471C5.40784 13.6843 5.5085 13.8216 5.6549 13.9588L11.6804 19.6137C11.8542 19.7784 12.0212 19.902 12.1814 19.9843C12.3415 20.0667 12.5131 20.1078 12.6961 20.1078Z"/>' +
    "</svg>";

  const ICON_STOP =
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
    '<path d="M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z"/>' +
    "</svg>";

  const ICON_CLOSE =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<path d="M3 3 9 9M9 3 3 9" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>' +
    "</svg>";

  /*
   * The chevron the badge wears while the pills are out — Af, app-initial 50214.
   * Drawn at 20 x 21 and both filled and stroked at 0.6, which is what keeps it
   * legible at the 18 px `icon-sm` renders it into.
   */
  const ICON_CHEVRON =
    '<svg width="18" height="18" viewBox="0 0 20 21" fill="none" aria-hidden="true">' +
    '<path fill="currentColor" stroke="currentColor" stroke-width="0.6" d="M15.2793 7.71101C15.539 7.45131 15.961 7.45131 16.2207 7.71101C16.4804 7.97071 16.4804 8.39272 16.2207 8.65242L10.4707 14.4024C10.211 14.6621 9.78902 14.6621 9.52932 14.4024L3.77932 8.65242L3.69436 8.54792C3.52385 8.28979 3.55205 7.93828 3.77932 7.71101C4.00659 7.48374 4.3581 7.45554 4.61623 7.62605L4.72073 7.71101L10 12.9903L15.2793 7.71101Z"/>' +
    "</svg>";

  const ICONS = {
    clock: ICON_CLOCK,
    warning: ICON_WARNING,
    "check-circle": ICON_CHECK,
    spinner: ""
  };

  /* ── Geometry ───────────────────────────────────────────────────────────
   *
   * $t() in avatar-overlay-native-frame lays the mascot's controls out either in
   * a row under it or along an arc around it. The indicator is slot 2 of 4.
   *
   * Collapsed, Codex passes a gap that is the negative of the control size, so
   * every slot in the row lands on the mascot's centre line and the arithmetic
   * comes out at zero — the pill just sits under the pet, and the stylesheet
   * places it. Expanded is the interesting one, and it is below.
   */

  /** app-initial 22117: petControlsAppearance, the fields used here. */
  const HOVER_CONTROL_SIZE = 24;
  const HOVER_CONTROL_GAP = 8;
  const HOVER_OFFSET_Y = 10;
  /** rn / an in $t(): the inset from the edge of the screen, and the gap below. */
  const VIEWPORT_INSET = 8;
  const GAP_BELOW = 8;
  /**
   * The indicator's slot, and how many are on the arc with it.
   *
   * `$t()` numbers four slots — voice-microphone 0, voice-controls 1,
   * mascot-badge 2, voice-output 3 — and spaces them symmetrically about the
   * mascot's centre line, so slot 2 sits half a step to the *right* of centre and
   * slot 1 half a step to its left. Which of them are actually drawn is a
   * separate question, and frame 1166/1201/1243 answer it: the microphone and the
   * output meter are behind `a`, so they appear only during a voice session,
   * while voice-controls has no such guard and is always there. A Codex pet doing
   * ordinary work therefore shows two controls straddling the centre — and the
   * pair reads as centred, because it is.
   *
   * Antigravity has no voice at all, so the indicator is the only member of the
   * cluster. Laying one control out in a four-slot arc would leave it 16 px right
   * of the pet's centre with nothing on the left to balance it, which is why the
   * bar under the pet's feet appeared to jump sideways as it grew into a disc.
   * A cluster of one is `$t()` with a count of one: the arithmetic below collapses
   * to x = 0 and the disc rises straight out of the bar.
   *
   * The quick chat is not on this arc either way. qt() reads slot 1 to place the
   * *error* pill; the composer is a sibling of the activity stack in one flex
   * column. See layout().
   */
  const BADGE_SLOT = 0;
  const BADGE_SLOT_COUNT = 1;

  /**
   * Where a control in the cluster sits when the cluster is open, as an offset
   * from the pet's top centre.
   *
   * This is $t()'s arc branch. The controls are spaced evenly around a circle
   * that starts at the mascot's edge, so the radius is half the pet plus half a
   * control, and the angle between two neighbours is the one that puts their
   * centres a control-plus-gap apart on that circle: f = 2·asin((t + e) / 2d).
   *
   * x is a centre offset and y a top edge — frame 161 applies the pair as
   * `left: mascot.left + mascot.width / 2 + x` and `top: mascot.top + y`, and the
   * `- t / 2` in y is what turns the point on the circle into an edge.
   *
   * With one control on the arc the angle is zero, so for Codex's default 112 px
   * pet the indicator comes out at x = 0, y = 127.
   */
  function arcAt(slot, petWidth, petHeight) {
    const radius = petWidth / 2 + HOVER_CONTROL_SIZE / 2;
    const step = 2 * Math.asin(Math.min(1, (HOVER_CONTROL_SIZE + HOVER_CONTROL_GAP) / (2 * radius)));
    const angle = (slot - (BADGE_SLOT_COUNT - 1) / 2) * step;
    return {
      x: Math.round(Math.sin(angle) * radius),
      y: Math.round(petHeight / 2 + Math.cos(angle) * radius - HOVER_CONTROL_SIZE / 2 + HOVER_OFFSET_Y)
    };
  }

  /** avatar-overlay-native-frame: the activity card, and Kl's stack ladder. */
  const CARD_HEIGHT = 54;
  /**
   * page 1160: Hr()'s three numbers. A pill is as wide as its widest line of text
   * plus 20 px of side spacing either end, never narrower than 200 and never wider
   * than 315 — which is also the answer when there is nothing to measure with.
   */
  const CARD_WIDTH = 315;
  const CARD_MIN_WIDTH = 200;
  const CARD_SIDE_SPACING = 20;
  /** js 6240: `mx-1.5` on the `•`, so the fold costs 6 px either side of it. */
  const INLINE_SEPARATOR_GAP = 12;
  /** Hr(): the room a card that is neither running nor waiting leaves for its controls. */
  const CONTROL_ROOM = 45;
  /** The family the cards are drawn in, for when the computed one comes back empty. */
  const FALLBACK_FAMILY = "ui-sans-serif, system-ui, sans-serif";
  /** app-initial 22034: how far each backing sits below the one in front. */
  const BACKING_OFFSET_Y = 10;
  /** Kl, in full: the three rungs a collapsed pile is drawn on. */
  const RUNGS = [
    { offsetY: 0, scale: 1 },
    { offsetY: 10, scale: 0.94 },
    { offsetY: 20, scale: 0.86 }
  ];

  /**
   * app-initial 21918: ube(), how far down a rung a backing starts.
   *
   * `offsetY + (height - 54) · (1 - scaleY)`. The second term is what keeps the
   * ladder honest on a card that is not 54 tall: a backing is scaled about its
   * top edge, so scaling alone would pull its bottom edge *up* by
   * `height · (1 - scaleY)`, and the correction pushes it back down by the part
   * of that the 54 px case did not have to pay for. It is zero at 54.
   */
  const rungOffset = (front, rung) => rung.offsetY + (front - CARD_HEIGHT) * (1 - rung.scale);

  /**
   * app-initial 21904: cbe(), how tall a collapsed pile stands.
   *
   * A pile is taller than the card in front of it. The backings are scaled about
   * their top edge and pushed down, so the last rung's bottom edge falls past the
   * front card's and peeks out below it — which is the whole reason a pile reads
   * as a pile. cbe() is `max(front, ube(front, rung) + front·scaleY)`, and every
   * rung is measured off the *front* card because fbe()'s collapsed branch builds
   * all three out of `{...viewport, height: items[0].height}` (21929). At a 54 px
   * card that is 54 for one entry, 60.76 for two, 66.44 for three or more,
   * whatever is behind them.
   */
  function pileHeight(count, front = CARD_HEIGHT) {
    if (count <= 0) return 0;
    const rung = RUNGS[Math.min(count, RUNGS.length) - 1];
    return Math.max(front, rungOffset(front, rung) + front * rung.scale);
  }

  /**
   * app-initial 21924: fbe()'s expanded branch, and Gl's eight slots.
   *
   * The page hands fbe() a 208 px viewport and the *whole* list, cards go in
   * gbe(8) apart, and the viewport is `min(208, contentHeight)` — so a short list
   * makes a short tray and a long one scrolls.
   *
   * Gl's eight slots are a draw pool, not a cap. Up to eight items fbe() lays all
   * of them out; past eight it keeps the ones overlapping the viewport grown by
   * _be(56) of overscan, pads that set back up to eight with whichever excluded
   * cards are nearest the window, and hands item i the pool slot at `i % 8`. The
   * ninth thread is not undrawable — it is off-screen until it is scrolled to.
   */
  const STACK_GAP = 8;
  const STACK_VIEWPORT_HEIGHT = 208;
  const STACK_SLOTS = 8;
  const STACK_OVERSCAN = 56;

  /**
   * app-initial 22117: proximityEnterDistance and proximityExitDistance.
   *
   * The cluster does not open on hover — it opens when the cursor comes within 40
   * px of the pet and closes when it passes 56, which is 16 px of hysteresis so a
   * cursor resting on the boundary cannot make it flicker. Leaving waits
   * compactDismissDelayMs first, so crossing the gap between the pet and its own
   * cards does not shut them.
   */
  const PROXIMITY_ENTER_PX = 40;
  const PROXIMITY_EXIT_PX = 56;
  const DISMISS_DELAY_MS = 300;

  /*
   * qr(): whether the subtitle folds up onto the title's line.
   *
   * `title.length <= 20 && body.length > 40`, once the kind and waitingRequest
   * tests — which Antigravity can never fail — are taken out of it (frame 2819).
   *
   * Nothing is shortened on the way in. jr() (frame 2261) does cut at 48
   * characters, but only inside lr(), which formats the metadata of a waiting
   * request one value at a time and never sees a title or a body: Kr() hands the
   * subtitle over whole (2815), qr() measures the whole of it, and so does Hr()
   * when it works out how wide the card should be. What shortens a card's text is
   * CSS and only CSS — one line with an ellipsis on it, or two with a clamp.
   */
  const INLINE_TITLE_MAX = 20;
  const INLINE_BODY_MIN = 40;

  /**
   * frame 4710 and 140: the composer's wrapper is `relative h-10 w-[344px]
   * shrink-0`, and _QuickChatMaterial_ inside it is 40 px tall. Written out
   * because the hit-test filter needs the pill's box before it has been laid out.
   *
   * The form caps itself at `calc(100vw - 12px)`, so a window narrower than the
   * pill shrinks the pill instead of pushing it off the edge.
   */
  const CHAT_WIDTH = 344;
  const CHAT_HEIGHT = 40;
  const CHAT_VIEWPORT_INSET = 12;
  /** `gap-2` on the column that holds the stack and the composer. */
  const COLUMN_GAP = 8;

  /* ── The state the pet is in ────────────────────────────────────────────*/

  const clampWidth = (value) => {
    const asNumber = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_WIDTH_PX;
    return Math.round(Math.min(MAX_WIDTH_PX, Math.max(MIN_WIDTH_PX, asNumber)));
  };

  /** A sheet has to be fetchable by the document, so only these two are any use. */
  const SHEET_URL = /^(?:https?:\/\/|data:image\/)/i;

  /** True in the transparent desktop window, false in Antigravity's own. */
  const desktop = data?.desktop === true;

  let config = {
    size: DEFAULT_WIDTH_PX,
    force: "auto",
    sheet: "",
    activity: true,
    ...(data?.config ?? {})
  };

  /** The activity entries, already sorted and trimmed by the sensor. */
  let entries = Array.isArray(data?.entries) ? data.entries : [];
  /** Work is independent of notification priority, dismissal, and visibility. */
  let working = data?.working === true || entries.some((entry) => entry.status === "running");

  let width = clampWidth(config.size);
  let height = Math.round((width * SHEET.cellHeight) / SHEET.cellWidth);
  let x = 0;
  let y = 0;

  /** What the agent is doing, as a pet state. */
  let statusState = "idle";
  /** An override that outranks it: which way a dragged pet is being carried. */
  let transient = null;
  /** Where the cursor was last seen, in this document's coordinates. */
  let pointerAt = null;
  /**
   * Where the caret was when the composer last changed, and the reading of the
   * composer that produced it.
   *
   * `w?.caretPoint` (frame 3805) is state rather than a measurement taken on
   * demand: the editor reports it on change, and until it has, there is nothing to
   * look at. Which is why a composer that has been opened but not typed into does
   * not turn the pet's head — the point arrives with the first keystroke. hi()
   * (frame 3428) is the reading the report is gated on, so a keystroke that moves
   * nothing measures nothing.
   */
  let caretAt = null;
  let caretReading = null;
  /** Whether the cursor is on the sprite itself. This is what makes it jump. */
  let hovering = false;
  /**
   * Whether the cursor is *near* the pet, which is a different question.
   *
   * Codex opens the control cluster on proximity, not on hover: pet-pointer-
   * proximity-changed fires at 40 px and stops at 56, and nothing about it needs
   * the cursor to be over the sprite. The two signals do different jobs — this one
   * opens the cluster and the tray, `hovering` makes the pet jump.
   */
  let nearby = false;
  /** Which card the cursor is over, if any: Ui()'s `d`, isPointerSurfaceHovered. */
  let hoveredKey = null;
  /**
   * Whether the stack is open. native-page 2050 starts it closed, so the pile is
   * what you meet first and the list is what a click on the pile gets you.
   */
  let stackExpanded = false;
  /**
   * Whether the pills have been stashed, which is the badge's other job.
   *
   * `areActivityPillsVisible` is not a hover state and not derived from anything:
   * the page reads it out of a persisted setting — `dt = z(wa) ?? b(Ca, !0)`, page
   * 2049 — and the only things that write it are the two controls the badge turns
   * into. Default on, so the pills are out until someone puts them away.
   */
  let stashed = false;
  /** dbe()'s clamped scroll position within the expanded viewport. */
  let scrollOffset = 0;
  /** Whether the quick-chat pill is showing. */
  let chatOpen = false;
  /**
    * `W`: which card the pill is aimed at, or null for a new projectless chat.
   *
   * Codex's composer belongs to a card — `G(_.turnKey)` on the reply control, and
   * `submit-follow-up` carries that notification with it (frame 6477, 6656). One
   * shared pill cannot belong to a card, so it remembers which one aimed it.
   */
  let chatTarget = null;
  /**
   * Where layout() last put the tray and the chat pill.
   *
   * The hit test needs these to decide whether a cursor is worth asking the
   * document about, and measuring them would defeat the point of asking.
   */
  let trayRect = { left: 0, top: 0, right: 0, bottom: 0 };
  let chatRect = { left: 0, top: 0, right: 0, bottom: 0 };

  let playing = "idle";
  let sequence = buildSequence("idle", false);
  let frameIndex = 0;
  let frameTimer;
  /** Whether the last paint drew a direction, which suspends the sequence. */
  let looking = false;
  let momentumTimer;
  /** compactDismissDelayMs: the wait before a departing cursor closes anything. */
  let dismissTimer;
  let disposed = false;

  /**
   * Live drag state, or null when nobody is holding the pet.
   *
   * `x` and `y` are the last *accepted* pointer position rather than the latest
   * one. Codex only accepts a move once the pointer has travelled 4 px on either
   * axis since the last accepted point, so the whole drag advances in 4 px steps
   * — not just the start of it. That is what keeps a held pet from trembling.
   */
  let drag = null;

  const cleanups = [];
  const track = (cleanup) => void cleanups.push(cleanup);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ── The elements ───────────────────────────────────────────────────────
   *
   * Two for the pet — a positioned wrapper that takes the pointer and the sprite
   * inside it, so the pickup scale never disturbs background-position — plus the
   * tray and the quick-chat pill.
   *
   * The tray has two shapes and one set of elements. Collapsed it is a pile: the
   * front card carries the text and two empty backings sit behind it on Kl's
   * rungs. Expanded it is a 208 px window onto up to eight full cards. Cards are
   * built as they are first needed and then kept, because the pile is what a
   * session mostly shows and building eight of them for it would be waste.
   *
   * `data-pet-hit` is how the desktop half knows which pixels belong to the pet:
   * everything without it is a hole the pointer falls through.
   */

  const make = (tag, className, into) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (into) into.append(element);
    return element;
  };

  const pet = make("div", "bettergravity-pet");
  pet.setAttribute("aria-hidden", "true");
  pet.dataset.petHit = "pet";
  pet.dataset.petBadge = "hidden";
  pet.dataset.petBadgeKind = "chevron";
  pet.dataset.petCluster = "closed";
  pet.dataset.petTone = "idle";

  const sprite = make("div", "bettergravity-pet__body", pet);
  const badge = make("div", "bettergravity-pet__badge", pet);
  badge.dataset.petHit = "badge";
  const badgeCount = make("span", "bettergravity-pet__badge-count", badge);
  const badgeChevron = make("span", "bettergravity-pet__badge-chevron", badge);
  badgeChevron.innerHTML = ICON_CHEVRON;

  const tray = make("div", "bettergravity-pet-tray");
  tray.setAttribute("aria-hidden", "true");
  tray.dataset.petTray = "closed";
  tray.dataset.petStack = "collapsed";
  tray.dataset.petTone = "idle";

  /*
   * The two empty backings, furthest back first. fbe()'s collapsed branch gives
   * every slot after the first a zero-height content rect, which is to say the
   * pile behind the front card is genuinely blank — two pieces of the same
   * material on Kl's lower rungs, and nothing written on either.
   */
  const backings = [2, 1].map((slot) => {
    const backing = make("div", "bettergravity-pet-card", tray);
    backing.dataset.petSlot = String(slot);
    backing.hidden = true;
    return backing;
  });

  /**
   * A card, built once and reused. Eight of them at most, which is Gl's length.
   *
   * Every part named in Ui() that Antigravity can actually reach is here: the
   * content with its title and its body line, the trailing status glyph, the
   * reply/stop row, and the dismiss cross on the corner. The one thing missing is
   * the expand chevron, and it is missing because `be = V != null && ye` needs a
   * waitingRequest — a realtime-voice question — which nothing here produces.
   */
  function buildCard() {
    const root = make("div", "bettergravity-pet-card", tray);
    root.dataset.petHit = "card";
    root.dataset.petPill = "default";
    root.dataset.petInline = "false";
    root.hidden = true;

    const content = make("div", "bettergravity-pet-card__content", root);
    const text = make("div", "bettergravity-pet-card__text", content);
    const body = make("div", "bettergravity-pet-card__body", content);

    const status = make("div", "bettergravity-pet-card__status", root);
    status.setAttribute("role", "img");
    const statusDisc = make("span", "bettergravity-pet-card__status-disc", status);
    statusDisc.hidden = true;

    const controls = make("div", "bettergravity-pet-card__controls", root);
    controls.dataset.petControls = "default";
    const reply = make("div", "bettergravity-pet-card__control", controls);
    reply.dataset.petControl = "reply";
    reply.dataset.petHit = "control";
    reply.innerHTML = ICON_REPLY;
    const stop = make("div", "bettergravity-pet-card__control", controls);
    stop.dataset.petControl = "stop";
    stop.dataset.petHit = "control";
    stop.innerHTML = ICON_STOP;
    /*
     * js 6535. A finished card's row is one childless button instead of the pair:
     * a 28 px hit target laid straight over the green check, its own background
     * taken to zero so the check is all you see. The row's inset (14.5 + 14) and
     * the status box's (13 + 15.5) both come out at 28.5 from the right edge,
     * which is how the two land on top of one another.
     */
    const dismiss = make("div", "bettergravity-pet-card__control", controls);
    dismiss.dataset.petControl = "success";
    dismiss.dataset.petHit = "control";
    dismiss.hidden = true;

    const close = make("div", "bettergravity-pet-card__close", root);
    close.dataset.petControl = "close";
    close.dataset.petHit = "control";
    close.innerHTML = ICON_CLOSE;

    return {
      root,
      content,
      text,
      body,
      status,
      statusDisc,
      controls,
      reply,
      stop,
      dismiss,
      close
    };
  }

  /** Built on demand: a pile needs one, an open stack up to eight. */
  const cards = [];
  const cardAt = (index) => {
    while (cards.length <= index && cards.length < STACK_SLOTS) {
      const built = buildCard();
      // The front card is the pile's own card, so it keeps Kl's top rung and is
      // the one thing in a collapsed tray that a click can land on.
      if (cards.length === 0) built.root.dataset.petSlot = "0";
      cards.push(built);
    }
    return cards[index];
  };

  /*
   * Quick chat. frame 140: a 40 px pill with the reply glyph on the end of it,
   * stacked with the activity tray in one column — see layout().
   *
   * Two placeholders, and which one is showing says what the pill is for:
   * `De = hasNotifications ? startNewTaskPlaceholder : askPlaceholder` (frame
   * 5496), whose own descriptions are "when the floating pet has activity" and
   * "when the floating pet is idle" (7412). The idle one is reachable because the
   * pill outlives the cards: it comes out over the tray and stays until the
   * cursor leaves the pet altogether, so the last card being dismissed under it
   * turns "Start new chat" back into "Ask".
   */
  const chat = make("div", "bettergravity-pet-chat");
  chat.dataset.petHit = "chat";
  chat.dataset.petChat = "closed";
  const chatInput = make("input", "bettergravity-pet-chat__input", chat);
  chatInput.type = "text";
  chatInput.placeholder = "Ask";
  chatInput.setAttribute("aria-label", "Chat");
  const chatSend = make("div", "bettergravity-pet-card__control bettergravity-pet-chat__send", chat);
  chatSend.dataset.petControl = "send";
  chatSend.dataset.petHit = "control";
  chatSend.innerHTML = ICON_REPLY;

  /* ── Which sheet, and how big ───────────────────────────────────────────*/

  /** Set when a custom sheet was asked for and could not be used. */
  let sheetProblem = "";

  function applySheet() {
    const custom = typeof config.sheet === "string" ? config.sheet.trim() : "";

    if (custom.length === 0 || !SHEET_URL.test(custom)) {
      sheetProblem = custom.length === 0 ? "" : "the sprite sheet needs an http, https, or data URL";
      pet.style.removeProperty("--pet-sheet");
      pet.dataset.pet = "rocky";
      return;
    }

    sheetProblem = "";
    pet.dataset.pet = "custom";
    // JSON.stringify escapes quotes and backslashes, which are the only two
    // characters that could end the CSS string early.
    pet.style.setProperty("--pet-sheet", `url(${JSON.stringify(custom)})`);
  }

  /* ── Where it stands, and where the tray goes ───────────────────────────
   *
   * On the desktop the document is exactly the working area of the screen, so
   * `window.innerWidth` is the screen and the pet bounces off its edges. In
   * Antigravity's window it is the window. Nothing here has to know which.
   *
   * Codex reserves 8 px under the pet and nothing at the sides: yf, main 11518,
   * is `{ top: 8, right: 28, bottom: 8, left: 0 }`, and only `bottom` reaches the
   * anchor clamp — Ff (main 11723) is
   *
   *   x: Vf(e.x, t.x, t.x + t.width  - e.width)
   *   y: Vf(e.y, t.y, t.y + t.height - e.height - yf.bottom - (n ? Cf : 0))
   *
   * where the extra Cf (32) is the tray caption's room and is not ours.
   */

  const ANCHOR_BOTTOM_RESERVE = 8;

  // Deliberately unclamped: Ff does not floor these at zero, so a pet wider or
  // taller than the space it is in hands clampAnchor an inverted range, which is
  // the case Vf centres. Flooring them here would pin it to the top-left instead.
  const maxX = () => window.innerWidth - width;
  const maxY = () => window.innerHeight - height - ANCHOR_BOTTOM_RESERVE;

  /**
   * Vf, main 11767, verbatim:
   *
   *   function Vf(e, t, n) {
   *     return t > n ? Math.round((t + n) / 2) : Math.min(Math.max(Math.round(e), t), n);
   *   }
   *
   * Two things in it matter. It **rounds**, so the applied position is always a
   * whole pixel — which is what keeps a pixelated sprite from crawling as it
   * slides. And when the range inverts, because the pet is wider or taller than
   * the space it is being clamped into, it centres in that impossible range
   * rather than picking an edge.
   */
  const clampAnchor = (value, low, high) =>
    low > high ? Math.round((low + high) / 2) : Math.min(Math.max(Math.round(value), low), high);

  /**
   * Whether the control cluster is out on its arc.
   *
   * One flag decides it, and it is proximity rather than hover: Codex opens the
   * cluster from pet-pointer-proximity-changed, so the controls are already out by
   * the time the cursor arrives on the mascot. Everything laid out off the arc asks
   * this, because when it is false the arc collapses onto the mascot's centre line.
   */
  const cluster = () => nearby;

  /**
   * Lays out the cluster, the tray and the chat pill around wherever the pet is.
   *
   * The tray and quick chat share a vertical column. frame 4867 stacks them in
   * a `flex flex-col items-center
   * gap-2` and picks the order from isTrayAboveMascot — composer first when the
   * column is above the mascot, last when it is below — so the activity stack is
   * always the member touching the pet and the composer is always on the far side
   * of it. Both start centered on the pet, with their own horizontal bounds.
   *
   * Where the column starts is Jt(): under the pet, or under the open cluster when
   * that is what is showing, flipping above when the whole column would run past
   * the bottom of the screen. How wide it is is Hr(): the widest pill's own
   * measured text, which is the tray's whole coordinate space.
   *
   * The tray's height is the one number the stylesheet cannot work out for itself:
   * cbe()'s pile height while the stack is shut, and `min(208, contentHeight)`
   * once it is open.
   */
  function layout() {
    const arc = arcAt(BADGE_SLOT, width, height);
    pet.style.setProperty("--pet-badge-arc-x", `${arc.x}px`);
    pet.style.setProperty("--pet-badge-arc-y", `${arc.y}px`);

    /*
     * The activity width is measured — page 2191 hands the stack a
     * `viewportRect` of `{height: 208, left: 0, top: 0, width: Hr().width}` and
     * fbe() gives every row `left: viewportRect.left` and `width: viewportRect.width`,
     * independently of the quick-chat pill's 344px width.
     */
    const room = Math.max(0, window.innerWidth - VIEWPORT_INSET * 2);
    const trayWidth = Math.min(cardWidth(), room);
    const chatWidth = Math.min(CHAT_WIDTH, Math.max(0, window.innerWidth - CHAT_VIEWPORT_INSET));

    const trayHeight = stackExpanded
      ? Math.min(STACK_VIEWPORT_HEIGHT, contentHeight())
      : pileHeight(entries.length, entries[0] === undefined ? CARD_HEIGHT : heightOf(entries[0].key));

    // Which members the column actually has. A tray with nothing to draw is not
    // one of them, and that is what lets the pill sit directly under the pet when
    // no thread is running — Codex renders the stack only when it has items.
    const trayShown = tray.dataset.petTray === "open";
    const column = [];
    if (trayShown) column.push({ tray: true, size: trayHeight });
    if (chatOpen) column.push({ tray: false, size: CHAT_HEIGHT });
    const columnHeight = column.reduce((sum, member, index) => sum + member.size + (index > 0 ? COLUMN_GAP : 0), 0);

    /*
     * Clamp each surface using its own width. Sharing the widest member's clamp
     * leaves a narrow task card needlessly far from the screen edge; using only
     * visible members also makes it jump sideways when quick chat appears.
     * Neither surface's horizontal position should depend on the other's
     * visibility. The mascot retains its independent drag bounds as well.
     */
    const petCentre = x + width / 2;
    const centerFor = (surfaceWidth) => {
      const half = surfaceWidth / 2;
      const nearest = half + VIEWPORT_INSET;
      const furthest = window.innerWidth - half - VIEWPORT_INSET;
      return furthest < nearest ? window.innerWidth / 2 : Math.min(Math.max(petCentre, nearest), furthest);
    };
    const trayCentreX = centerFor(trayWidth);
    const chatCentreX = centerFor(chatWidth);

    const anchor = cluster() ? arc.y + HOVER_CONTROL_SIZE : height;
    const below = y + anchor + GAP_BELOW;
    // Jt(): the test is against the bottom of the screen, and a flipped column
    // hangs off the pet's own top rather than the cluster's.
    const flipped = below + columnHeight > window.innerHeight;
    const columnTop = flipped ? Math.max(VIEWPORT_INSET, y - columnHeight - GAP_BELOW) : below;
    // isTrayAboveMascot. The badge's chevron reads it: `f.placement.startsWith
    // ('bottom') && 'rotate-180'` (frame 3888), so it always points at the mascot.
    pet.dataset.petTrayAbove = flipped ? "true" : "false";

    // Walk it in order and give each member its top. Reversing the list is the
    // whole of isTrayAboveMascot: the stack ends up adjacent to the pet either
    // way, because the pet is at whichever end of the column it was flipped to.
    let cursor = columnTop;
    let trayTop = columnTop;
    let chatTop = columnTop;
    for (const member of flipped ? [...column].reverse() : column) {
      if (member.tray) trayTop = cursor;
      else chatTop = cursor;
      cursor += member.size + COLUMN_GAP;
    }

    tray.style.setProperty("--pet-tray-x", `${trayCentreX}px`);
    tray.style.setProperty("--pet-tray-y", `${trayTop}px`);
    tray.style.setProperty("--pet-tray-width", `${trayWidth}px`);
    tray.style.setProperty("--pet-tray-height", `${trayHeight}px`);

    chat.style.setProperty("--pet-chat-x", `${chatCentreX}px`);
    chat.style.setProperty("--pet-chat-y", `${chatTop}px`);
    chat.style.setProperty("--pet-chat-width", `${chatWidth}px`);

    // Kept for the hit-test filter, which needs to know where the cards ended up
    // without measuring them. Padded by the 12 px the dismiss button and the
    // shadows hang outside the box.
    trayRect = {
      left: trayCentreX - trayWidth / 2 - 12,
      top: trayTop - 12,
      right: trayCentreX + trayWidth / 2 + 12,
      bottom: trayTop + trayHeight + 12
    };

    chatRect = {
      left: chatCentreX - chatWidth / 2,
      top: chatTop,
      right: chatCentreX + chatWidth / 2,
      bottom: chatTop + CHAT_HEIGHT
    };
  }

  function place(nextX, nextY) {
    x = clampAnchor(nextX, 0, maxX());
    y = clampAnchor(nextY, 0, maxY());
    pet.style.left = `${x}px`;
    pet.style.top = `${y}px`;
    layout();
    // The direction is measured from the pet's own centre, so moving the pet
    // changes it even with the cursor still. Codex recomputes on the mascot rect
    // as well as the pointer — frame 3812 memoises Rt on [avatar, point, rect].
    paint();
  }

  const report = () => host.send({ t: "at", x, y });

  function applySize() {
    width = clampWidth(config.size);
    height = Math.round((width * SHEET.cellHeight) / SHEET.cellWidth);
    pet.style.setProperty("--pet-width", `${width}px`);
    // A pet that just grew may no longer fit where it was standing.
    place(x, y);
  }

  /* ── Playing the animation ──────────────────────────────────────────────*/

  /**
   * Which state wins. Codex's order is transient, then hover, then the status; a
   * forced state is put above all three because the point of it is to hold still
   * while being looked at, and looking at it means putting a cursor near it.
   */
  function effectiveState() {
    if (config.force !== "auto" && STATES[config.force]) return config.force;
    if (transient !== null) return transient;
    return hovering ? "jumping" : statusState;
  }

  /**
   * The point the pet should be facing, or null when it should be showing its own
   * animation instead.
   *
   * frame 3805's `w?.caretPoint ?? Re`, with the one source Antigravity has in place
   * of Codex's two: the caret in the composer. There is no computer use here to
   * supply the second, and the mouse is not a source in Codex, so it is not one
   * here either.
   */
  function lookPoint() {
    return chatTarget === null ? null : caretAt;
  }

  /**
   * The direction the pet should be facing right now, or null when it should be
   * showing its own animation instead.
   *
   * Derived rather than stored, so a state that starts looking picks the
   * direction up at once instead of waiting for the point to move again. The
   * rect is built from the position already known rather than measured, which
   * keeps a cursor crossing the screen from forcing a layout on every event.
   */
  function currentLookFrame() {
    if (drag !== null) return null; // A hand on the pet is not something to look at.
    if (!LOOKING_STATES.has(playing)) return null;
    const point = lookPoint();
    if (point === null) return null;
    return lookFrameFor({ left: x, top: y, width, height }, point);
  }

  function paint() {
    const look = currentLookFrame();

    if (look !== null) {
      // The shipped effect returns before it ever starts a timer when it has a
      // look frame — assets 116-124. So a pet facing the cursor is a still: the
      // sequence is not running underneath the pose, it is not running at all.
      looking = true;
      clearTimeout(frameTimer);
      frameTimer = undefined;
      sprite.style.backgroundPosition = backgroundPositionFor(look);
      return;
    }

    // lookFrame is one of that effect's dependencies, so losing it tears the
    // whole thing down and sets it up again: the animation begins at its first
    // frame rather than resuming wherever a timer would have got to. Which is
    // the difference between a pet that goes back to what it was doing and one
    // that starts doing it.
    if (looking) {
      looking = false;
      rebuild();
      return;
    }

    const frame = sequence.frames[frameIndex];
    if (frame) sprite.style.backgroundPosition = backgroundPositionFor(frame);
  }

  function schedule() {
    clearTimeout(frameTimer);
    frameTimer = undefined;
    if (looking) return;

    const frame = sequence.frames[frameIndex];
    // One frame is a picture, which is what reduced motion asks for.
    if (!frame || sequence.frames.length < 2) return;

    frameTimer = setTimeout(() => {
      const next = frameIndex + 1;
      if (next < sequence.frames.length) frameIndex = next;
      else if (sequence.loopStartIndex !== null) frameIndex = sequence.loopStartIndex;
      else return; // Nothing to loop back to; the last frame is held.
      paint();
      schedule();
    }, frame.frameDurationMs);
  }

  function rebuild() {
    sequence = buildSequence(playing, reducedMotion.matches);
    frameIndex = 0;
    paint();
    schedule();
  }

  /** Starts the winning state, and only if it is not the one already running. */
  function refresh() {
    const next = effectiveState();
    if (next === playing) return;
    playing = next;
    pet.dataset.petState = next;
    rebuild();
    host.send({ t: "playing", state: next });
  }

  /* ── The indicator ──────────────────────────────────────────────────────
   *
   * The mascot badge is slot 2 of the control cluster: a 24 px glass disc, coloured
   * by the highest level in the tray. Closed, the cluster passes a gap that is the
   * negative of the control size, so every slot lands on the mascot's centre line
   * and the badge is a sliver under its feet; open, it rides out to its place on
   * the arc.
   *
   * What is *on* the disc is the part that is easy to get wrong. Frame 3868-3952 is
   * one if/else over the same variable, and the number is only ever the second of
   * the two branches:
   *
   * - pills out (`_e && wt && F != null`): an icon-only chevron, labelled `Collapse
   *   activity stack` while the stack is open and `Hide activity` otherwise, with
   *   `rotate-180` when the tray sits below the mascot. Its click is onHideActivity-
   *   Pills. No number.
   * - pills stashed (`_e && ie != null && Ve && !le`): a glassy badge whose content
   *   is `S.length` and whose label is `Show activity, N items`. Its click is
   *   onShowActivityPills.
   *
   * So the count is not a running tally that sits on the pet — it is what the way
   * back looks like once the pills have been put away. Both branches need at least
   * one notification, which is the third state: with nothing to say there is no
   * badge, and avatar-mascot-button takes it out the way it brought it in, from
   * {opacity: 0, scale: 0.7, y: 3}.
   */
  function renderBadge() {
    const level = LEVELS[entries[0]?.status] ?? LEVELS.idle;
    pet.dataset.petTone = level.tone;
    tray.dataset.petTone = level.tone;

    const count = entries.length;
    const kind = stashed ? "count" : "chevron";
    pet.dataset.petBadgeKind = kind;
    badgeCount.textContent = kind === "count" && count > 0 ? String(count) : "";
    badge.title =
      count === 0
        ? ""
        : kind === "count"
          ? `Show activity, ${count} ${count === 1 ? "item" : "items"}`
          : stackExpanded && count > 1
            ? "Collapse activity stack"
            : "Hide activity";

    pet.dataset.petBadge = count === 0 ? "hidden" : cluster() ? "expanded" : "compact";
  }

  /* ── The activity stack ─────────────────────────────────────────────────
   *
   * fbe() has two branches and the page picks between them, so this does too.
   *
   * A pile is one card with two empty backings behind it. An open stack is a 208
   * px window onto the whole list, each card `54 + 8` below the last and shifted
   * by whatever has been scrolled, with `zIndex = items.length - index` keeping
   * the top one on top. Eight cards exist; the list behind them can be any length.
   */

  /** The two strings one entry puts on its card, whole. */
  function copyOf(entry) {
    const level = LEVELS[entry.status] ?? LEVELS.idle;
    const own = (typeof entry.subtitle === "string" ? entry.subtitle : "").trim();
    return {
      level,
      title: (typeof entry.title === "string" ? entry.title : "").trim(),
      body: own.length > 0 ? own : level.body
    };
  }

  /**
   * frame 2818: qr(), whether the body folds up onto the title's line.
   *
   * `kind !== 'activity' && waitingRequest == null && title.length <= 20 &&
   * subtitle.length > 40`. Every card here is a session notification — Ei() builds
   * them with `kind: 'session'` — so the kind term is always true. The waiting term
   * is not: a card that is asking a question keeps its two lines, because the
   * question is the point of it.
   */
  const inlineFold = (entry, title, body) =>
    entry.status !== "waiting" && title.length <= INLINE_TITLE_MAX && body.length > INLINE_BODY_MIN;

  /**
   * page 1160: Hr(), how wide the pills are.
   *
   * Codex measures rather than guesses, and measures once for the whole tray: every
   * pill is as wide as the widest of them, so the stack has one edge rather than a
   * ragged one. Each pill's text is its title at 13px bold plus, if the body folds
   * up onto that line, `•` and the body at 13px regular and the 12 px the separator's
   * margins take — or, if it does not fold, whichever of the two lines is wider. A
   * card that is neither running nor waiting adds 45 px for the controls it shows.
   *
   * The family comes off the card's own text rather than `document.body`, which is
   * where Codex reads it: this surface declares its own, and in the desktop window
   * there is no body styling to read. With no canvas to measure in — Hr()'s `t ==
   * null` — the answer is the 315 ceiling, which is what it was before any of this.
   */
  let widthContext;
  let widthKey = null;
  let widthValue = CARD_WIDTH;

  /** Ur(): the signature that says a re-measure is worth doing. This runs on a poll. */
  const widthSignature = () =>
    JSON.stringify(entries.map((entry) => [entry.key, entry.status, entry.title, entry.subtitle]));

  function cardWidth() {
    const key = widthSignature();
    if (key !== widthKey) {
      widthKey = key;
      widthValue = measureCards();
    }
    return widthValue;
  }

  function measureCards() {
    if (widthContext === undefined) {
      widthContext = document.createElement("canvas").getContext("2d") ?? null;
    }
    if (widthContext === null || entries.length === 0) return CARD_WIDTH;

    const family = window.getComputedStyle(cards[0]?.text ?? tray).fontFamily || FALLBACK_FAMILY;
    let widest = 0;
    for (const entry of entries) {
      const { level, title, body } = copyOf(entry);

      widthContext.font = `700 13px ${family}`;
      let text = widthContext.measureText(title).width;

      widthContext.font = `400 13px ${family}`;
      if (inlineFold(entry, title, body)) {
        text += widthContext.measureText(`•${body}`).width + INLINE_SEPARATOR_GAP;
      } else {
        text = Math.max(text, widthContext.measureText(body).width);
      }

      if (!level.loading && entry.status !== "waiting") text += CONTROL_ROOM;
      widest = Math.max(widest, text);
    }
    return Math.min(CARD_WIDTH, Math.max(CARD_MIN_WIDTH, Math.ceil(widest + CARD_SIDE_SPACING * 2)));
  }

  /**
   * What each card actually came out at, keyed by thread.
   *
   * Codex does not assume its rows are 54 px — it measures them. Every row root
   * carries `"data-avatar-overlay-measure": "notification-tray-row"` (frame 3144)
   * and the height that comes back is what fbe() lays out with, which is why
   * `fbe` sums `t.reduce((e, t) => e + t.height, 0)` rather than multiplying by a
   * constant. The pill is `min-h-[54px]` with no height, so 54 is the floor and
   * not the answer; a card whose text needs a second line is 54 + 17 and the one
   * behind it has to be moved down, or it gets painted over — which is exactly
   * the bleed. This map is that measurement, and CARD_HEIGHT is only the value to
   * lay out with before the first one has been taken.
   */
  const heights = new Map();
  const heightOf = (key) => heights.get(key) ?? CARD_HEIGHT;
  /** The shape the map was last filled against; see renderTray for what is in it. */
  let heightKey = null;

  /** gbe(): how tall the whole list is, every card's own height plus the gaps. */
  const contentHeight = () => {
    const total = entries.length;
    if (total === 0) return 0;
    let sum = (total - 1) * STACK_GAP;
    for (const entry of entries) sum += heightOf(entry.key);
    return sum;
  };

  /** dbe(): a scroll offset is only ever as far as there is something to scroll. */
  const clampScroll = (value) =>
    Math.min(Math.max(0, contentHeight() - STACK_VIEWPORT_HEIGHT), Math.max(0, value));

  /**
   * app-initial 21957: which entries an open stack draws, and where each one goes.
   *
   * Every entry gets a top, and fbe() walks the list to find it: a cursor starts
   * at `viewport.top - scrollOffset` and each row advances it by its own height
   * plus gbe(8). The ones nobody can see are placed too, because their tops are
   * precisely what puts them outside the window. Up to eight entries fbe() draws
   * the lot without filtering anything; past eight it keeps whatever overlaps the
   * viewport grown by 56 px of overscan, tops that set back up to eight with the
   * excluded entries nearest the window, and hands entry i the pool card at
   * `i % 8` — which keeps a card element with its entry while the list scrolls
   * under it.
   *
   * The window can never be more than seven long: 208 px of viewport plus 56 px of
   * overscan either side is 320, and a card's pitch is at least 54 + 8. Codex
   * asserts this outright — `throw Error("Activity stack overscan exceeds its
   * bounded slot pool")` at 21980 — and the floor under a card's height is what
   * makes the assertion safe.
   */
  function windowed() {
    let cursor = -scrollOffset;
    const placed = entries.map((entry, index) => {
      const height = heightOf(entry.key);
      const top = cursor;
      cursor += height + STACK_GAP;
      return { entry, index, top, height };
    });
    if (placed.length <= STACK_SLOTS) return placed;

    const viewport = Math.min(STACK_VIEWPORT_HEIGHT, contentHeight());
    const low = -STACK_OVERSCAN;
    const high = viewport + STACK_OVERSCAN;
    const drawn = placed.filter((slot) => slot.top < high && slot.top + slot.height > low);

    if (drawn.length < STACK_SLOTS) {
      // How far outside the window it fell, so the nearest are taken first.
      const away = (slot) => (slot.top >= high ? slot.top - high : low - (slot.top + slot.height));
      const inside = new Set(drawn.map((slot) => slot.index));
      drawn.push(
        ...placed
          .filter((slot) => !inside.has(slot.index))
          .sort((a, b) => away(a) - away(b) || a.index - b.index)
          .slice(0, STACK_SLOTS - drawn.length)
      );
      drawn.sort((a, b) => a.index - b.index);
    }
    return drawn.slice(0, STACK_SLOTS);
  }

  function say(into, className, text) {
    const span = make("span", className ? `bettergravity-pet-card__${className}` : "", into);
    span.textContent = text;
    return span;
  }

  /**
   * Writes one entry onto one card.
   *
   * Kr() is worth restating: the level's label is *not* card text. What the card
   * shows is the thread's title and, under it, its own body or the level's
   * fallback — Thinking, Needs input, Blocked, Ready. qr() folds the body up onto
   * the title's line when the title is short and the body long, and that folded
   * form is the one that goes secondary and clamps to two lines.
   */
  function writeCard(card, entry) {
    const { level, title, body } = copyOf(entry);
    const inline = inlineFold(entry, title, body);

    const root = card.root;
    root.hidden = false;
    root.dataset.petKey = entry.key;
    root.dataset.petTone = level.tone;
    root.dataset.petInline = inline ? "true" : "false";
    root.dataset.petHovered = hoveredKey === entry.key ? "true" : "false";
    // A single card is not a collapsed stack (native-frame 3822).
    root.dataset.petCollapsed = !stackExpanded && entries.length > 1 ? "true" : "false";
    root.dataset.petReplying = chatTarget === entry.key ? "true" : "false";
    // Inert under aria-hidden, but this is where Codex keeps the level's name and
    // the only place it belongs.
    root.setAttribute("aria-label", `${level.label} · ${title}`);

    /*
     * Which controls this card has, and therefore how much of its right-hand side
     * is spoken for. Ui() builds the pill's own class list out of exactly three
     * questions (frame 6047): loading, waiting on a request, and one control
     * instead of two. A card with no controls at all answers no to all three and
     * keeps the base padding — the status box is still over there — but `ke` is
     * false, so the text that runs under it is not faded out.
     */
    const controls = level.controls ?? (level.tone === "success" ? "success" : "default");
    root.dataset.petPill = level.loading ? "loading" : controls === "none" ? "none" : "default";
    root.dataset.petControlsVisible = controls !== "none" &&
      (chatTarget === entry.key || ((stackExpanded || entries.length === 1) && hoveredKey === entry.key))
      ? "true" : "false";

    card.text.textContent = "";
    if (inline) {
      say(card.text, "title", title);
      say(card.text, "separator", "•");
      say(card.text, "subtitle", body);
      card.body.textContent = "";
    } else {
      card.text.textContent = title;
      card.body.textContent = body;
    }
    card.text.dataset.petLoading = level.loading ? "true" : "false";

    // na() returns null for the spinner, so a running card's status box is empty
    // and the shimmer on its text is the whole indication. Only re-parse the
    // glyph when it actually changes; this runs on every poll.
    if (card.status.dataset.petStatus !== level.icon) {
      card.status.dataset.petStatus = level.icon;
      card.status.querySelector("svg")?.remove();
      const glyph = ICONS[level.icon] ?? "";
      if (glyph.length > 0) card.status.insertAdjacentHTML("beforeend", glyph);
    }
    card.statusDisc.hidden = level.icon !== "check-circle";

    card.controls.dataset.petControls = controls;
    card.reply.hidden = controls !== "default";
    card.stop.hidden = controls !== "default";
    card.dismiss.hidden = controls !== "success";
    // Oe: stop is enabled only on a card that is actually running.
    card.stop.setAttribute("aria-hidden", level.loading ? "false" : "true");
  }

  /**
   * Where one card sits, which is the only thing about it that a measurement can
   * change. Kept apart from writeCard so a second pass can move a card without
   * touching a word of what it says.
   *
   * zIndex is `items.length - index` (21995), so the front of the list is on top
   * and a card that has been scrolled under the one above it stays under it.
   */
  function placeCard(card, slot, total) {
    const root = card.root;
    if (stackExpanded) {
      root.style.setProperty("--pet-card-y", `${slot.top}px`);
      root.style.setProperty("--pet-card-z", String(total - slot.index));
    } else {
      root.style.removeProperty("--pet-card-y");
      root.style.removeProperty("--pet-card-z");
    }
  }

  /**
   * What the cards came out at, read back in one batch.
   *
   * offsetHeight and not getBoundingClientRect: a collapsed backing is drawn
   * through a transform, and the rect would report the scaled box while what the
   * ladder is built from is the unscaled one. Every read happens after every
   * write in the same pass, so this costs one forced layout rather than one per
   * card — and it is a layout of the whole host document, which is why the caller
   * only asks when something that could change a height has changed.
   *
   * A card with no box at all reports 0, which is not a measurement. That happens
   * before the stylesheet has landed, and `blind` is how the caller knows not to
   * write the attempt down as done.
   *
   * @returns `moved` if a card is a different height than the pass assumed,
   *   `blind` if nothing could be measured, `same` otherwise
   */
  function measureHeights(drawn) {
    if (drawn.length === 0) return "same";
    let moved = false;
    let read = false;
    for (const slot of drawn) {
      const measured = cardAt(slot.index % STACK_SLOTS).root.offsetHeight;
      if (measured <= 0) continue;
      read = true;
      const height = Math.max(CARD_HEIGHT, Math.ceil(measured));
      if (heights.get(slot.entry.key) === height) continue;
      heights.set(slot.entry.key, height);
      moved = true;
    }
    return read ? (moved ? "moved" : "same") : "blind";
  }

  /**
   * One pass of the stack: work out which entries are on screen, write them, and
   * put them where they go.
   *
   * @returns the slots it drew
   */
  function paintCards(total) {
    scrollOffset = clampScroll(scrollOffset);

    // A pile draws the front entry and nothing else, because fbe()'s collapsed
    // branch gives everything behind it a zero-height content rect.
    const drawn =
      total === 0
        ? []
        : stackExpanded
          ? windowed()
          : [{ entry: entries[0], index: 0, top: 0, height: heightOf(entries[0].key) }];

    // Anything the pointer was on that is no longer drawn cannot stay hovered,
    // and writeCard reads that, so it has to be settled first.
    if (hoveredKey !== null && !drawn.some((slot) => slot.entry.key === hoveredKey)) hoveredKey = null;

    const used = new Set();
    for (const slot of drawn) {
      const pool = slot.index % STACK_SLOTS;
      used.add(pool);
      writeCard(cardAt(pool), slot.entry);
      placeCard(cardAt(pool), slot, total);
    }
    for (let pool = 0; pool < cards.length; pool += 1) {
      if (used.has(pool)) continue;
      cards[pool].root.hidden = true;
      cards[pool].root.dataset.petHovered = "false";
    }
    return drawn;
  }

  function renderTray() {
    const total = entries.length;

    // Bi()'s `hasNotifications`: what the pill offers to do depends on whether
    // there is anything in the tray under it.
    chatInput.placeholder = total > 0 ? "Start new chat" : "Ask";

    tray.dataset.petStack = stackExpanded ? "expanded" : "collapsed";

    // A measurement belongs to a thread, so a thread that has gone takes its own
    // with it rather than sizing whatever entry inherits its slot.
    for (const key of [...heights.keys()]) {
      if (!entries.some((entry) => entry.key === key)) heights.delete(key);
    }

    // `Ce` only survives while the card does (frame 5941), so a thread that has
    // gone takes the aim with it and the pill returns to a new projectless chat.
    if (chatTarget !== null && !entries.some((entry) => entry.key === chatTarget)) {
      chatTarget = null;
      composerClosed();
    }

    /*
     * Draw, measure, and draw again if the measurement moved anything.
     *
     * Two passes at most, and the second is not a guess: it lays out against
     * heights read off the very text the first pass wrote, and writing the same
     * text again cannot change them. The second pass is what a taller card needs
     * — its own top is already right, but every card below it has to come down,
     * and one of them may be pushed clean out of the window while another is
     * pulled into it, which only re-windowing can find.
     *
     * The measure itself is behind a shape check, because reading offsetHeight
     * forces a layout of the host document and this runs on every wheel tick. A
     * card's height is decided by three things — the copy in it, how wide the tray
     * is, and whether the stack is open — and cardWidth() has already worked out a
     * signature over the first of those for its own memo. A scroll changes none of
     * them, so a scroll pays nothing.
     */
    const shape = `${stackExpanded}|${cardWidth()}|${widthKey}`;
    const first = paintCards(total);
    if (shape !== heightKey) {
      const settled = measureHeights(first);
      // `blind` is the stylesheet not having landed yet. Leaving the key alone is
      // what brings the pass back on the next render.
      if (settled !== "blind") heightKey = shape;
      if (settled === "moved") paintCards(total);
    }

    // The pile's own backings, which are empty for the same reason. lbe(): all
    // three rungs are built out of `{...viewport, height: items[0].height}`, the
    // front of the *list* and not of the window, so the two behind it are that
    // card scaled — not a 54 px stand-in.
    const front = entries[0] === undefined ? CARD_HEIGHT : heightOf(entries[0].key);
    tray.style.setProperty("--pet-pile-front", `${front}px`);
    tray.style.setProperty("--pet-pile-y-1", `${rungOffset(front, RUNGS[1])}px`);
    tray.style.setProperty("--pet-pile-y-2", `${rungOffset(front, RUNGS[2])}px`);
    backings[0].hidden = stackExpanded || total < 3;
    backings[1].hidden = stackExpanded || total < 2;

    // The masked edge is whichever side has something scrolled off it.
    const above = scrollOffset > 0;
    const belowEdge = scrollOffset < contentHeight() - STACK_VIEWPORT_HEIGHT;
    if (stackExpanded && (above || belowEdge)) {
      tray.dataset.petOverflow = above && belowEdge ? "both" : above ? "top" : "bottom";
    } else delete tray.dataset.petOverflow;

    /*
     * Whether the pills are on screen at all — a question the cursor has no say in.
     *
     * Codex's gate is `wt = le && Ve` (frame 3819): `areActivityPillsVisible` and a
     * non-empty list. `le` is not a hover state and not derived from one — the page
     * reads it straight out of a persisted setting, `dt = z(wa) ?? b(Ca, !0)` (page
     * 2049), and the only writers are the badge's two branches. The status pill is
     * the point of the whole feature, so it hangs under the mascot for as long as
     * there is something to say. Proximity adds the cluster, the card controls and
     * the quick chat on top; it takes none of this away.
     */
    const open = config.activity && !stashed && total > 0;
    tray.dataset.petTray = open ? "open" : "closed";
    if (!open && stackExpanded) {
      // Dr(): whatever puts the pills away closes the stack and rewinds it, so the
      // next time they come out it is a pile again.
      stackExpanded = false;
      scrollOffset = 0;
      tray.dataset.petStack = "collapsed";
    }
  }

  /** Everything that depends on the activity list, in the order it depends on it. */
  function renderActivity() {
    statusState = working ? "running" : (LEVELS[entries[0]?.status] ?? LEVELS.idle).mascot;
    renderBadge();
    renderTray();
    layout();
    refresh();
  }

  /* ── Which pixels belong to the pet ─────────────────────────────────────
   *
   * On the desktop the window covers the whole working area, so it has to be a
   * hole everywhere the pet is not. The main process keeps it click-through with
   * `setIgnoreMouseEvents(true, { forward: true })`, and the forwarding is what
   * makes this possible at all: mouse moves still reach the document while it is
   * ignoring the mouse, so the surface can ask what is under the cursor and turn
   * the window solid for exactly those pixels. `data-pet-hit` marks them.
   *
   * elementFromPoint is a real hit test — it respects the cards' corner radii —
   * but it is also the one thing here that can force a layout, and in
   * Antigravity's window the document under the cursor is the whole editor. So it
   * only runs when the cursor is already inside one of the boxes below: the pet
   * plus the 56 px the proximity test itself reaches, the tray while it is open,
   * and the chat pill while it is out. A cursor anywhere else costs nothing.
   */

  const inRect = (rect, px, py) =>
    px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom;

  function near(px, py) {
    if (
      px >= x - PROXIMITY_EXIT_PX &&
      px <= x + width + PROXIMITY_EXIT_PX &&
      py >= y - PROXIMITY_EXIT_PX &&
      py <= y + height + PROXIMITY_EXIT_PX
    ) {
      return true;
    }
    if (tray.dataset.petTray === "open" && inRect(trayRect, px, py)) return true;
    return chatOpen && inRect(chatRect, px, py);
  }

  /** Whatever part of the pet the cursor is on, or null. */
  function hitAt(px, py) {
    if (!near(px, py)) return null;
    const element = document.elementFromPoint(px, py);
    return element === null ? null : element.closest("[data-pet-hit]");
  }

  /**
   * How far the cursor is from the pet, measured to the nearest point of its box
   * and so zero while it is on it.
   *
   * This is what pet-pointer-proximity-changed is reporting. It is the pet's own
   * rect and nothing else's: the cards the pet has put on screen do not enlarge
   * it, which is why being over one of them counts separately below.
   */
  function distanceTo(px, py) {
    const dx = Math.max(x - px, 0, px - (x + width));
    const dy = Math.max(y - py, 0, py - (y + height));
    return Math.hypot(dx, dy);
  }

  /**
   * Opens or closes the cluster, with the hysteresis and the delay Codex uses.
   *
   * 40 px in, 56 px out, so a cursor resting on the boundary cannot make it
   * flicker; and leaving waits compactDismissDelayMs, so crossing the gap between
   * the pet and its own cards — or reaching past one control to another — does
   * not shut everything on the way.
   *
   * @returns whether anything needs redrawing now
   */
  function setNearby(next) {
    // A caret in the chat pill pins everything open. Codex's 300 ms is there to
    // forgive a cursor crossing a gap, not to take a half-typed question away.
    if (next || document.activeElement === chatInput) {
      clearTimeout(dismissTimer);
      dismissTimer = undefined;
      if (nearby) return false;
      nearby = true;
      return true;
    }

    if (!nearby || dismissTimer !== undefined) return false;
    dismissTimer = setTimeout(() => {
      dismissTimer = undefined;
      nearby = false;
      chatOpen = false;
      chatTarget = null;
      hoveredKey = null;
      renderCluster();
    }, DISMISS_DELAY_MS);
    return false;
  }

  /** Everything the cluster's own state decides, in the order it decides it. */
  function renderCluster() {
    pet.dataset.petCluster = nearby ? "open" : "closed";
    chat.dataset.petChat = chatOpen ? "open" : "closed";
    renderBadge();
    renderTray();
    layout();
    refresh();
  }

  /**
   * Everything that follows the cursor: the window's own solidity, how near the
   * pet the pointer is, which card it is over, and which way the pet is looking.
   *
   * A held pet keeps the window solid whatever the hit test says. A hand can
   * leave the sprite between two moves, and going click-through there would drop
   * the drag on the floor.
   */
  function updatePointer(px, py) {
    pointerAt = { x: px, y: py };

    const hit = drag !== null ? pet : hitAt(px, py);
    if (desktop) host.setInteractive(hit !== null);

    // Over the pet's own surface counts as near it however far the cursor has
    // reached down the stack, which is Ui()'s isPointerSurfaceHovered.
    const threshold = nearby ? PROXIMITY_EXIT_PX : PROXIMITY_ENTER_PX;
    let changed = setNearby(hit !== null || distanceTo(px, py) <= threshold);

    /*
     * The Ask pill's own trigger, which is not the pet's.
     *
     * Codex hangs onQuickChatPointerEnter on the tray column rather than on the
     * mascot (frame 4115), and leaves that wrapper `pointer-events-none` until
     * `Tt` — pills up with something in them, or the quick chat already out
     * (4094). So the pill comes out when the cursor reaches the cards, not when
     * it comes near the pet, and a pet with nothing to report has no way of
     * being asked anything: there is nothing there to hover.
     *
     * Nor does leaving the column put it away. onQuickChatPointerLeave starts a
     * 300 ms timer that gives up if any hit region is still hovered (3843), and
     * every part of this is a hit region — so what actually closes the pill is
     * the cluster's own dismissal, which setNearby already does.
     */
    const column = hit !== null && hit.dataset.petHit !== "pet" && hit.dataset.petHit !== "badge";
    if (column && !chatOpen) {
      chatOpen = true;
      changed = true;
    }

    const over = hit !== null && hit.dataset.petHit === "pet";
    if (over !== hovering) {
      hovering = over;
      changed = true;
    }

    const key = hit?.closest("[data-pet-key]")?.dataset.petKey ?? null;
    if (key !== hoveredKey) {
      hoveredKey = key;
      changed = true;
    }

    if (changed) renderCluster();
    paint();
  }

  /** The cursor has left for somewhere this document cannot see. */
  function forgetPointer() {
    if (pointerAt === null && !nearby && !hovering) return;
    pointerAt = null;
    hovering = false;
    setNearby(false);
    renderCluster();
    if (desktop && drag === null) host.setInteractive(false);
    paint();
  }

  /** Adds a listener and remembers how to take it off again. */
  const on = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    track(() => target.removeEventListener(type, handler, options));
  };

  // `mousemove` rather than `pointermove`, because a forwarded mouse message is
  // what Electron promises to deliver to a click-through window; pointer events
  // are for the drag, which only happens once the window is solid.
  on(document, "mousemove", (event) => updatePointer(event.clientX, event.clientY), {
    passive: true
  });
  on(document, "mouseleave", forgetPointer);
  on(window, "blur", () => {
    if (drag !== null) endDrag({ pointerId: drag.pointerId }, false);
    if (desktop) chatInput.blur();
    else forgetPointer();
  });

  on(reducedMotion, "change", () => {
    rebuild();
  });

  on(window, "resize", () => {
    // Same clamp as a drag: the pet stays inside whatever the work area now is.
    place(x, y);
    report();
  });

  /* ── Picking it up ──────────────────────────────────────────────────────*/

  const sampleOf = (event) => ({ x: event.clientX, y: event.clientY, timeMs: event.timeStamp });

  /** Only the last 160 ms of a drag says anything about how hard it was thrown. */
  function prune(list) {
    const newest = list.at(-1);
    return newest == null
      ? [...list]
      : list.filter((entry) => newest.timeMs - entry.timeMs <= SAMPLE_WINDOW_MS);
  }

  /**
   * The sample at which the pointer stopped moving.
   *
   * Walks back from the newest sample through every sample within the 4 px
   * threshold of it and returns the oldest of them. Hold the pet still for a
   * moment before letting go and this lands on the first stationary sample, which
   * leaves nothing older in the window to measure against — so a deliberate
   * placement never turns into an accidental throw.
   */
  function movementEnd(list) {
    const newest = list.at(-1);
    if (newest == null) return undefined;

    let index = list.length - 1;
    while (index > 0) {
      const previous = list[index - 1];
      if (previous == null) break;
      if (Math.abs(newest.x - previous.x) >= DRAG_THRESHOLD_PX) break;
      if (Math.abs(newest.y - previous.y) >= DRAG_THRESHOLD_PX) break;
      index -= 1;
    }
    return list[index];
  }

  /**
   * How fast the pet was moving when it was let go, in pixels per second, or null
   * when the release was a placement rather than a throw.
   */
  function velocityOf(list) {
    const end = movementEnd(list);
    if (end == null) return null;
    const start = list.find((entry) => end.timeMs - entry.timeMs > 0);
    if (start == null) return null;

    const seconds = Math.max(end.timeMs - start.timeMs, MIN_SAMPLE_DT_MS) / 1000;
    const velocity = { x: (end.x - start.x) / seconds, y: (end.y - start.y) / seconds };
    const speed = Math.hypot(velocity.x, velocity.y);

    if (speed < MIN_THROW_SPEED) return null;
    if (speed <= MAX_THROW_SPEED) return velocity;

    // Faster than the ceiling: keep the direction, cap the magnitude.
    const scale = MAX_THROW_SPEED / speed;
    return { x: velocity.x * scale, y: velocity.y * scale };
  }

  /* ── Throwing it ────────────────────────────────────────────────────────*/

  function stopMomentum() {
    clearTimeout(momentumTimer);
    momentumTimer = undefined;
  }

  /**
   * Flies the pet from where it is, bouncing off the edges of the work area, until
   * it is slower than the stop speed or 900 ms have passed.
   *
   * **This is off by default, because in Codex it very nearly never runs.** The one
   * route into it is the `avatar-overlay-drag-release` message (main 55418), and the
   * release handler only sends that message when `usesOrbPhysics` is set — page 2734:
   *
   *   n.usesOrbPhysics && o != null &&
   *     K.dispatchMessage(`avatar-overlay-drag-release`, {
   *       shouldBounce: !0, velocityX: o.x * 3, velocityY: o.y * 3,
   *     });
   *
   * and `usesOrbPhysics` (page 2761) is `R && !A`, where `R` needs a live realtime
   * voice session and `A` is a feature gate. No voice call, no throw: dropping the
   * mascot in the Codex or ChatGPT app just leaves it where you let go, which is why
   * a plugin that threw it on every release felt wrong. "Throw it" turns it back on.
   *
   * Codex runs this in its main process, moving a real window across the display.
   * The arithmetic below is the same, tick for tick: advance by velocity, reverse
   * an axis that hit an edge and keep 70% of its speed, then shed friction. It is
   * a chained timeout rather than an interval because a tick that arrives late
   * should not have the next one arrive immediately behind it.
   *
   * On the desktop the edges being bounced off are the screen's, because the
   * document is the screen — which is the version Codex actually ships.
   */
  function throwPet(velocity) {
    let vx = velocity.x * THROW_MULTIPLIER;
    let vy = velocity.y * THROW_MULTIPLIER;
    if (!Number.isFinite(vx) || !Number.isFinite(vy) || (vx === 0 && vy === 0)) return;

    stopMomentum();

    const startedAt = performance.now();
    let previousAt = startedAt;

    const tick = () => {
      const now = performance.now();
      // Clamped at both ends: a backgrounded window can hand back an hour.
      const dtMs = Math.min(Math.max(0, now - previousAt), MAX_TICK_DT_MS);
      previousAt = now;

      const seconds = dtMs / 1000;
      const wantedX = x + vx * seconds;
      const wantedY = y + vy * seconds;

      place(wantedX, wantedY);

      // place() rounds and clamps to the work area and assigns the value it used,
      // so a position that came back different from the *rounded* wanted one is a
      // position that hit an edge. Codex compares the same way — main 102975 is
      // `this.anchor.x !== Math.round(h.x) && (i = n ? -i * G5 : 0)`, where the
      // anchor has been through Vf and `h` has not. Comparing against the raw
      // wanted value instead would call every single tick a bounce.
      if (x !== Math.round(wantedX)) vx = -vx * RESTITUTION;
      if (y !== Math.round(wantedY)) vy = -vy * RESTITUTION;

      const kept = FRICTION ** (dtMs / TICK_MS);
      vx *= kept;
      vy *= kept;

      if (now - startedAt >= MAX_MOMENTUM_MS || Math.hypot(vx, vy) < STOP_SPEED) {
        stopMomentum();
        report();
        // It has landed somewhere new, which may or may not be under the cursor.
        if (pointerAt !== null) updatePointer(pointerAt.x, pointerAt.y);
        refresh();
        return;
      }

      momentumTimer = setTimeout(tick, TICK_MS);
    };

    momentumTimer = setTimeout(tick, TICK_MS);
  }

  /* ── The pointer ────────────────────────────────────────────────────────
   *
   * Antigravity's shell has `-webkit-app-region: drag` on its own chrome, and a
   * press that lands inside a drag region is taken by the window manager before
   * the page ever sees a `pointerdown` — while `mousemove` keeps arriving, which
   * is exactly the shape of "the pet watches the cursor but will not be picked
   * up". The stylesheets opt every part of the pet back out with `no-drag`; this
   * end holds up the other half of the bargain.
   *
   * Capture on the document rather than bubble on the pet, and after
   * `setPointerCapture` rather than instead of it. Capture is the fast path: with
   * it, every move and release for this pointer is delivered to the pet however
   * far outside it the cursor travels. But the workbench is full of listeners that
   * call `stopPropagation`, and some of them capture the pointer themselves —
   * either one takes the release away, and a pet whose `pointerup` never arrives
   * is a pet stuck to the cursor. Listening at the document in the capture phase
   * runs us before any of them and needs no capture to have been granted.
   */

  on(pet, "pointerdown", (event) => {
    // Codex's own guard: the primary button only, and never a ctrl-press (which is
    // a right-click on macOS).
    if (event.button !== 0 || event.ctrlKey || event.isPrimary === false) return;
    // The mascot is draggable; the badge sitting on it is a button. Asking which
    // hit region the press landed in rather than testing for a `.no-drag` class
    // also means a page that happens to use that class cannot nail the pet down.
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("[data-pet-hit]") !== pet) return;

    event.preventDefault();
    // Nothing in the workbench needs to know the pet was pressed, and one of the
    // things it might do about it is take the pointer.
    event.stopPropagation();
    // Best-effort: a page that has already captured this pointer makes this throw,
    // and the document-level handlers below do not need it to have worked.
    try {
      pet.setPointerCapture(event.pointerId);
    } catch {}
    stopMomentum();

    drag = {
      pointerId: event.pointerId,
      samples: [sampleOf(event)],
      x: event.clientX,
      y: event.clientY,
      grabX: event.clientX - x,
      grabY: event.clientY - y,
      hasMoved: false
    };

    transient = null;
    pet.dataset.petDragging = "true";
    // Held, the indicator goes back to its resting sliver.
    renderBadge();
    // A held pet does not look around, so the pose has to come off now.
    paint();
    refresh();
  });

  on(
    document,
    "pointermove",
    (event) => {
      if (drag === null || event.pointerId !== drag.pointerId) return;
      // A release outside the window can be missed even with document capture.
      if (event.buttons === 0) {
        endDrag(event, false);
        return;
      }

      const next = sampleOf(event);
      drag.samples = prune([...drag.samples, next]);

      const dx = next.x - drag.x;
      const dy = next.y - drag.y;
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;

      drag.hasMoved = true;
      drag.x = next.x;
      drag.y = next.y;

      // Codex suppresses the running frames while its throw physics are on, because
      // in that mode the mascot is drawn as an orb with no sprite to animate — and
      // those physics are almost never on (see throwPet). Ours is always the sprite,
      // so it turns and runs the way it is being pulled.
      if (dx >= RUN_THRESHOLD_PX) transient = "running-right";
      else if (dx <= -RUN_THRESHOLD_PX) transient = "running-left";

      place(next.x - drag.grabX, next.y - drag.grabY);
      refresh();
    },
    true
  );

  /**
   * @param {boolean} released true for a real release, false for a cancelled one
   */
  function endDrag(event, released) {
    if (drag === null || event.pointerId !== drag.pointerId) return;

    const held = drag;
    drag = null;
    // Codex clears the transient here, so the pet stops running the instant it is
    // let go and flies through the air as whatever the agent is doing.
    transient = null;

    try {
      if (pet.hasPointerCapture(event.pointerId)) pet.releasePointerCapture(event.pointerId);
    } catch {}
    delete pet.dataset.petDragging;
    renderBadge();
    refresh();

    // Cancellation is a placement, never a click or a throw. The next real
    // pointer move can re-establish hover after focus or capture was lost.
    if (!released) {
      forgetPointer();
      report();
      return;
    }

    const release = sampleOf(event);
    const samples = prune([...held.samples, release]);

    // A flick too fast to register a single accepted move still counts as a drag,
    // measured from where the press started.
    const first = held.samples[0];
    const last = release ?? held.samples.at(-1);
    const moved =
      held.hasMoved ||
      (first != null &&
        last != null &&
        (Math.abs(last.x - first.x) >= DRAG_THRESHOLD_PX ||
          Math.abs(last.y - first.y) >= DRAG_THRESHOLD_PX));

    if (released && !moved) {
      // Codex's mascot brings the app forward when it is clicked rather than
      // dragged. Only the page half can do that, so it is asked to.
      host.send({ t: "poke" });
      if (pointerAt !== null) updatePointer(pointerAt.x, pointerAt.y);
      return;
    }

    const velocity = config.bounce ? velocityOf(samples) : null;
    if (velocity !== null) throwPet(velocity);
    else {
      report();
      if (pointerAt !== null) updatePointer(pointerAt.x, pointerAt.y);
    }
  }

  on(document, "pointerup", (event) => endDrag(event, true), true);
  on(document, "pointercancel", (event) => endDrag(event, false), true);
  on(pet, "lostpointercapture", (event) => endDrag(event, false));

  /* ── The things you can press ───────────────────────────────────────────
   *
   * One delegated handler, because the cards are pooled and rebuilt on every poll
   * and a listener per card would have to be taken off again.
   *
   * The order matters: a control is inside a card, so the control has to be asked
   * about first, or every stop button would also open the thread it belongs to.
   */

  /** Which entry a press landed on, whatever part of the card it hit. */
  const keyOf = (target) =>
    target instanceof Element ? (target.closest("[data-pet-key]")?.dataset.petKey ?? null) : null;

  const tell = (t, key) => {
    if (typeof key === "string" && key.length > 0) host.send({ t, key });
  };

  on(document, "click", (event) => {
    if (!(event.target instanceof Element)) return;

    /*
     * The badge, which is one control doing two jobs — Rr(), page 2949:
     *
     *   Rr = (e) => {
     *     if ((Lr(!1), e !== !0 && W && q.length > 1)) { …close-notification-stack…; Dr(); return }
     *     (Dr(), c(Ca, !1), w.set(wa, !1))
     *   }
     *
     * `Lr(!1)` gives up the quick-chat caret first. Then, with the stack open and
     * more than one thread in it, the press only closes the stack and stops there —
     * the pills are not put away until a second press has nothing left to collapse.
     * `Dr()` is `ft(!1), Wt(0)`: closed, and rewound to the top.
     */
    if (event.target.closest('[data-pet-hit="badge"]') !== null) {
      if (entries.length === 0) return;
      if (document.activeElement === chatInput) chatInput.blur();
      if (stashed) {
        // Vr(): the count is the way back.
        stashed = false;
      } else if (stackExpanded && entries.length > 1) {
        stackExpanded = false;
        scrollOffset = 0;
      } else {
        stashed = true;
        stackExpanded = false;
        scrollOffset = 0;
      }
      renderCluster();
      return;
    }

    const control = event.target.closest("[data-pet-control]");
    if (control !== null) {
      const key = keyOf(control);
      switch (control.dataset.petControl) {
        case "reply":
          /*
           * The pill is already out — reaching this button meant crossing the
           * card it is on — so pressing it does what Codex's reply control does
           * to the composer it owns: `q("")` throws away whatever was half
           * typed, `G(_.turnKey)` aims it at this thread, and the caret goes
           * into it. Pressing it again while it is already aimed here is the
           * `if (Te) { Qe(); return }` branch, which closes the composer; the
           * pill cannot close while the cursor is on the card that opens it, so
           * what it gives up is the caret — `Lr(!1)`, the same thing the badge
           * does first.
           *
           * Nothing is told to the editor. `open-follow-up` sets the follow-up
           * state and no more (page 2994): the thread is not brought on screen
           * until something is actually sent to it, which is what submitChat's
           * key is for. Pressing reply moves nothing but the caret.
           */
          if (chatTarget === key && document.activeElement === chatInput) {
            chatInput.value = "";
            chatTarget = null;
            chatInput.blur();
            break;
          }
          chatInput.value = "";
          chatTarget = key;
          composerClosed();
          chatInput.focus();
          break;
        case "stop":
          if (control.getAttribute("aria-hidden") !== "true") {
            // Stop clears the composer it shares a row with, too.
            if (chatTarget === key) {
              chatInput.value = "";
              chatTarget = null;
              composerClosed();
            }
            tell("stop", key);
          }
          break;
        case "success":
        case "close":
          tell("dismiss", key);
          break;
        case "send":
          submitChat();
          break;
      }
      renderCluster();
      return;
    }

    const card = event.target.closest('[data-pet-hit="card"]');
    if (card === null) return;

    /*
     * onActivateNotification. A pile of more than one is a lid before it is a
     * button: the first press opens the stack and goes no further, because until
     * it is open there is no telling which of the threads underneath was meant.
     * One card on its own opens straight away.
     */
    if (!stackExpanded && entries.length > 1) {
      stackExpanded = true;
      scrollOffset = 0;
      renderCluster();
      return;
    }
    tell("open", keyOf(card));
  });

  /*
   * dbe(): the stack scrolls inside its 208 px viewport, clamped so it cannot be
   * pushed past either end. Only when it is open — a pile has nothing to scroll,
   * and swallowing the editor's own wheel events over a closed one would be rude.
   */
  on(
    tray,
    "wheel",
    (event) => {
      if (!stackExpanded) return;
      const next = clampScroll(scrollOffset + event.deltaY);
      if (next === scrollOffset) return;
      event.preventDefault();
      scrollOffset = next;
      renderTray();
      layout();
    },
    { passive: false }
  );

  /** The chat pill, which is one line of text and the button on the end of it. */
  function submitChat() {
    const text = chatInput.value.trim();
    if (text.length === 0) return;
    /*
     * `(q(``), G(void 0))` before the send: the composer is emptied and stops being
     * aimed at anything.
     *
     * And the aim is passed on exactly as it stands, null included. Codex has two
     * submits, not one: a card's reply control aims the pill and the question
     * becomes a follow-up in that thread (`onSubmitFollowUp`, frame 6655, which
     * carries the notification), while the pill on its own carries nothing at all
     * and Fr() sends it to a create call with `target: { type: "projectless" }`
     * (page 1859). Falling back to the front of the list would put a new question
     * into whichever thread happened to be running, which is not a thing Codex
     * can do.
     */
    const key = chatTarget;
    chatInput.value = "";
    chatTarget = null;
    composerClosed();
    host.send({ t: "ask", text, key });
  }

  /**
   * hi(), frame 3428: everything about the composer that could move the caret.
   * Joined with a NUL because none of the parts can contain one.
   */
  const composerReading = () =>
    [
      chatInput.value,
      chatInput.selectionStart,
      chatInput.selectionEnd,
      chatInput.selectionDirection,
      chatInput.scrollLeft,
      chatInput.scrollTop
    ].join("\0");

  /** The `follow-up-editor-changed` half of frame 5666: measure, then report. */
  function composerChanged() {
    // Codex's separate quick-chat input only updates its text (frame 5504).
    // Only a targeted follow-up supplies a look point to the mascot.
    if (chatTarget === null || document.activeElement !== chatInput) {
      composerClosed();
      return;
    }
    const reading = composerReading();
    if (reading === caretReading) return;
    caretReading = reading;
    caretAt = caretPointOf(chatInput);
    paint();
  }

  /** Losing the composer loses the point with it — `G(void 0)` clears `w`. */
  function composerClosed() {
    if (caretAt === null && caretReading === null) return;
    caretAt = null;
    caretReading = null;
    paint();
  }

  /*
   * onChange and onSelect, frame 5776. A value that changed and a caret that
   * moved are the same event as far as the head is concerned, so both arrive
   * here.
   *
   * Four listeners for React's two because `onSelect` is not the DOM event of
   * that name: Chromium fires `select` only when a range is actually selected,
   * and React's own plugin makes up the difference by watching keyup and mouseup
   * as well and firing when the selection reads differently. Which is why
   * composerChanged is gated on the reading rather than on the event — an arrow
   * key that moves the caret is a report, and a modifier that moves nothing is
   * not, whichever listener happens to catch it.
   */
  on(chatInput, "input", composerChanged);
  on(chatInput, "select", composerChanged);
  on(chatInput, "keyup", composerChanged);
  on(chatInput, "pointerup", composerChanged);
  // A non-focusable desktop window can focus a DOM input without receiving any
  // keys. Request native focus only while this editor is being used.
  const focusChat = () => {
    if (desktop) host.setFocusable?.(true);
  };
  on(chatInput, "pointerdown", focusChat);
  on(chatInput, "focus", focusChat);

  on(chatInput, "keydown", (event) => {
    // The editor has a great many global key handlers and no reason to see a
    // question being typed at the pet, so none of them get it.
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      submitChat();
    }
    else if (event.key === "Escape") chatInput.blur();
  });

  // Losing the caret is what lets the cluster close again, and it may already be
  // outside the pet by then.
  on(chatInput, "blur", () => {
    if (desktop) host.setFocusable?.(false);
    composerClosed();
    if (pointerAt === null) forgetPointer();
    else updatePointer(pointerAt.x, pointerAt.y);
  });

  /* ── Talking to the other half ──────────────────────────────────────────
   *
   * Four messages in. `config` and `activity` are the sensor pushing new state;
   * `at` puts the pet back where it was last left, which is how a desktop pet
   * remembers its place across restarts; `bye` is the teardown.
   */

  track(
    host.onMessage((message) => {
      if (message === null || typeof message !== "object") return;

      switch (message.t) {
        case "config": {
          const before = config;
          config = { ...config, ...message.config };
          if (config.size !== before.size) applySize();
          if (config.sheet !== before.sheet) applySheet();
          renderActivity();
          paint();
          break;
        }
        case "activity": {
          entries = Array.isArray(message.entries) ? message.entries : [];
          working = message.working === true || entries.some((entry) => entry.status === "running");
          renderActivity();
          break;
        }
        case "at": {
          if (Number.isFinite(message.x) && Number.isFinite(message.y)) {
            stopMomentum();
            place(message.x, message.y);
          }
          break;
        }
        case "bye": {
          dispose();
          break;
        }
      }
    })
  );

  function dispose() {
    if (disposed) return;
    disposed = true;

    clearTimeout(frameTimer);
    clearTimeout(momentumTimer);
    clearTimeout(dismissTimer);

    for (const cleanup of cleanups.splice(0)) {
      // One teardown that throws must not strand the rest of them.
      try {
        cleanup();
      } catch {}
    }

    pet.remove();
    tray.remove();
    chat.remove();
    if (desktop) {
      host.setFocusable?.(false);
      host.setInteractive(false);
    }
  }

  /* ── Waking up ──────────────────────────────────────────────────────────
   *
   * There is no code here for the greeting, and that is the point of it. Codex
   * greets you with a notification rather than an animation — Ti(), native-page
   * 1431 — and the wave is what rr() makes of a notification whose kind is
   * `first-awake`. The sensor puts that card in the list and the pet plays its
   * waving reaction. Any agent starting work preempts the greeting immediately.
   */

  function mount() {
    if (disposed) return;

    document.body.append(pet, tray, chat);
    applySheet();
    applySize();

    // Where it was last left, or the bottom-right corner — Codex's own default
    // spot, and on the desktop that corner is the corner of the screen.
    const at = data?.at;
    place(
      Number.isFinite(at?.x) ? at.x : maxX() - VIEWPORT_INSET,
      Number.isFinite(at?.y) ? at.y : maxY() - VIEWPORT_INSET
    );

    renderActivity();

    // Unconditionally, because refresh() only rebuilds when the state changes and
    // a pet that woke up idle has never had a sequence started at all.
    rebuild();

    // The sensor cannot see into this document — on the desktop it is a window in
    // another process with nothing shared but a message channel. This is the only
    // proof it ever gets that the pet is really standing here, and a desktop
    // window that never sends it is treated as a window that never opened.
    host.send({ t: "hello", desktop, width: window.innerWidth, height: window.innerHeight });
  }

  if (document.body !== null) mount();
  else on(document, "DOMContentLoaded", mount, { once: true });
}

/* ═══ PART TWO — the sensor ════════════════════════════════════════════════ */

/*
 * Codex drives the pet from its own notification tray, and the tray is filled by
 * the app's own model of what each thread is doing. Antigravity has no tray, so
 * the entries are read off its sidebar instead — but not by guessing at it.
 *
 * Antigravity draws one status mark per row from a single component, and that
 * component is a ladder with the same five outcomes Codex has. From its own
 * bundle:
 *
 *   isArchived              → an archive icon
 *   isPendingUserInteraction→ the tool's icon wrapped in a ping, which is the
 *                             thing that puts [data-testid="attention-dot"] in
 *   isBackgroundWorking     → three bouncing dots in <span aria-label="Loading">
 *   isLoading               → [data-testid="status-loading-spinner"]
 *   isUnread                → [data-testid="status-unread-dot"]
 *   otherwise               → the timestamp, and nothing else
 *
 * which is Vr() in avatar-overlay-native-frame line by line: waiting, then
 * failed, then running, then review, then idle. Antigravity has no
 * conversation-level failure — CascadeRunStatus is only UNSPECIFIED, IDLE,
 * RUNNING, CANCELING, BUSY — so `failed` is the one level with no mark on the
 * row, and it is read off the thread on screen instead.
 *
 * The reading is the only part of the pet that is not Codex's. Everything done
 * with the result is — the priority order, the tone, the labels, the expiries,
 * how many fit in the stack, and the sort.
 */

/** Antigravity's own marks, each one taken from its own row component. */
const ROW = '[data-testid="conversation-row-sidebar"]';
const ROW_LIST = '[data-testid="conversation-list-sidebar"]';
/**
 * A row's name, twice over.
 *
 * Every row is an overlay anchor covering the whole of it — `<a href="/c/{id}"
 * aria-label="{title}">` — over a stack of flex boxes with the visible name in a
 * `span.truncate`. The anchor is the one to read: its label is the thread's title
 * and only ever that, where `span.truncate` is a class the sidebar also uses for
 * section headers and for the workspace line, so the first match inside an unusual
 * row can be something that is not a thread name at all. The span stays as the
 * fallback, for a row shaped in some way this has not seen.
 */
const ROW_LINK = "a[aria-label]";
const ROW_TITLE = "span.truncate";
const ROW_STAMP = "[data-screenshot-volatile]";
const ROW_ATTENTION = '[data-testid="attention-dot"]';
const ROW_WORKING = '[aria-label="Loading"]';
const ROW_SPINNER = '[data-testid="status-loading-spinner"]';
const ROW_UNREAD = '[data-testid="status-unread-dot"]';

/** The stable conversation id Antigravity puts on every row. */
const ROW_ID = "data-cascade-id";

/**
 * The thread on screen, for the one level the sidebar cannot report.
 *
 * `rose-400` is the whole test for a failure: it appears twice in Antigravity's
 * bundle and both are the same string, `Wt()`'s Red case — `text-rose-400
 * bg-rose-400/10` around a 6 px dot — so nothing else in the app can match it.
 * The reply and the sent message are only there to date it: a red dot counts as
 * the thread's state while it is the last of the three, and stops counting when
 * something newer arrives.
 */
const VIEW = '[data-testid="conversation-view"]';
const VIEW_ERROR = '[class*="rose-400"]';
const VIEW_REPLY = '[data-testid="planner-response-text"]';
const VIEW_SENT = '[data-testid="user-input-step"]';

const SUMMARY = '[data-testid="planner-response-text"]';
const COMPOSER = '[data-testid="agent-input-box"]';

/**
 * The composer's own editable, and the button that sends what is in it.
 *
 * `agent-input-box` is a wrapper — a column holding the running-items panel, the
 * model and context pickers and the editable. The editable itself is a
 * contenteditable div labelled `Message input`, and the send button is a real
 * `<button>` that is `disabled` for as long as there is nothing to send. That
 * disabled attribute is the whole reason the pill used to look like it was holding
 * back: Enter alone is not what submits here, and a click that lands on a disabled
 * button does nothing at all — so text has to go in first, and the button has to be
 * waited for.
 */
const COMPOSER_FIELD = '[contenteditable="true"][aria-label="Message input"]';
const SENDING = '[data-testid="send-button"]';

/**
 * A new conversation, under Conversations and under no project.
 *
 * Codex's quick chat is not aimed at a thread. Fr() (native-page 2937) hands the
 * text straight to a create call with `target: { type: "projectless" }` — a brand
 * new conversation belonging to nothing. Antigravity's equivalent is the sidebar's
 * own `<a href="/" data-testid="new-conversation-button" data-shortcut="Ctrl+Shift+O">`,
 * which is projectless for the same reason: it navigates to the root rather than to
 * a project's route, and the project picker under the composer reads "New
 * Conversation" once it has.
 */
const NEW_CHAT = '[data-testid="new-conversation-button"]';

/**
 * The send button while a run is in flight.
 *
 * Antigravity swaps the send button for a cancel button whose tooltip id is
 * this, and swaps it back the moment there is something to send — so a thread
 * that is working while you type at it stops answering here and is reported by
 * its row instead.
 */
const STOPPING = '[data-tooltip-id="input-send-button-cancel-tooltip"]';

/**
 * How often the sidebar is read. Polling, not a MutationObserver: an observer
 * over the whole application fires thousands of times a second while a reply
 * streams in, and all this needs to know is which rows have a spinner. Two
 * seconds is the interval the presence plugin settled on for the same question.
 */
const POLL_INTERVAL_MS = 2000;

/**
 * How long a list the tray is handed.
 *
 * Codex has no cap at all: Ci() (native-page 1391) returns every notification
 * that has not been dismissed, muted or expired, and the stack scrolls through
 * however many that is — only eight cards exist to draw them on. This is a bound
 * on the sidebar read rather than on the tray, because a sidebar with two hundred
 * conversations in it should not turn into two hundred objects every two seconds.
 */
const MAX_ENTRIES = 32;

/** Mi in avatar-overlay-native-frame: which level outranks which. */
const PRIORITY = { waiting: 0, failed: 1, review: 2, running: 3, idle: 4, greeting: 4 };

/** The key the thread on screen gets when the sidebar cannot name it. */
const CURRENT_KEY = "current";

/** `product.nameShort`: the window title when no thread is on screen. */
const HOST_NAME = "Antigravity";

/**
 * Oi() (native-page 1494) and the four constants at 1566: how long a card lives.
 *
 * A failure is stale after an hour, a question after a day, an unread reply after
 * a week, and a thread that is working now never goes stale at all. Codex needs
 * these because its tray outlives the app; this one needs them because a sidebar
 * keeps a fortnight of history in it and an unread dot from Tuesday is not news.
 */
const EXPIRY_MS = {
  failed: 3600 * 1000,
  waiting: 1440 * 60 * 1000,
  review: 10080 * 60 * 1000
};

/**
 * How a row's own timestamp reads, so an entry can be dated.
 *
 * Antigravity compresses a relative time down to a unit letter — "now", "29m",
 * "6h", "1d", "2w", "3mo", "1y" — and shows it on every row that has an
 * updated-at to show. That is where an entry's age comes from, which is what
 * makes the expiries above mean anything on the first poll after a launch.
 */
const STAMP_MS = {
  m: 60 * 1000,
  h: 3600 * 1000,
  d: 86400 * 1000,
  w: 604800 * 1000,
  mo: 30 * 86400 * 1000,
  y: 365 * 86400 * 1000
};

/** An age in milliseconds from a row's stamp, or null if it has none. */
function ageFromStamp(text) {
  if (text === "now") return 0;
  const match = /^(\d+)\s*(mo|m|h|d|w|y)$/.exec(text);
  if (match === null) return null;
  return Number(match[1]) * STAMP_MS[match[2]];
}

/**
 * When a row was last touched, as far as the row itself will say.
 *
 * A stamp is a unit letter and a number, so this is coarse — every thread from the
 * last minute reads "now" — but it is the sidebar's own answer, and the sidebar's
 * order fills in the rest. A row with no stamp at all falls back to the poll's own
 * clock, which is the same thing Kr() does when a conversation has no
 * `turnStartedAtMs` to give.
 */
function datedAt(read, now) {
  return read.age === null ? now : now - read.age;
}

/* ── Settings ──────────────────────────────────────────────────────────────
 *
 * The three width numbers are Codex's, from avatar-overlay-mascot-size. They are
 * written twice — once here for the panel and once inside petSurface for the
 * clamp — because the surface cannot see anything out here.
 */

const MIN_WIDTH = 80;
const MAX_WIDTH = 224;
const DEFAULT_WIDTH = 113;

const settings = plugin.settings.define({
  home: {
    type: "select",
    label: "Where it lives",
    description:
      "On the desktop, in a window of its own, the way Codex does it — so it stays with you when Antigravity is behind something else. Inside the window if your system will not give it one.",
    default: "desktop",
    options: [
      { value: "desktop", label: "On the desktop" },
      { value: "window", label: "Inside Antigravity" }
    ]
  },
  size: {
    type: "number",
    label: "Size",
    description: `How wide the pet is, in pixels. Codex allows ${MIN_WIDTH} to ${MAX_WIDTH}.`,
    default: DEFAULT_WIDTH,
    min: MIN_WIDTH,
    max: MAX_WIDTH
  },
  activity: {
    type: "boolean",
    label: "Show what the agent is doing",
    description:
      "Activity cards and an indicator coloured by the most important notification. The pet keeps animating while an agent works, even with cards hidden.",
    default: true
  },
  bounce: {
    type: "boolean",
    label: "Throw it",
    description:
      "Let a flick carry the pet on and bounce it off the edges. Off is what Codex does day to day — a drop leaves the pet exactly where you let go.",
    default: false
  },
  sheet: {
    type: "string",
    label: "Sprite sheet",
    description:
      "A URL to your own sheet, laid out as 8 columns by 11 rows. Empty uses the bundled pet.",
    default: "",
    placeholder: "https://example.com/pet.webp"
  },
  force: {
    type: "select",
    label: "Force a state",
    description: "Hold one animation, for looking at it. Auto follows the agent.",
    default: "auto",
    options: [
      { value: "auto", label: "Auto" },
      { value: "idle", label: "Idle" },
      { value: "running", label: "Working" },
      { value: "waiting", label: "Needs input" },
      { value: "review", label: "Ready" },
      { value: "failed", label: "Blocked" },
      { value: "waving", label: "Waving" },
      { value: "jumping", label: "Jumping" },
      { value: "running-left", label: "Running left" },
      { value: "running-right", label: "Running right" }
    ]
  },
  status: {
    type: "note",
    label: "Status",
    // Called every time the panel is drawn, so this is the live view: where the
    // pet is, what it is doing, and what it is reporting.
    read: () => describeStatus()
  }
});

/* ── Reading the sidebar ───────────────────────────────────────────────────
 *
 * One row is one thread, and its mark is its level, in the order Antigravity's
 * own component tries them. This is Vr(): waiting outranks failed outranks
 * running outranks review outranks idle, and idle is not news.
 *
 * `failed` is the exception, because no Antigravity row can say it. Its
 * conversation status has no failure in it; a failure is a property of the
 * latest *step*, drawn as a red status dot in the thread itself — wh() in its
 * bundle is `latestStep.status is CANCELED, ERROR or INTERRUPTED, or the step is
 * an errorMessage`. So the thread on screen is asked directly, and "latest" is
 * taken literally: the red dot only counts while it is the last thing in the
 * transcript, so sending again or getting a reply clears it the way a new turn
 * clears it in Codex.
 */

const textOf = (element) => (element?.textContent ?? "").replace(/\s+/g, " ").trim();

/**
 * Which of the row's marks is showing, as one of Codex's five levels.
 *
 * XW() in Antigravity's bundle builds a row's status from four flags, and every
 * one of them turns out to be one of Codex's levels wearing another name:
 *
 *   isPendingUserInteraction  the agent has asked something      → waiting
 *   isBackgroundWorking       run status IDLE, trajectory not    → running
 *                             (bM(): `notFullyIdle`)
 *   isLoading                 the same trajectory flag, or a     → running
 *                             running agent state
 *   isUnread                  last activity is newer than the    → review
 *                             last time you looked at the thread
 *
 * They are tried in that order by ZU(), which is Vr()'s order too, so this is a
 * transcription rather than a decision. Only `isUnread` needs anything said about
 * it, and that is said at LIVE.
 */
function statusOfRow(row) {
  if (row.querySelector(ROW_ATTENTION) !== null) return "waiting";
  if (row.querySelector(ROW_WORKING) !== null) return "running";
  if (row.querySelector(ROW_SPINNER) !== null) return "running";
  if (row.querySelector(ROW_UNREAD) !== null) return "review";
  return "idle";
}

/**
 * Which thread is on screen, or "" when the transcript is not naming one.
 *
 * Antigravity puts the same data-cascade-id on the transcript container as on the
 * row, with the literal "conversation" standing in for none. Reading it here means
 * the reading lands on the right thread whether or not the sidebar has a row for
 * it or agrees about what is selected — this build renders no row at all for the
 * thread in front of you, and marks none of them selected.
 */
function currentId() {
  const raw = document.querySelector(VIEW)?.getAttribute(ROW_ID) ?? "";
  return raw === "conversation" ? "" : raw;
}

/**
 * The thread on screen: which one it is, and the level only it can report.
 *
 * Two levels, because no row can say either: a run in flight while the composer
 * has nothing queued, and a failure as the last thing that happened.
 */
function currentStatus() {
  const view = document.querySelector(VIEW);
  const id = currentId();

  if (view !== null) {
    const marks = view.querySelectorAll(`${VIEW_ERROR}, ${VIEW_REPLY}, ${VIEW_SENT}`);
    const last = marks[marks.length - 1];
    if (last !== undefined && last.matches(VIEW_ERROR)) return { id, status: "failed" };
  }
  return { id, status: document.querySelector(STOPPING) !== null ? "running" : "" };
}

/**
 * The name of the thread on screen, or "" when it has not got one.
 *
 * nYb() in Antigravity's bundle is one line — `document.title = title(activeId) ||
 * product.nameShort` — so the window title is the active conversation's name, and
 * the product name is what stands in for a thread with no name yet.
 *
 * That is true of a window showing a conversation. It is not true of every window:
 * with no conversation open the workbench falls back to its own title template and
 * puts the workspace there instead, which is how a card once ended up named
 * `C:\Users\…\Chats` — a folder, read as a thread. So the row for the thread on
 * screen is asked first, and the window title is only believed when it does not
 * look like a path.
 */
function currentTitle() {
  const id = currentId();
  if (id !== "") {
    const row = document.querySelector(`${ROW}[${ROW_ID}="${CSS.escape(id)}"]`);
    const named = row === null ? "" : titleOfRow(row);
    if (named !== "") return named;
  }

  const title = document.title.trim();
  if (title === "" || title === HOST_NAME) return "";
  return /[\\/]|^[A-Za-z]:$/.test(title) ? "" : title;
}

/**
 * The reasoning summary Antigravity is showing, as the card's second line.
 *
 * Ir() in avatar-overlay-native-frame does the same with Codex's own reasoning
 * summary, which is why the card has room for two lines at all.
 */
function summaryText() {
  const all = document.querySelectorAll(SUMMARY);
  return textOf(all[all.length - 1]).slice(0, 160);
}

/** The row each entry was read from, so a click on its card can open it. */
const found = new Map();

/**
 * A row's title: its overlay anchor's label, or the visible span if it has none.
 *
 * The anchor is preferred because its label is the thread's title and nothing else,
 * where `span.truncate` is shared with the sidebar's headings and its workspace
 * line — so the first span inside a row shaped unexpectedly can be a folder name.
 */
function titleOfRow(row) {
  const label = row.querySelector(ROW_LINK)?.getAttribute("aria-label") ?? "";
  const named = label.replace(/\s+/g, " ").trim();
  return named !== "" ? named : textOf(row.querySelector(ROW_TITLE));
}

/**
 * What each thread was last seen doing.
 *
 * `{ status, updatedAtMs, live }` per conversation id. `updatedAtMs` is the sort
 * key and the clock the expiries run against; `live` is the answer to the
 * question below. It is not pruned against what the sidebar is showing, because
 * the sidebar is virtualised — a thread that scrolls out of the list has not gone
 * quiet, and coming back as an unseen row would cost it everything the pet knows
 * about it. So it is bounded instead.
 */
const seen = new Map();

/** As many threads as a long sidebar could plausibly hold, and no more. */
const SEEN_MAX = 512;

/**
 * Whether a thread has done anything while the pet has been watching.
 *
 * This is the one place the port has to translate rather than copy. Codex fills
 * its tray from live conversation state: a thread it has actually got loaded,
 * with a runtime status and an unread flag that only exists because a turn
 * finished under its nose. Antigravity's sidebar is not that — it is history, a
 * fortnight of it, and its unread dot is stored against `localLastViewedTimes`,
 * so a reply you never went back to read still has its dot a week later.
 *
 * Copying the read literally is what put three permanent cards under the pet:
 * three old threads with old unread dots, forever. So a thread earns its place
 * two ways. Either it is doing something now — working, needs input, blocked,
 * the levels that cannot be stale — or the pet watched its level change, which
 * is the nearest thing a DOM read has to "this happened while I was here". A dot
 * that was already lit when the pet arrived is the baseline and says nothing.
 *
 * That is Codex's own distinction, and it is why its tray holds the threads that
 * were open while it was running and nothing else.
 */
const LIVE = new Set(["running", "waiting", "failed"]);

/**
 * Read current work from Antigravity's live Redux store, including conversations
 * whose rows are virtualised, filtered, or collapsed. React context dependencies
 * expose the same store used by the sidebar's selectors. getState() is deliberate:
 * a fiber's memoized summary can belong to the previous render.
 *
 * Only a bounded ancestor walk is needed. Older hosts without these context
 * fields keep the DOM sensor; no last-known running flag is retained indefinitely.
 */
function backgroundWorking() {
  if (typeof plugin.react?.getFiber !== "function") return false;
  const checked = new Set();
  try {
    for (const selector of [ROW_LIST, VIEW, COMPOSER, ROW]) {
      const anchor = document.querySelector(selector);
      if (anchor === null) continue;
      let fiber = plugin.react.getFiber(anchor);
      for (let depth = 0; fiber && depth < 32; depth += 1, fiber = fiber.return) {
        const contexts = [fiber.memoizedProps?.value];
        let dependency = fiber.dependencies?.firstContext;
        for (let index = 0; dependency && index < 32; index += 1, dependency = dependency.next) {
          contexts.push(dependency.memoizedValue);
        }
        for (const context of contexts) {
          const store = context?.store;
          if (typeof store?.getState !== "function" || checked.has(store)) continue;
          checked.add(store);
          const summaries = store.getState()?.trajectorySummaries?.summaries;
          if (summaries === null || typeof summaries !== "object" || Array.isArray(summaries)) continue;
          return Object.values(summaries).some((summary) => {
            if (summary === null || typeof summary !== "object") return false;
            // CascadeRunStatus: RUNNING=2, CANCELING=3, BUSY=4. notFullyIdle also
            // covers background agents; waitingSteps are a pause for user input.
            const active = summary.notFullyIdle === true || summary.hasActiveChildren === true ||
              summary.status === 2 || summary.status === 3 || summary.status === 4;
            return active && !(Array.isArray(summary.waitingSteps) && summary.waitingSteps.length > 0);
          });
        }
      }
    }
  } catch {
    // Host internals can change independently of this plugin; the DOM still works.
  }
  return false;
}

/**
 * The stamp each dismissed card had, per key.
 *
 * The tray is read off the DOM every two seconds, so without this the next poll
 * would put a dismissed card straight back. Codex dismisses one notification by
 * id and a later event makes a new notification with a new id, so a dismissal
 * only ever covers the thing that was on screen — which here is the stamp, since
 * a stamp only moves when the level changes. Send a working thread's card away
 * and it stays away; when it finishes, that is news again.
 */
const dismissed = new Map();

/** Older than the longest window below, so no dismissal outlives its card. */
const DISMISSED_MS = 10080 * 60 * 1000;

/**
 * Every row, as an id and a level, with the thread on screen consulted.
 *
 * `place` is the row's position in the sidebar, which is worth carrying: the list
 * is ordered by recency, newest at the top — 27m, 1h, 3h, 1d, 2w — so where two
 * threads cannot be told apart by their own timestamps, the sidebar has already
 * said which of them is newer.
 */
function readRows() {
  const current = currentStatus();
  const rows = [];

  let index = 0;
  for (const row of document.querySelectorAll(ROW)) {
    index += 1;

    const id = row.getAttribute(ROW_ID) ?? "";
    const onScreen =
      current.id !== "" ? id === current.id : row.getAttribute("data-selected") === "true";
    let status = statusOfRow(row);

    // The thread on screen only ever speaks for itself, and only when what it has
    // to say outranks what its own row said.
    if (onScreen && current.status !== "" && PRIORITY[current.status] < PRIORITY[status]) {
      status = current.status;
    }

    rows.push({
      row,
      onScreen,
      status,
      place: index,
      key: id.length > 0 ? id : `row:${index}`,
      title: titleOfRow(row) || `Thread ${index}`,
      age: ageFromStamp(textOf(row.querySelector(ROW_STAMP)))
    });
  }

  return { rows, current };
}

function readEntries() {
  const { rows, current } = readRows();
  const now = Date.now();
  const entries = [];
  found.clear();

  for (const read of rows) {
    const before = seen.get(read.key);
    const changed = before !== undefined && before.status !== read.status;
    const live = LIVE.has(read.status) || changed || (before?.live ?? false);

    // Idle is not news, in Codex either — Ei() (native-page 1461) drops it before
    // it can become a card. The row is still written down, because a thread the
    // pet saw go quiet and then light up again lit up under its watch, and that
    // is the whole of what `live` means.
    if (read.status === "idle") {
      seen.set(read.key, {
        status: "idle",
        updatedAtMs: changed ? now : (before?.updatedAtMs ?? now),
        sortAtMs: changed ? now : (before?.sortAtMs ?? datedAt(read, now)),
        live
      });
      continue;
    }

    if (!live) {
      // A dot that was already lit when the pet arrived. Written down as the
      // baseline, so that the moment it changes the thread counts.
      seen.set(read.key, {
        status: read.status,
        updatedAtMs: before?.updatedAtMs ?? now,
        sortAtMs: before?.sortAtMs ?? datedAt(read, now),
        live: false
      });
      continue;
    }

    // Codex stamps a card when its level changes and sorts on that, and runs the
    // expiries against the conversation's own updated-at rather than against when
    // it noticed. A row's timestamp is that same updated-at, so where a level can
    // go stale the row's own time is the one used — which is what makes the
    // expiries mean anything on the first poll after a launch. Where a level
    // cannot go stale, or the row has no time to give, now will do.
    const expiry = EXPIRY_MS[read.status];
    const dated = expiry !== undefined && read.age !== null ? now - read.age : now;
    const updatedAtMs = changed || before === undefined ? dated : before.updatedAtMs;

    /*
     * When the work in this thread started, which is a different question.
     *
     * Kr() (frame 2511) sorts on `sortAtMs`, and that is `turnStartedAtMs ??
     * updatedAt` — when the current turn began, not when the thread was last
     * touched. Ai() (native-page 1522) is then priority first and `sortAtMs`
     * descending, with `latestActivityFirst` set true at the only call site
     * (2138), so the newest-started piece of work is the top card of its level.
     *
     * A level change under the pet's watch *is* a turn starting, so it stamps
     * now. Everything else carries the stamp it already had, and a thread first
     * seen mid-flight takes its row's own time — which is what stops a poll that
     * finds four running threads at once from giving all four the same instant and
     * leaving their order to a UUID comparison, the reason the list used to come
     * out in no order at all.
     */
    const sortAtMs = changed || before === undefined ? datedAt(read, now) : before.sortAtMs;

    seen.set(read.key, { status: read.status, updatedAtMs, sortAtMs, live: true });

    if (expiry !== undefined && now - updatedAtMs >= expiry) continue;

    found.set(read.key, read.row);
    entries.push({
      key: read.key,
      status: read.status,
      title: read.title,
      subtitle: read.status === "running" && read.onScreen ? summaryText() : "",
      place: read.place,
      sortAtMs,
      updatedAtMs
    });
  }

  // The thread in front of you does not always have a row: the sidebar can be
  // collapsed, and when it is open it is virtualised, so a thread can be on screen
  // and scrolled out of its own list at the same time. It goes through the same
  // bookkeeping as a row, under the same id where there is one, so that its card
  // holds its place in the sort and keeps whatever the pet knows about the thread
  // for when a row for it does appear.
  const named = new Set(entries.map((entry) => entry.key));
  const key = current.id !== "" ? current.id : CURRENT_KEY;
  if (current.status !== "" && !named.has(key)) {
    const before = seen.get(key);
    const fresh = before === undefined || before.status !== current.status;
    const updatedAtMs = fresh ? now : before.updatedAtMs;
    const sortAtMs = fresh ? now : before.sortAtMs;
    seen.set(key, { status: current.status, updatedAtMs, sortAtMs, live: true });
    entries.push({
      key,
      status: current.status,
      title: currentTitle() || "This thread",
      subtitle: summaryText(),
      // The thread you are looking at is the one you touched last, so it leads
      // whatever else is at its level and has no row to be placed by.
      place: 0,
      sortAtMs,
      updatedAtMs
    });
  }

  // Nothing here is pruned against what the sidebar is showing — see `seen` —
  // so both maps are trimmed by age instead: the oldest threads first, and any
  // dismissal too old for its card to still exist.
  if (seen.size > SEEN_MAX) {
    const oldest = [...seen.entries()].sort((a, b) => a[1].updatedAtMs - b[1].updatedAtMs);
    for (const [key] of oldest.slice(0, seen.size - SEEN_MAX)) seen.delete(key);
  }
  for (const [key, at] of [...dismissed]) {
    if (now - at >= DISMISSED_MS) dismissed.delete(key);
  }

  return entries;
}

/* ── The greeting ──────────────────────────────────────────────────────────
 *
 * Ti() (native-page 1431), which is a notification and nothing more:
 *
 *   { action: null, body: "I'm here to help keep your ChatGPT sessions moving",
 *     controlTarget: null, expiresAtMs: n + Ii, id: "first-awake",
 *     isLoading: !1, kind: "first-awake", level: "info",
 *     localConversationId: null, notificationPreferenceId: null,
 *     source: "local", title: "Hi, I'm {petName}", turnKey: null,
 *     updatedAtMs: n, waitingRequest: null }
 *
 * ji('first-awake') is 4 — the lowest priority there is, level with idle — so one
 * thread doing anything at all sorts above the greeting and the pet gets on with
 * its job. Which is why this is a card rather than a wave of its own: the wave is
 * what rr() makes of the card being at the front of the list, so it lasts
 * precisely as long as nothing more important has arrived.
 */

const GREETING_KEY = "first-awake";

/** Ii: eight seconds. */
const GREETING_MS = 8 * 1000;

/** Codex's own body copy, for its own product. */
const GREETING_BODY = "I'm here to help keep your Antigravity sessions moving";

/**
 * Which pet has already been greeted.
 *
 * `first-awake-pet-notification-avatar-ids`: ua() (native-page 3731) builds the
 * greeting only for an avatar whose id is not in that list, and Rn() (2314) puts
 * the id in it as the overlay mounts — so the greeting is once per pet for good,
 * not once per launch. The sheet stands in for the avatar id, which means a pet
 * you have just pointed at a new sheet introduces itself and the one you have had
 * for a month does not.
 */
const GREETED_KEY = "greeted";

/** Which sheet is being worn, as the thing that gets remembered. */
const sheetId = () => {
  const custom = typeof settings.sheet === "string" ? settings.sheet.trim() : "";
  return custom.length === 0 ? "rocky" : custom;
};

/**
 * The name it gives, out of the sheet it is wearing.
 *
 * Codex reads `displayName` off the avatar. The bundled sheet's is Rocky; a custom
 * one is named after its file, so pointing the setting at `luna.webp` is all it
 * takes to be introduced to Luna.
 */
function petName() {
  const id = sheetId();
  if (id === "rocky") return "Rocky";

  const file = id.split(/[?#]/, 1)[0].replace(/\.[a-z0-9]+$/i, "");
  const words = file
    .slice(file.lastIndexOf("/") + 1)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase() + word.slice(1));
  return words.length === 0 ? "Rocky" : words.join(" ").slice(0, 32);
}

/** The greeting while it is up, and null before it and after it. */
let greeting = null;

/** ua(): a greeting, or nothing at all. Called once, as the pet appears. */
function wake() {
  const id = sheetId();
  const stored = plugin.storage.get(GREETED_KEY, []);
  const ids = Array.isArray(stored) ? stored : [];
  if (ids.includes(id)) return;

  plugin.storage.set(GREETED_KEY, [...ids, id]);
  const now = Date.now();
  greeting = {
    key: GREETING_KEY,
    status: "greeting",
    title: `Hi, I'm ${petName()}`,
    subtitle: GREETING_BODY,
    place: Number.MAX_SAFE_INTEGER,
    sortAtMs: now,
    updatedAtMs: now,
    expiresAtMs: now + GREETING_MS
  };
}

/**
 * Ai() (native-page 1522), in full and in order.
 *
 *     let r = e.notificationPriority - t.notificationPriority;
 *     if (r !== 0) return r;
 *     if (n) { let n = t.sortAtMs - e.sortAtMs; if (n !== 0) return n; }
 *     if (!n) { let n = t.updatedAtMs - e.updatedAtMs; if (n !== 0) return n; }
 *     return e.key.localeCompare(t.key);
 *
 * `n` is `latestActivityFirst`, and the only call site passes true (2138) — so the
 * live comparator is level, then `sortAtMs` newest first, then the key. `sortAtMs`
 * is when the current turn started (frame 2511), which is what makes the newest
 * piece of work the top card.
 *
 * The one thing added here is the sidebar's own order, ahead of the key. Codex has
 * millisecond timestamps and never needs a tiebreak that means anything;
 * Antigravity's rows are stamped to the nearest minute, hour or day, so three
 * threads touched in the same minute genuinely tie — and `localeCompare` on a UUID
 * would then decide, which is an order with no relation to anything. The sidebar
 * has already sorted them by recency, newest first, so its order is the answer.
 *
 * Level still comes first, exactly as Ai() has it: a thread waiting on you outranks
 * a thread that is merely running, however recently the running one started. That
 * is the whole point of the ladder — the card you have to do something about is the
 * one on top.
 *
 * Codex also expires entries — a failure after an hour, a question after a day, an
 * unread reply after a week — because its tray outlives the app. Those windows are
 * EXPIRY_MS and readEntries enforces them; the greeting is the one card with an
 * expiry of its own, because it is not a thread and none of that bookkeeping has
 * anything to say about it.
 */
function activityOf() {
  const all = readEntries();
  // Read work before hiding, dismissing, or bounding the notification list.
  // Sending a card away acknowledges that notification; it does not stop its agent.
  const working = all.some((entry) => entry.status === "running") || backgroundWorking();
  // Ci() dismisses one notification. A later status change gets a new stamp.
  const entries = all.filter((entry) => {
    const at = dismissed.get(entry.key);
    return at === undefined || entry.updatedAtMs > at;
  });
  const now = Date.now();

  // Ci() (native-page 1391) drops a notification whose expiry has passed, or that
  // has been dismissed. The greeting is the only card here with an expiry of its
  // own, and the only one whose dismissal is for good — there is no row for it to
  // come back on.
  if (greeting !== null && (now >= greeting.expiresAtMs || dismissed.has(GREETING_KEY))) {
    greeting = null;
  }
  if (greeting !== null) entries.push(greeting);

  entries.sort(
    (a, b) =>
      PRIORITY[a.status] - PRIORITY[b.status] ||
      b.sortAtMs - a.sortAtMs ||
      a.place - b.place ||
      a.key.localeCompare(b.key)
  );

  return { entries: settings.activity === false ? [] : entries.slice(0, MAX_ENTRIES), working };
}

/** Enough of the list to tell whether the pet needs to be told about it. */
/**
 * What was sent last, as one string, so an unchanged tray is not resent.
 *
 * Order-sensitive because the front card and badge follow notification priority.
 * Work is included separately: a dismissed agent can finish while the tray stays
 * empty. Timestamps alone do not change anything the surface needs to draw.
 *
 * The title is in here, and it has to be: Antigravity names a conversation from
 * its first exchange, so a thread started at the pill arrives untitled and is
 * renamed a few seconds later. Without the title the card would keep the name it
 * was born with for as long as its level held.
 */
const signatureOf = (entries, working) =>
  JSON.stringify([working, entries.map((entry) => [entry.key, entry.status, entry.title, entry.subtitle])]);

/* ── The two places it can live ────────────────────────────────────────────
 *
 * Both of these call the same petSurface. The desktop one hands it across as
 * source, which plugin.overlay re-evaluates inside a transparent always-on-top
 * window; the window one calls it here and stands in for the channel with a set
 * of listeners. Neither knows anything the other does not.
 */

const PLUGIN_STYLE_ATTRIBUTE = "data-bettergravity-plugin-style";

/**
 * This plugin's own stylesheets, as text.
 *
 * The overlay window is `about:blank` on a different origin, so it can neither
 * resolve `styles/pet.css` nor fetch the sprite out of the plugin folder. It does
 * not have to: the loader folds every local `url()` in a plugin's CSS into a data
 * URI before injecting it, so the text already in this document carries the sheet
 * inside it. Reading it back out and sending it across is the whole trick.
 */
function ownStyles() {
  const id = plugin.manifest.id;
  const sheets = document.querySelectorAll(
    `style[${PLUGIN_STYLE_ATTRIBUTE}="${CSS.escape(id)}"]`
  );
  return [...sheets].map((sheet) => sheet.textContent ?? "").join("\n");
}

/** The pet inside Antigravity's own window. */
function windowSurface(data) {
  const listeners = new Set();

  petSurface(
    {
      send: (message) => fromSurface(message),
      setInteractive: () => undefined,
      setFocusable: () => undefined,
      onMessage: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      }
    },
    { ...data, desktop: false }
  );

  const send = (message) => {
    for (const listener of [...listeners]) listener(message);
  };

  return {
    where: "window",
    send,
    close: () => {
      send({ t: "bye" });
      listeners.clear();
    }
  };
}

/**
 * How long the desktop window has to prove there is a pet standing in it.
 *
 * Generous, because it covers a window opening, a blank document loading, a
 * preload attaching, and a stylesheet the size of a sprite sheet being parsed.
 */
const HELLO_TIMEOUT_MS = 4000;

/** The pet on the desktop, or null when the window could not be opened. */
async function desktopSurface(data) {
  // Nothing in here may throw. `plugin.overlay` is the newest thing in the
  // plugin API, so a BetterGravity that predates it has no `overlay` on the
  // context at all — and a pet in the window is worth much more than an
  // exception that stops the plugin having a pet anywhere.
  let handle;
  try {
    handle = await plugin.overlay.open({
      script: petSurface,
      styles: ownStyles(),
      data: { ...data, desktop: true },
      // The screen the menu bar is on, and its work area rather than its whole
      // area, so the pet's floor is the top of the taskbar.
      display: "primary"
    });
  } catch (error) {
    handle = { ok: false, message: `${error?.message ?? error} — restart Antigravity if BetterGravity was just updated` };
  }

  if (handle?.ok !== true) {
    trouble = handle?.message ?? "refused";
    plugin.log.warn(`no desktop window: ${trouble}`);
    return null;
  }

  // A window that opened is not the same as a pet that appeared: the surface
  // runs over there, out of reach of anything this side can inspect, so its own
  // greeting is what settles it. Everything else the pet says is passed straight
  // on, which is why this is the only listener the window needs.
  let alive = true;
  let off = () => undefined;
  const hello = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), HELLO_TIMEOUT_MS);
    off = handle.onMessage((message) => {
      if (!alive) return;
      if (message?.t === "hello") {
        clearTimeout(timer);
        resolve(message);
        return;
      }
      fromSurface(message);
    });
  });

  if (hello === null) {
    alive = false;
    off();
    trouble = "the desktop window opened but no pet appeared in it";
    plugin.log.warn(`no desktop window: ${trouble}`);
    handle.close();
    return null;
  }

  plugin.log.info(`the desktop window is ${hello.width}x${hello.height}`);

  return {
    where: "desktop",
    send: handle.send,
    close: () => {
      alive = false;
      off();
      handle.close();
    }
  };
}

/* ── Keeping the two halves in step ────────────────────────────────────────*/

/** The live surface, or null while there is none. */
let surface = null;
/** Bumped on every start, so a slow open cannot overwrite a newer one. */
let generation = 0;

/** What was last sent, so nothing is sent twice. */
let activity = [];
let working = false;
let signature = "";

/** Reported back by the pet, for the panel's status row. */
let playing = "idle";
let position = plugin.storage.get("position", null);
/** Whether the pet is out. The toolbar button flips it; it survives a restart. */
let shown = plugin.storage.get("shown", true) !== false;
/** Why there is no pet, when there is no pet. Shown in the panel. */
let trouble = "";

const configOf = () => ({
  size: settings.size,
  force: settings.force,
  sheet: settings.sheet,
  activity: settings.activity !== false,
  bounce: settings.bounce === true
});

/** Brings Antigravity forward. A pet clicked on the desktop is a way back in. */
const raise = () => {
  try {
    window.focus();
  } catch {}
};

/**
 * Codex's mascot opens or focuses the app when it is clicked rather than dragged.
 * Inside one window the nearest thing to that is the composer, which is where a
 * click on the pet was most likely meant to go.
 */
function focusComposer() {
  raise();
  const target = composerField() ?? document.querySelector(COMPOSER);
  if (target instanceof HTMLElement) target.focus();
}

/** Where text typed at the pet has to end up. */
function composerField() {
  const box = document.querySelector(COMPOSER);
  if (box === null) return null;
  // The labelled editable by name first. `agent-input-box` also holds a hidden
  // `<input>` for attachments, and while document order happens to put the
  // editable ahead of it, naming the one that is wanted is not something to
  // leave to document order.
  const field =
    box.querySelector(COMPOSER_FIELD) ??
    box.querySelector('textarea, [contenteditable="true"], input');
  return field instanceof HTMLElement ? field : null;
}

/** Codex opens the thread a notification belongs to. This is that click. */
function openThread(key) {
  if (key === GREETING_KEY) {
    focusComposer();
    return true;
  }
  const id = currentId();
  if (key === CURRENT_KEY || (id !== "" && key === id)) {
    raise();
    return true;
  }

  const known = found.get(key);
  const row = known?.isConnected && (known.getAttribute(ROW_ID) === key || key.startsWith("row:"))
    ? known
    : [...document.querySelectorAll(ROW)].find((item) => item.getAttribute(ROW_ID) === key);
  if (row instanceof HTMLElement) {
    raise();
    /*
     * The anchor, not the row.
     *
     * A sidebar row is a `<div>` with an empty `<a href="/c/{id}" class="absolute
     * inset-0">` laid over the whole of it, and the content beside that anchor is
     * `pointer-events-none` — so the anchor is what every real click lands on. A
     * click on the row `<div>` is not a click on the anchor and does not activate
     * it: nothing navigates, which is why pressing a card used to do nothing at
     * all. Dispatching it at the anchor is the same event the workbench gets from
     * a hand, so its router handles it the same way and the window is not
     * reloaded.
     */
    const link = row.querySelector(ROW_LINK);
    (link instanceof HTMLElement ? link : row).click();
    return true;
  }

  return false;
}

/**
 * The same click, then a wait for it to land.
 *
 * Everything a card's controls do is aimed at one thread, but the composer and its
 * stop button only ever speak for the thread on screen. Wait for its actual id;
 * a fixed number of frames can leave the previous thread's composer in place.
 */
async function selectThread(key) {
  const expected = key === CURRENT_KEY ? currentId() : key;
  if (!openThread(key)) {
    plugin.log.warn("the requested conversation is no longer available");
    return false;
  }
  const deadline = Date.now() + HOST_WAIT_MS;
  while (currentId() !== expected) {
    if (Date.now() >= deadline) {
      plugin.log.warn("the requested conversation did not open");
      return false;
    }
    await tick();
  }
  return true;
}

/**
 * Putting text in the composer as though it were typed.
 *
 * A framework-managed field ignores a plain `field.value = text`, because what it
 * compares against is the value it last wrote to the node. Going through the
 * prototype's own setter and then announcing an `input` is the assignment it
 * notices. A contenteditable one wants `insertText`, which travels the same path a
 * keypress does, so whatever is listening for `beforeinput` still hears it.
 */
function typeInto(field, text) {
  field.focus();
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, "value")?.set;
    if (setter === undefined) return false;
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  window.getSelection()?.selectAllChildren(field);
  return document.execCommand("insertText", false, text);
}

/** Enter, as three events, because a composer may be watching any of them. */
function pressEnter(field) {
  for (const type of ["keydown", "keypress", "keyup"]) {
    field.dispatchEvent(
      new KeyboardEvent(type, {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      })
    );
  }
}

/**
 * A yield that gives the workbench a turn to render in.
 *
 * setTimeout and not requestAnimationFrame: when the pet is on the desktop, Antigravity's
 * own window may be minimised, and a window nobody is painting has no frames at
 * all — a rAF chain there simply stops. A timer is throttled in that state but it
 * is not stopped, and every wait below is bounded by the wall clock rather than by
 * a count of ticks, so fewer ticks costs nothing but precision.
 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 16));

/** Whether a control is refusing to be pressed. */
const refusing = (element) =>
  element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";

/** How long to give the workbench to swap a view in, or to enable a button. */
const HOST_WAIT_MS = 1500;

const projectlessHome = () => {
  const section = new URLSearchParams(location.search).get("section");
  return currentId() === "" && location.pathname === "/" &&
    (section === null || section === "outside-of-project");
};

/**
 * Codex's projectless create, as a click.
 *
 * `target: { type: "projectless" }` (page 1859) is a conversation belonging to no
 * project, and Antigravity's equivalent is the sidebar's own new-conversation
 * control: an `<a href="/">`, so it navigates to the root rather than into a
 * project's route, and what comes out lands under Conversations. Clicking the
 * anchor rather than assigning `location.href` is deliberate — the workbench
 * routes it, and a navigation would reload the window the plugin is running in.
 */
async function newConversation() {
  raise();
  const link = document.querySelector(NEW_CHAT);
  if (!(link instanceof HTMLElement)) {
    plugin.log.warn("no new-conversation control: nowhere to start a chat");
    return false;
  }
  // Gemini App routes ordinary clicks to the selected Chat/Work experience.
  // The pet's unaimed chat must explicitly request Conversations in either mode.
  const activation = new MouseEvent("click", { bubbles: true, cancelable: true });
  Object.defineProperty(activation, "betterGravityProjectless", { value: true });
  link.dispatchEvent(activation);
  const deadline = Date.now() + HOST_WAIT_MS;
  while (!projectlessHome()) {
    if (Date.now() >= deadline) {
      plugin.log.warn("the new conversation did not open");
      return false;
    }
    await tick();
  }
  return true;
}

/** The composer's editable, waited for — a new conversation has to render first. */
async function waitForComposer(stillSelected) {
  const deadline = Date.now() + HOST_WAIT_MS;
  for (;;) {
    if (!stillSelected()) return null;
    const field = composerField();
    if (field !== null) return field;
    if (Date.now() >= deadline) return null;
    await tick();
  }
}

/**
 * Presses the composer's own send button, once it is willing to be pressed.
 *
 * This is the part that was holding back. Antigravity's send button is a real
 * `<button>` carrying a real `disabled` attribute while there is nothing to send,
 * and a click on a disabled button is not a suppressed event — it is no event, so
 * nothing hears it. Whatever manages the composer needs a render to notice the
 * text that was just put in it, which is what the wait is for.
 *
 * A disabled button must not be bypassed with Enter. The fallback only applies
 * when this composer has no send or cancel control at all.
 */
async function sendComposer(field, stillSelected) {
  const deadline = Date.now() + HOST_WAIT_MS;
  for (;;) {
    if (!stillSelected() || !field.isConnected || composerField() !== field) {
      plugin.log.warn("the conversation changed before the question could be sent");
      return false;
    }
    const button = document.querySelector(SENDING);
    if (button instanceof HTMLElement && !refusing(button)) {
      button.click();
      return true;
    }
    if (Date.now() >= deadline) break;
    await tick();
  }
  if (document.querySelector(SENDING) === null && document.querySelector(STOPPING) === null) {
    plugin.log.warn("the send button never came up; pressing Enter instead");
    pressEnter(field);
  } else {
    plugin.log.warn("the send control is not ready; the question is still in the composer");
  }
  return false;
}

/**
 * The chat pill: a question asked at the pet.
 *
 * Two paths, and they are Codex's two. Aimed at a card — its reply control — the
 * question is a follow-up in that thread, so the thread is selected first and the
 * composer already on screen is the one it goes to. Unaimed, it is a new
 * conversation: Fr() (page 2937) takes text and nothing else and hands it to a
 * create call targeting nothing, so there is no thread to select and asking the
 * front of the list would be inventing one.
 */
async function askThread(key, text) {
  const followUp = typeof key === "string" && key.length > 0;
  const selected = followUp ? await selectThread(key) : await newConversation();
  if (!selected) return;
  const expected = followUp && key !== CURRENT_KEY ? key : currentId();
  const stillSelected = () => currentId() === expected && (followUp || projectlessHome());

  const field = await waitForComposer(stillSelected);
  if (field === null) {
    plugin.log.warn("nowhere to put the question: no composer");
    return;
  }
  if (!typeInto(field, text)) {
    plugin.log.warn("the composer would not take the question");
    return;
  }
  await sendComposer(field, stillSelected);
}

/** The stop control. The composer's cancel button is the only thing that can. */
async function stopThread(key) {
  const expected = key === CURRENT_KEY ? currentId() : key;
  if (!(await selectThread(key)) || currentId() !== expected) return;
  const button = document.querySelector(STOPPING);
  if (button instanceof HTMLElement) button.click();
}


/**
 * The close and tick controls. Told to the pet at once rather than left to the
 * poll, because the card is already gone as far as the person who pressed it is
 * concerned, and two seconds of it sitting there would read as a dead button.
 */
function dismiss(key) {
  const entry = activity.find((item) => item.key === key);
  if (entry === undefined) return;
  dismissed.set(key, entry.updatedAtMs);
  activity = activity.filter((item) => item.key !== key);
  signature = signatureOf(activity, working);
  surface?.send({ t: "activity", entries: activity, working });
}

/** Everything the pet sends back. */
function fromSurface(message) {
  if (message === null || typeof message !== "object") return;

  switch (message.t) {
    case "at": {
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) break;
      position = { x: message.x, y: message.y };
      plugin.storage.set("position", position);
      break;
    }
    case "playing": {
      if (typeof message.state === "string") playing = message.state;
      break;
    }
    case "poke": {
      focusComposer();
      break;
    }
    case "open": {
      if (typeof message.key === "string") openThread(message.key);
      break;
    }
    case "stop": {
      if (typeof message.key === "string") void stopThread(message.key);
      break;
    }
    case "dismiss": {
      if (typeof message.key === "string") dismiss(message.key);
      break;
    }
    case "ask": {
      if (typeof message.text === "string" && message.text.length > 0) {
        void askThread(message.key, message.text);
      }
      break;
    }
  }
}

/** The stylesheets are injected as the plugin starts, which may be before the
 *  document is parsed. The desktop half is handed their text, so it waits. */
const whenReady = () =>
  document.readyState === "loading"
    ? new Promise((resolve) =>
        document.addEventListener("DOMContentLoaded", () => resolve(), { once: true })
      )
    : Promise.resolve();

function stop() {
  const live = surface;
  surface = null;
  if (live !== null) live.close();
}

async function start() {
  const mine = ++generation;
  stop();
  if (!shown) return;
  trouble = "";
  await whenReady();
  if (mine !== generation) return;

  // The greeting is a notification, so it only exists where notifications do —
  // and the flag is only burned when one was really made, which means turning the
  // cards on later still gets you an introduction.
  if (settings.activity !== false) wake();

  const snapshot = activityOf();
  activity = snapshot.entries;
  working = snapshot.working;
  signature = signatureOf(activity, working);

  const data = { config: configOf(), entries: activity, working, at: position };

  const next =
    settings.home === "window"
      ? windowSurface(data)
      : ((await desktopSurface(data)) ?? windowSurface(data));

  // A newer start began while the window was opening; that one owns the pet.
  if (mine !== generation) {
    next.close();
    return;
  }

  surface = next;
  plugin.log.info(`ready: ${next.where}, ${settings.size} px, ${activity.length} in the tray`);

  // Ci() hands back `nextNotificationExpiresAtMs`, the earliest expiry in the
  // list (native-page 1421), and the page sets a `Math.max(0, that - now)` timer
  // on it (3351) rather than waiting for something else to happen. The greeting is
  // the only entry here with an expiry, so this is that timer: without it the pet
  // would keep waving for as much as two seconds past its welcome.
  if (greeting !== null) {
    const timer = setTimeout(poll, Math.max(0, greeting.expiresAtMs - Date.now()) + 1);
    plugin.onDispose(() => clearTimeout(timer));
  }
}

/**
 * `start()` is asynchronous and nothing waits for it, so this is where its
 * failures are caught. A plugin that starts and then quietly does nothing is the
 * worst way to fail: the panel and the log both need to be able to say why.
 */
function begin() {
  void start().catch((error) => {
    trouble = error?.message ?? String(error);
    plugin.log.error(`could not start: ${trouble}`);
  });
}

function poll() {
  if (surface === null) return;
  const next = activityOf();
  const nextSignature = signatureOf(next.entries, next.working);
  if (nextSignature === signature) return;

  activity = next.entries;
  working = next.working;
  signature = nextSignature;
  surface.send({ t: "activity", entries: activity, working });
}

/* ── The toggle ────────────────────────────────────────────────────────────
 *
 * Sending the pet away and calling it back is a one-click thing, so it is a
 * button in the title bar rather than another row in the panel. It is not the
 * same as switching the plugin off: the plugin keeps reading the sidebar and
 * keeps the button, so there is something left to click to get the pet back.
 *
 * A paw, drawn on Antigravity's own 0 -960 960 960 icon box: four toes of
 * radius 100 above a 520 x 380 pad. Material Symbols has no paw in the set the
 * host bundles, and this is the same box and the same solid fill, so it sits
 * beside the host's icons without looking imported.
 */
const TOE = "q-42 0-71-29t-29-71q0-42 29-71t71-29q42 0 71 29t29 71q0 42-29 71t-71 29Z";
const PAW = `M180-475${TOE}M360-635${TOE}M600-635${TOE}M780-475${TOE}M220-250a260 190 0 1 0 520 0a260 190 0 1 0-520 0Z`;

/** How long the title bar has to appear before the sidebar gets the button. */
const ANCHOR_GRACE_MS = 4000;

/** The toggle, wherever it ended up. */
let toggle = null;

function setShown(next) {
  if (next === shown) return;
  shown = next;
  plugin.storage.set("shown", shown);
  toggle?.setActive(shown);
  if (shown) begin();
  else stop();
}

function placeToggle(area) {
  try {
    toggle = plugin.ui.button({
      area,
      label: "Pet",
      icon: PAW,
      tooltip: "Show or hide the pet",
      onClick: () => setShown(!shown)
    });
    toggle.setActive(shown);
    plugin.onDispose(() => toggle?.remove());
  } catch (error) {
    toggle = null;
    plugin.log.warn(`no toggle button: ${error?.message ?? error}`);
  }
}

placeToggle("titleBar");

// The title bar is where this belongs, but the anchor it hangs off is the host's
// and the host is free to move it. A button that never landed anywhere is worse
// than one in the second-best place, so if nothing has appeared by now the
// sidebar gets it instead. `element` is undefined until it is placed.
if (toggle !== null) {
  const grace = setTimeout(() => {
    if (toggle === null || toggle.element !== undefined) return;
    toggle.remove();
    placeToggle("sidebar");
    plugin.log.info("the toggle went to the sidebar; there was no title bar to put it in");
  }, ANCHOR_GRACE_MS);
  plugin.onDispose(() => clearTimeout(grace));
}

const poller = setInterval(poll, POLL_INTERVAL_MS);
plugin.onDispose(() => clearInterval(poller));
plugin.onDispose(stop);

plugin.onDispose(
  plugin.settings.onChange((key) => {
    // Moving house means a new surface; everything else the live one can be told.
    if (key === "home") {
      begin();
      return;
    }

    // Forget what was last sent, so turning the tray back on refills it.
    signature = "";
    surface?.send({ t: "config", config: configOf() });
    poll();
  })
);

begin();

/* ── The status row ────────────────────────────────────────────────────────*/

const DOING = {
  idle: "resting",
  running: "working",
  waiting: "waiting for you",
  review: "ready for you",
  failed: "blocked",
  waving: "waving",
  jumping: "jumping",
  "running-left": "running",
  "running-right": "running"
};

const LABELS = {
  running: "working",
  waiting: "needs input",
  failed: "blocked",
  review: "ready",
  idle: "idle"
};

/** The whole state of the pet as one line, for the note row in the panel. */
function describeStatus() {
  if (!shown) return "Put away. The paw in the title bar brings it back.";
  if (surface === null) return trouble === "" ? "Waking up." : `No pet: ${trouble}`;

  const where =
    surface.where === "desktop"
      ? "On the desktop"
      : settings.home === "desktop"
        ? `In this window, because the desktop did not work out: ${trouble || "no reason given"}`
        : "In this window";

  const spot = position === null ? "" : ` at ${Math.round(position.x)}, ${Math.round(position.y)}`;
  const held = settings.force === "auto" ? "" : ", held by this panel";

  // The greeting is a card, but it is not a thread, so it is not counted as one.
  const threads = activity.filter((entry) => entry.status !== "greeting");
  const reporting =
    settings.activity === false
      ? "cards hidden"
      : threads.length === 0
        ? activity.length === 0
          ? "nothing to report"
          : "saying hello"
        : `${threads.length} ${threads.length === 1 ? "thread" : "threads"}, ${
            LABELS[threads[0].status] ?? threads[0].status
          } first`;

  return `${where}${spot} — ${DOING[playing] ?? playing}${held}, ${reporting}.`;
}
