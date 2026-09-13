const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const [root, directory] = process.argv.slice(2);
app.setPath("userData", path.join(directory, "profile"));
app.disableHardwareAcceleration();

const plugin = path.join(root, "community/plugins/pets");
const source = fs.readFileSync(path.join(plugin, "index.js"), "utf8");
const surface = source.slice(0, source.indexOf("/* ═══ PART TWO"));
const rocky = fs.readFileSync(path.join(plugin, "assets/rocky.webp"));

// A valid ignored RIFF chunk makes the bundled artwork as large as generated
// pets, without committing personal artwork or a multi-megabyte test fixture.
const padding = Buffer.alloc(8 + 2 * 1024 * 1024);
padding.write("JUNK");
padding.writeUInt32LE(padding.length - 8, 4);
const large = Buffer.concat([rocky, padding]);
large.writeUInt32LE(large.length - 8, 4);
const dataUrl = (bytes) => `data:image/webp;base64,${bytes.toString("base64")}`;
const rockyUrl = dataUrl(rocky);
const largeUrl = dataUrl(large);
const css = ["pet.css", "hud.css", "library.css"].map((name) =>
  fs.readFileSync(path.join(plugin, "styles", name), "utf8")
).join("\n").replaceAll("../assets/rocky.webp", rockyUrl);

const replyEntries = [
  { key: "reply-task", status: "running", title: "Verify the Pets reply editor", subtitle: "Checking animations and keyboard input" },
  { key: "other-task", status: "running", title: "Build the workspace", subtitle: "Running tests" },
  { key: "third-task", status: "waiting", title: "Review changes", subtitle: "Needs input" }
];

async function measureBadgePresentation(entries) {
  const pet = document.querySelector('.bettergravity-pet');
  const badge = pet.querySelector('button.bettergravity-pet__badge');
  const read = () => {
    const bounds = badge.getBoundingClientRect(), origin = pet.getBoundingClientRect();
    const count = badge.querySelector('.bettergravity-pet__badge-count');
    const css = getComputedStyle(badge), textCss = getComputedStyle(count);
    return {
      x: bounds.x - origin.x, y: bounds.y - origin.y,
      width: bounds.width, height: bounds.height, radius: css.borderRadius,
      count: count.textContent, countDisplay: textCss.display, countOpacity: textCss.opacity,
      fontSize: css.fontSize, kind: pet.dataset.petBadgeKind, label: badge.getAttribute('aria-label'),
      interactive: !badge.disabled && css.pointerEvents === 'auto',
      accessible: badge.closest('[aria-hidden="true"]') === null
    };
  };
  receivePetMessage({ t: 'activity', entries: [] });
  receivePetMessage({ t: 'activity', entries });
  const animation = badge.getAnimations()[0];
  const frames = animation?.effect.getKeyframes() ?? [];
  await animation?.finished;
  const idle = read();
  const rect = pet.getBoundingClientRect();
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 350));
  const hovered = read();
  badge.click();
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0, bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 400));
  const hiddenActivity = read();
  receivePetMessage({ t: 'activity', entries: [
    ...entries, ...Array.from({ length: 9 }, (_, index) => ({ key: 'extra-' + index, title: 'Extra fixture task', status: 'running', subtitle: '' }))
  ] });
  const doubleDigit = read();
  return { idle, hovered, hiddenActivity, doubleDigit, frames };
}

async function measureColumn(x, asymmetric = false) {
  if (asymmetric) {
    const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 2288;
    const context = canvas.getContext('2d'); context.fillStyle = '#55bbff';
    for (let row = 0; row < 11; row++) for (let column = 0; column < 8; column++) {
      context.fillRect(column * 192 + 124, row * 208 + 24, 40, 156);
    }
    receivePetMessage({ t: 'config', config: { sheet: canvas.toDataURL('image/png') } });
  }
  receivePetMessage({ t: 'at', x, y: 100 });
  // Wait for the move/show transitions before choosing a hover coordinate.
  // A coordinate sampled mid-transition can already be outside the moving card.
  await new Promise(resolve => requestAnimationFrame(resolve));
  await Promise.all(document.getAnimations()
    .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map(animation => animation.finished.catch(() => {})));
  const pet = document.querySelector('.bettergravity-pet');
  const card = document.querySelector('[data-pet-key="reply-task"]');
  const center = element => { const box = element.getBoundingClientRect(); return { x:box.x + box.width/2, left:box.left, right:box.right }; };
  const cardRect = card.getBoundingClientRect();
  const point = { x:cardRect.x + 40, y:cardRect.y + 20 };
  const hit = document.elementFromPoint(point.x, point.y)?.closest('[data-pet-hit]')?.dataset.petHit;
  document.dispatchEvent(new MouseEvent('mousemove', { clientX:point.x, clientY:point.y, bubbles:true }));
  await new Promise(resolve => setTimeout(resolve, 400));
  const before = center(card).x;
  const result = {
    pet:center(pet), card:center(card), chat:center(document.querySelector('.bettergravity-pet-chat')),
    chatOpen:document.querySelector('.bettergravity-pet-chat').dataset.petChat === 'open', viewport:innerWidth,
    point, hit, trayState:document.querySelector('.bettergravity-pet-tray').dataset.petTray
  };
  document.dispatchEvent(new MouseEvent('mousemove', { clientX:0, clientY:0, bubbles:true }));
  await new Promise(resolve => setTimeout(resolve, 350));
  result.afterClose = center(card).x;
  result.petAfterClose = center(pet);
  result.beforeClose = before;
  if (asymmetric) {
    receivePetMessage({ t: 'config', config: { sheet:'' } });
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return result;
}

// Runs in Chromium so field-sizing, ResizeObserver, transitions, and the
// transparent-window CSS reset are exercised rather than simulated by jsdom.
async function measureActivityLayout() {
  const entries = [
    { key: 'short', title: 'Short', status: 'running', subtitle: '' },
    { key: 'small', title: 'Small', status: 'running', subtitle: '' },
    { key: 'wide', title: 'A considerably wider background task', status: 'running', subtitle: '' }
  ];
  receivePetMessage({ t: 'activity', entries });
  const badge = document.querySelector('.bettergravity-pet__badge');
  if (badge.getAttribute('aria-label').startsWith('Show')) badge.click();
  if (document.querySelector('.bettergravity-pet-tray').dataset.petStack === 'collapsed') {
    document.querySelector('.bettergravity-pet-card[data-pet-key]').click();
  }
  receivePetMessage({ t: 'at', x: 280, y: 80 });
  const settle = () => Promise.all(document.getAnimations()
    .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map(animation => animation.finished.catch(() => {})));
  await settle();
  const widths = () => [...document.querySelectorAll('.bettergravity-pet-card[data-pet-key]')].map(card => card.getBoundingClientRect().width);
  const longestLast = widths();
  receivePetMessage({ t: 'activity', entries: [entries[2], entries[0], entries[1]] });
  const longestFirst = widths();
  receivePetMessage({ t: 'activity', entries: [entries[0], entries[1], { ...entries[2], subtitle: 'A long progress update should size all of these cards even though this is the last task' }] });
  const updatedLast = widths();
  const card = document.querySelector('[data-pet-key="short"]').getBoundingClientRect();
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: card.x + 40, clientY: card.y + 20, bubbles: true }));
  await settle();
  const pet = document.querySelector('.bettergravity-pet');
  const tray = document.querySelector('.bettergravity-pet-tray');
  const chat = document.querySelector('.bettergravity-pet-chat');
  const rects = () => [pet, tray, chat].map(node => node.getBoundingClientRect().toJSON());
  const initial = rects();
  const point = { x: initial[0].x + 20, y: initial[0].y + 30 };
  const pointer = (type, x, y, buttons = 1) => pet.dispatchEvent(new PointerEvent(type, {
    pointerId: 73, isPrimary: true, button: 0, buttons, clientX: x, clientY: y, bubbles: true, cancelable: true
  }));
  pointer('pointerdown', point.x, point.y);
  const frames = [];
  for (let index = 1; index <= 8; index++) {
    pointer('pointermove', point.x + index * 18, point.y + index * 5);
    await new Promise(resolve => requestAnimationFrame(resolve));
    frames.push(rects());
  }
  pointer('pointerup', point.x + 8 * 18, point.y + 8 * 5, 0);
  receivePetMessage({ t: 'activity', entries: [{ key: 'font-fit', title: 'Pixel Art Pet Creation', status: 'review', subtitle: '' }] });
  const text = document.querySelector('[data-pet-key="font-fit"] .bettergravity-pet-card__text');
  const range = document.createRange(); range.selectNodeContents(text);
  const fit = { naturalWidth: range.getBoundingClientRect().width, availableWidth: text.clientWidth, cardWidth: tray.getBoundingClientRect().width };
  return { longestLast, longestFirst, updatedLast, initial, frames, fit, chatOpen: chat.dataset.petChat === 'open', spring: getComputedStyle(tray).getPropertyValue('--pet-spring-stack') };
}

async function showCloseMenu(desktop) {
  const pet = document.querySelector('.bettergravity-pet');
  const before = pet.getBoundingClientRect().toJSON();
  const count = window.petEvents.length;
  pet.dispatchEvent(new MouseEvent('contextmenu', { button: 2, clientX: innerWidth - 10, clientY: innerHeight - 10, bubbles: true, cancelable: true }));
  const request = window.petEvents.slice(count).find(message => message.type === 'bettergravity:overlay-context-menu');
  if (desktop) receivePetMessage({ type: 'bettergravity:overlay-context-menu-result', requestId: request.requestId, unsupported: true });
  await new Promise(resolve => setTimeout(resolve, 100));
  const menu = document.querySelector('.bettergravity-pet-menu');
  const bounds = menu.getBoundingClientRect(), style = getComputedStyle(menu);
  if (bounds.width < 200 || bounds.height < 32 || style.visibility !== 'visible' || Number(style.opacity) === 0) throw new Error('The pet menu must be painted and usable');
  return { nativeRequested: !!request, label: menu.textContent, role: menu.getAttribute('role'),
    visible: getComputedStyle(menu).display !== 'none', focused: menu.contains(document.activeElement),
    insideViewport: menu.getBoundingClientRect().right <= innerWidth && menu.getBoundingClientRect().bottom <= innerHeight,
    petUnmoved: JSON.stringify(before) === JSON.stringify(pet.getBoundingClientRect().toJSON()) };
}

async function measureInlineReply() {
  const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const settle = async () => {
    const start = performance.now();
    while (performance.now() - start < 550) await frame();
  };
  const card = document.querySelector('[data-pet-key="reply-task"]');
  if (document.querySelector('.bettergravity-pet-tray').dataset.petStack === 'collapsed') card.click();
  const rect = card.getBoundingClientRect();
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: rect.x + 30, clientY: rect.y + 20, bubbles: true }));
  await settle();
  const quick = document.querySelector(".bettergravity-pet-chat__input");
  quick.value = "A separate new chat draft";
  const field = card.querySelector("textarea");
  const box = card.querySelector(".bettergravity-pet-card__reply");
  const header = card.querySelector(".bettergravity-pet-card__header");
  const controls = card.querySelector(".bettergravity-pet-card__controls");
  const next = document.querySelector('[data-pet-key="other-task"]');
  const tray = document.querySelector(".bettergravity-pet-tray");
  const read = () => {
    const cardRect = card.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const controlRect = controls.getBoundingClientRect();
    const trayRect = tray.getBoundingClientRect();
    return {
      height: cardRect.height,
      gap: next.getBoundingClientRect().top - cardRect.bottom,
      controlsY: controlRect.top + controlRect.height / 2 - headerRect.top,
      headerHeight: headerRect.height,
      replyHeight: box.getBoundingClientRect().height,
      opacity: Number(getComputedStyle(box).opacity),
      trayTop: trayRect.top,
      trayBottom: trayRect.bottom,
      cardTop: cardRect.top,
      fieldBottom: field.getBoundingClientRect().bottom
    };
  };
  const before = read();
  card.querySelector('[data-pet-control="reply"]').click();
  const frames = [];
  const start = performance.now();
  while (performance.now() - start < 320) {
    await frame();
    frames.push(read());
  }
  const opened = read();
  const focused = document.activeElement === field;
  const style = getComputedStyle(field);
  const formStyle = getComputedStyle(field.form);
  field.value = "Please check the keyboard shortcuts too.\nKeep the reply inside this task.";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  const typed = read();
  window.readPetReplyGeometry = read;
  return {
    before, opened, frames, typed, focused,
    quickDraft: quick.value,
    fontSize: style.fontSize,
    outline: style.outlineStyle,
    shadow: style.boxShadow,
    radius: formStyle.borderRadius,
    inputMargin: field.form.getBoundingClientRect().left - card.getBoundingClientRect().left,
    sendButtons: field.form.querySelectorAll("button").length,
    navigated: window.petEvents.some(message => message.t === "open" || message.t === "ask"),
    nativeFocus: window.petFocusRequests.includes(true)
  };
}

app.whenReady().then(async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end("<!doctype html><html><body></body></html>");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const window = new BrowserWindow({
    width: 800, height: 600, show: false,
    webPreferences: { backgroundThrottling: false, offscreen: true }
  });
  let renderedSheets = 0;
  let inlineReplies = 0;
  let badgePresentations = 0;
  let centeredColumns = 0;
  let opticalCenters = 0;
  let synchronizedDragFrames = 0;
  let sharedWidths = 0;
  let closeMenus = 0;
  const evaluate = (expression) => window.webContents.executeJavaScript(expression, true);
  const checkSheet = async (expectedUrl, expectedPet) => {
    const result = await evaluate(`(async () => {
      const pet = document.querySelector('.bettergravity-pet');
      const sprite = pet.querySelector('.bettergravity-pet__body');
      const background = getComputedStyle(sprite).backgroundImage;
      if (background === 'none') throw new Error('Pet has no rendered background image');
      const url = JSON.parse(background.slice(4, -1));
      const image = new Image();
      image.src = url;
      await image.decode();
      const expected = new Uint8Array(await (await fetch(${JSON.stringify(expectedUrl)})).arrayBuffer());
      const actual = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 208;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, 192, 208, 0, 0, 192, 208);
      const pixels = context.getImageData(0, 0, 192, 208).data;
      let visiblePixels = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) visiblePixels++;
      return {
        correctSheet: actual.length === expected.length && actual.every((byte, index) => byte === expected[index]),
        inlineImageLength: sprite.style.backgroundImage.length,
        pet: pet.dataset.pet,
        width: image.naturalWidth,
        height: image.naturalHeight,
        visiblePixels
      };
    })()`);
    assert.equal(result.correctSheet, true, "The selected sheet must reach the sprite");
    if (expectedPet === "custom") assert.ok(result.inlineImageLength < 128, "Generated image bytes must stay out of the animated style attribute");
    assert.equal(result.pet, expectedPet);
    assert.equal(result.width, 1536);
    assert.equal(result.height, 2288);
    assert.ok(result.visiblePixels > 100, "The rendered sheet must decode into visible artwork");
    renderedSheets++;
  };
  const selectSheet = (sheet) => evaluate(`receivePetMessage({ t: 'config', config: { sheet: ${JSON.stringify(sheet)} } })`);

  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}/c/previous`);
    await window.webContents.insertCSS(css);
    for (const desktop of [false, true]) {
      await evaluate(`${surface}\npetSurface({
        send() {}, setInteractive() {}, setFocusable() {},
        onMessage(listener) { window.receivePetMessage = listener; return () => {}; }
      }, ${JSON.stringify({ desktop, at: { x: 200, y: 200 }, config: { sheet: largeUrl } })});`);
      await checkSheet(largeUrl, "custom");
      await selectSheet("");
      await checkSheet(rockyUrl, "rocky");
      await selectSheet(rockyUrl);
      await checkSheet(rockyUrl, "custom");
      await selectSheet("file:///unsupported.webp");
      await checkSheet(rockyUrl, "rocky");
      await selectSheet(largeUrl);
      await checkSheet(largeUrl, "custom");
      await evaluate("receivePetMessage({ t: 'bye' })");

      await evaluate(`${surface}\nwindow.petEvents = []; window.petFocusRequests = [];
        document.body.style.cssText = 'margin:0;background:#30333a';
        petSurface({
          send(message) { window.petEvents.push(message); }, setInteractive() {},
          setFocusable(value) { window.petFocusRequests.push(value); },
          onMessage(listener) { window.receivePetMessage = listener; return () => {}; }
        }, ${JSON.stringify({ desktop, at: { x: 340, y: 140 }, entries: replyEntries })});`);
      const badge = await evaluate(`(${measureBadgePresentation.toString()})(${JSON.stringify(replyEntries)})`);
      for (const reading of [badge.idle, badge.hovered, badge.hiddenActivity, badge.doubleDigit]) {
        assert.equal(reading.x, 88, 'The 24px badge must align with the 112px mascot\'s right edge');
        assert.equal(reading.y, 0, 'The badge belongs at the mascot\'s top edge');
        assert.equal(reading.width, 24);
        assert.equal(reading.height, 24);
        assert.equal(reading.radius, '12px');
        assert.equal(reading.fontSize, '12px');
        assert.equal(reading.interactive, true);
        assert.equal(reading.accessible, true);
      }
      assert.equal(badge.hiddenActivity.count, '3');
      assert.equal(badge.hiddenActivity.countDisplay, 'flex');
      assert.equal(badge.hiddenActivity.countOpacity, '1');
      assert.equal(badge.doubleDigit.count, '12');
      assert.equal(badge.doubleDigit.label, 'Show activity, 12 items');
      assert.ok(badge.frames.length > 2, 'The badge must use the entrance spring');
      assert.equal(Number(badge.frames[0].opacity), 0);
      assert.equal(Number(badge.frames.at(-1).opacity), 1);
      assert.ok(badge.frames.some(frame => Number(frame.opacity) > 1), 'The source spring overshoots its settled position');
      fs.writeFileSync(path.join(directory, `badge-${desktop ? 'desktop' : 'window'}.png`), (await window.webContents.capturePage()).toPNG());
      await evaluate(`document.querySelector('.bettergravity-pet__badge').click(); receivePetMessage({ t: 'activity', entries: ${JSON.stringify(replyEntries)} })`);
      badgePresentations++;
      const originalSize = window.getContentSize();
      for (const viewport of [280, 360, 900]) {
        window.setContentSize(viewport, 640);
        for (const edge of [0, 10_000]) {
          const column = await evaluate(`(${measureColumn.toString()})(${edge})`);
          assert.equal(column.chatOpen, true, `Hovering a card must open quick chat (desktop=${desktop}, edge=${edge}): ${JSON.stringify(column)}`);
          assert.ok(Math.abs(edge === 0 ? column.pet.left : column.pet.right - column.viewport) < 0.6, 'The pet must reach the screen edge independently of its cards');
          assert.ok(Math.abs((edge === 0 ? column.card.left : column.viewport - column.card.right) - 8) < 0.6, 'Cards must reach their own screen edge');
          assert.ok(Math.abs((edge === 0 ? column.chat.left : column.viewport - column.chat.right) - 6) < 0.6, 'The wider prompt must clamp independently');
          assert.ok(column.card.left >= 5.5 && column.card.right <= column.viewport - 5.5);
          assert.ok(column.chat.left >= 5.5 && column.chat.right <= column.viewport - 5.5);
          assert.equal(column.beforeClose, column.afterClose, 'Closing the prompt must not shift the column');
          assert.deepEqual(column.petAfterClose, column.pet, 'Opening or closing the prompt must not move the pet');
          if (viewport === 900) fs.writeFileSync(path.join(directory, `edge-${desktop ? 'desktop' : 'window'}-${edge === 0 ? 'left' : 'right'}.png`), (await window.webContents.capturePage()).toPNG());
          centeredColumns++;
        }
      }
      window.setContentSize(900, 640);
      const optical = await evaluate(`(${measureColumn.toString()})(340, true)`);
      assert.ok(Math.abs(optical.card.x - (optical.pet.x + 28)) < 0.6, 'Cards must center on the visible artwork despite transparent padding');
      assert.ok(Math.abs(optical.card.x - optical.chat.x) < 0.6);
      assert.equal(optical.beforeClose, optical.afterClose);
      opticalCenters++;
      fs.writeFileSync(path.join(directory, `centered-${desktop ? 'desktop' : 'window'}.png`), (await window.webContents.capturePage()).toPNG());
      const layout = await evaluate(`(${measureActivityLayout.toString()})()`);
      for (const widths of [layout.longestLast, layout.longestFirst, layout.updatedLast]) {
        assert.equal(widths.length, 3);
        assert.ok(widths.every(width => Math.abs(width - widths[0]) < 0.1), `Every task must share the widest card: ${JSON.stringify(widths)}`);
      }
      assert.deepEqual(layout.longestFirst, layout.longestLast, 'List order must not determine shared width');
      assert.equal(layout.updatedLast[0], 315, 'A longer last card must grow the whole list to the Codex cap');
      assert.ok(layout.fit.cardWidth < 315 && layout.fit.naturalWidth <= layout.fit.availableWidth, `A title below the width cap must fit in the font actually rendered: ${JSON.stringify(layout.fit)}`);
      assert.equal(layout.chatOpen, true);
      assert.match(layout.spring, /800ms linear\(/);
      for (let index = 0; index < layout.frames.length; index++) {
        for (let member = 0; member < 3; member++) {
          const frame = layout.frames[index][member], initial = layout.initial[member];
          assert.ok(Math.abs(frame.x - initial.x - (index + 1) * 18) < 0.6, `Member ${member} must follow horizontal dragging immediately: ${JSON.stringify({ frame, initial, index })}`);
          assert.ok(Math.abs(frame.y - initial.y - (index + 1) * 5) < 0.6, `Member ${member} must follow vertical dragging immediately`);
        }
        synchronizedDragFrames++;
      }
      sharedWidths++;
      fs.writeFileSync(path.join(directory, `activity-${desktop ? 'desktop' : 'window'}.png`), (await window.webContents.capturePage()).toPNG());
      const menu = await evaluate(`(${showCloseMenu.toString()})(${desktop})`);
      assert.deepEqual(menu, { nativeRequested: desktop, label: 'Close pet', role: 'menu', visible: true, focused: true, insideViewport: true, petUnmoved: true });
      fs.writeFileSync(path.join(directory, `menu-${desktop ? 'desktop' : 'window'}.png`), (await window.webContents.capturePage()).toPNG());
      await evaluate(`document.querySelector('.bettergravity-pet-menu__item').click(); receivePetMessage({ t: 'activity', entries: ${JSON.stringify(replyEntries)} });`);
      assert.ok(await evaluate(`window.petEvents.some(message => message.t === 'hide')`));
      closeMenus++;
      window.setContentSize(...originalSize);
      await evaluate(`receivePetMessage({ t:'at', x:340, y:140 })`);
      const reply = await evaluate(`(${measureInlineReply.toString()})()`);
      assert.equal(reply.focused, true, "Reply must focus the editor inside the task card");
      assert.equal(reply.navigated, false, "Opening or typing a reply must not navigate or submit");
      assert.equal(reply.quickDraft, "A separate new chat draft");
      assert.equal(reply.fontSize, "13px");
      assert.equal(reply.outline, "none");
      assert.equal(reply.shadow, "none");
      assert.equal(reply.radius, "12.5px");
      assert.equal(reply.inputMargin, 14);
      assert.equal(reply.sendButtons, 0);
      assert.equal(reply.nativeFocus, desktop);
      assert.ok(reply.opened.height >= reply.before.height + 40, "The card must grow to contain its editor");
      assert.ok(reply.frames.some(frame => frame.height > reply.before.height + 1 && frame.height < reply.opened.height - 1), "The inline editor must animate through intermediate heights");
      for (const frame of [...reply.frames, reply.typed]) {
        assert.ok(frame.gap >= 7 && frame.gap <= 9, `Animated cards must keep their 8px gap: ${JSON.stringify(frame)}`);
        assert.equal(frame.controlsY, frame.headerHeight / 2, "Reply controls must stay aligned with the header");
      }
      fs.writeFileSync(path.join(directory, `reply-${desktop ? "desktop" : "window"}.png`), (await window.webContents.capturePage()).toPNG());

      const interaction = await evaluate(`(async () => {
        const field = document.querySelector('[data-pet-key="reply-task"] textarea');
        field.value = Array.from({ length: 10 }, (_, index) => 'Line ' + index).join('\\n');
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 300));
        const maxHeight = field.getBoundingClientRect().height;
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
        const ignored = !window.petEvents.some(message => message.t === 'ask');
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        const request = window.petEvents.find(message => message.t === 'ask');
        receivePetMessage({ t: 'reply-result', key: request.key, requestId: request.requestId, ok: false });
        const error = !field.form.querySelector('[role="alert"]').hidden && field.value.includes('Line 9');
        receivePetMessage({ t: 'at', x: 0, y: innerHeight - 130 });
        await new Promise(resolve => setTimeout(resolve, 550));
        const atEdge = window.readPetReplyGeometry();
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 300));
        return { maxHeight, ignored, request, error, atEdge, closed: window.readPetReplyGeometry() };
      })()`);
      assert.equal(interaction.maxHeight, 80, "Long drafts must scroll inside the 80px editor limit");
      assert.equal(interaction.ignored, true);
      assert.equal(interaction.request.key, "reply-task");
      assert.equal(interaction.error, true, "Failed sends must retain the draft and show an inline error");
      assert.ok(interaction.atEdge.trayTop >= 0);
      assert.ok(interaction.atEdge.fieldBottom <= interaction.atEdge.trayBottom, "Replies must stay inside the stack near the screen edge");
      assert.equal(interaction.closed.replyHeight, 0);
      assert.equal(interaction.closed.height, reply.before.height);

      window.webContents.debugger.attach("1.3");
      await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }]
      });
      const reduced = await evaluate(`(() => {
        const card = document.querySelector('[data-pet-key="reply-task"]');
        card.querySelector('[data-pet-control="reply"]').click();
        const box = card.querySelector('.bettergravity-pet-card__reply');
        return { height: box.getBoundingClientRect().height, opacity: getComputedStyle(box).opacity, animations: box.getAnimations().length };
      })()`);
      assert.ok(reduced.height >= 26);
      assert.equal(reduced.opacity, "1");
      assert.equal(reduced.animations, 0);
      const reducedBadge = await evaluate(`(() => {
        receivePetMessage({ t: 'activity', entries: [] });
        receivePetMessage({ t: 'activity', entries: ${JSON.stringify(replyEntries)} });
        const badge = document.querySelector('.bettergravity-pet__badge');
        return { animations: badge.getAnimations().length, opacity: getComputedStyle(badge).opacity };
      })()`);
      assert.deepEqual(reducedBadge, { animations: 0, opacity: '1' });
      await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
      window.webContents.debugger.detach();
      const disposedBadge = await evaluate(`(async () => {
        await new Promise(resolve => requestAnimationFrame(resolve));
        receivePetMessage({ t: 'activity', entries: [] });
        receivePetMessage({ t: 'activity', entries: ${JSON.stringify(replyEntries)} });
        const badge = document.querySelector('.bettergravity-pet__badge');
        const animation = badge.getAnimations()[0];
        receivePetMessage({ t: 'bye' });
        return { wasAnimating: !!animation, playState: animation?.playState, connected: badge.isConnected };
      })()`);
      assert.deepEqual(disposedBadge, { wasAnimating: true, playState: 'idle', connected: false });
      inlineReplies++;
    }
    // A real contenteditable editor refuses insertText while its page is inert.
    // jsdom's textarea assignment does not exercise this tab-to-chat transition.
    const creation = await evaluate(`(async () => {
      document.body.innerHTML = '<aside><a data-testid="new-conversation-button" href="/">New chat</a></aside><div id="viewport" style="height:400px"><main data-testid="conversation-view" data-cascade-id="previous" style="display:flex;height:100%"></main></div>';
      const cleanups = [];
      let sent = 0;
      const conversation = document.querySelector('main');
      const composer = () => {
        conversation.innerHTML = '<div data-testid="agent-input-box"><div contenteditable="true" role="combobox" aria-label="Message input"></div><button data-testid="send-button">Send</button></div>';
        conversation.querySelector('button').onclick = () => sent++;
      };
      composer();
      document.querySelector('a').onclick = event => {
        event.preventDefault();
        history.replaceState(null, '', '/');
        conversation.dataset.cascadeId = 'conversation';
        composer();
      };
      const context = {
        settings: {
          define: schema => Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, key === 'home' ? 'window' : value.default])),
          onChange: () => () => {}
        },
        storage: { get: (key, fallback) => key === 'shown' ? false : fallback, set() {} },
        log: { info() {}, warn() {}, error() {} },
        ui: { button: spec => {
          const element = document.createElement('button');
          element.dataset.bettergravityButton = spec.label;
          element.onclick = spec.onClick;
          document.querySelector('aside').append(element);
          return { element, setActive: value => element.setAttribute('aria-pressed', String(value)), remove: () => element.remove() };
        } },
        pets: {
          read: async () => ({ enabled: true, pets: [], runs: [] }),
          prepareCreation: async () => ({}),
          onChanged: () => () => {}
        },
        onDispose: cleanup => cleanups.push(cleanup)
      };
      const controller = new Function('plugin', ${JSON.stringify(`${source}\nreturn { openPetLibrary, createPet };`)})(context);
      try {
        controller.openPetLibrary();
        if (!conversation.inert) throw new Error('The conversation must be inert behind the Pets page');
        await new Promise(resolve => setTimeout(resolve, 100));
        const visibility = () => document.querySelector('[data-pet-library-focus="visibility"]');
        const labels = [...document.querySelector('.bettergravity-pet-library__actions').children].map(button => button.textContent || button.getAttribute('aria-label'));
        if (labels.join('|') !== 'Create with Gemini|Open folder|Show pet|Refresh pets') throw new Error('Pet visibility belongs between Open folder and Refresh');
        visibility().click();
        await new Promise(resolve => setTimeout(resolve, 100));
        const toolbar = document.querySelector('[data-bettergravity-button="Pet"]');
        if (visibility().textContent !== 'Hide pet' || toolbar.getAttribute('aria-pressed') !== 'true' || !document.querySelector('.bettergravity-pet')) throw new Error('Showing the pet must update both controls');
        toolbar.click();
        if (visibility().textContent !== 'Show pet' || document.querySelector('.bettergravity-pet')) throw new Error('The toolbar must hide the pet and update the page');
        toolbar.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        document.querySelector('.bettergravity-pet').dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }));
        document.querySelector('.bettergravity-pet-menu__item').click();
        if (visibility().textContent !== 'Show pet' || toolbar.getAttribute('aria-pressed') !== 'false' || document.querySelector('.bettergravity-pet')) throw new Error('Close pet must synchronize both visibility controls');
        await controller.createPet();
        const field = conversation.querySelector('[contenteditable]');
        return {
          prefilled: field.textContent.includes('hatch-pet'),
          composerInteractive: !conversation.inert && document.activeElement === field,
          pageClosed: !document.querySelector('#bettergravity-pets-view'),
          sent
        };
      } finally { for (const cleanup of cleanups.reverse()) cleanup(); }
    })()`);
    assert.deepEqual(creation, { prefilled: true, composerInteractive: true, pageClosed: true, sent: 0 });
    fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify({ homes: 2, renderedSheets, pageCreation: true, inlineReplies, badgePresentations, centeredColumns, opticalCenters, synchronizedDragFrames, sharedWidths, closeMenus, visibilityControls: true }));
    server.close();
    window.destroy();
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    server.close();
    window.destroy();
    app.exit(1);
  }
}).catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  app.exit(1);
});
