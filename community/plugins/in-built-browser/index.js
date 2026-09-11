// Shared browser chrome. Websites live in a sandboxed native Chromium view.
const ICONS = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
  back: '<path d="m14 6-6 6 6 6M8 12h12"/>', forward: '<path d="m10 6 6 6-6 6M4 12h12"/>',
  reload: '<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', external: '<path d="M14 4h6v6m0-6L10 14M10 4H4v16h16v-6"/>',
  menu: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', comment: '<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3V6a2 2 0 0 1 2-2Z"/>',
  expand: '<path d="M14 4h6v6m0-6-7 7M10 20H4v-6m0 6 7-7"/>', find: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16"/>', lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>'
};
const svg = name => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.globe}</svg>`;
let disposed = false;
let root, trigger, toolbar, body, viewport, address, tabs, errorBox, statusBar, overlay, note, findBar;
let state = null;
let open = false;
let context = currentContext();
let frame = 0;
let resizeObserver, toolbarObserver;
let expanded = false;
let noteStyles = {};
let originalStyle;
let previewTimer;
let lastTabs = "";
let lastBounds = "";
let historyRequest = 0;
const hiddenChildren = new Map();

const options = plugin.settings.define({
  shortcut: { type: "note", label: "Open browser", read: () => "Click the globe beside Terminal in the right sidebar, or press Ctrl+Shift+B (Cmd+Shift+B on macOS)." },
  browserSettings: { type: "action", label: "Browser settings", action: "Open browser settings", onSelect: async () => { await show(); showSettings(); } },
  status: { type: "note", label: "Browser tools", read: () => plugin.browser?.available ? "Tools follow this plugin's enabled state. Developer tools are controlled separately in Browser settings." : "Restart Antigravity after the runtime update to activate the native browser." }
});

function currentContext() { return location.pathname.match(/\/c\/([^/]+)/)?.[1] || location.pathname || "default"; }
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function button(label, icon, action, className = "bg-browser-icon") {
  const node = element("button", className); node.type = "button"; node.title = label; node.setAttribute("aria-label", label);
  node.innerHTML = svg(icon); node.addEventListener("click", action); return node;
}
function showError(error) { if (!disposed && errorBox) { errorBox.textContent = error?.message || String(error); errorBox.hidden = false; scheduleBounds(); } }
async function request(action, args = {}) {
  if (disposed) return;
  if (!plugin.browser?.available) throw new Error("The native browser runtime update is ready. Restart Antigravity to load it.");
  const result = await plugin.browser.request(action, { context, ...args });
  if (result?.browserId && result.context === context && !disposed) render(result);
  return result;
}
const act = (action, args) => request(action, args).catch(showError);
function activeTab() { return state?.tabs.find(tab => tab.id === state.activeTabId); }

function mount(terminal) {
  if (!terminal) return;
  const header = terminal.closest("[data-active-tab-id]");
  const paneBody = header?.nextElementSibling;
  if (!header || !paneBody || trigger?.isConnected && toolbar === header) return;
  if (root) unmount();
  toolbar = header; body = paneBody;
  trigger = button("Browser (Ctrl+Shift+B)", "globe", () => open ? hide() : void show(), `${terminal.className} bg-browser-trigger`);
  trigger.dataset.tabId = "in-built-browser"; trigger.setAttribute("aria-label", "Browser tab"); trigger.setAttribute("aria-pressed", "false");
  terminal.after(trigger);
  root = element("section", "bg-browser"); root.id = "bg-in-built-browser"; root.setAttribute("aria-label", "In Built Browser"); root.hidden = true;
  const strip = element("div", "bg-browser-strip");
  tabs = element("div", "bg-browser-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Browser tabs");
  strip.append(tabs, button("New tab", "plus", () => { closeOverlay(); act("new-tab").then(focusAddress); }));
  const end = element("div", "bg-browser-strip-end");
  end.append(button("Expand browser", "expand", () => { expanded = !expanded; root.classList.toggle("bg-browser-expanded", expanded); scheduleBounds(); }), button("Close browser pane", "close", hide));
  strip.append(end);
  const navigation = element("form", "bg-browser-navigation"); navigation.setAttribute("role", "search");
  const back = button("Back", "back", () => act("back")); back.dataset.control = "back";
  const forward = button("Forward", "forward", () => act("forward")); forward.dataset.control = "forward";
  const reload = button("Reload", "reload", () => act(activeTab()?.loading ? "stop-loading" : "reload")); reload.dataset.control = "reload";
  const locationField = element("div", "bg-browser-location");
  const scheme = element("span", "bg-browser-scheme"); scheme.innerHTML = svg("globe");
  address = element("input", "bg-browser-address"); address.type = "text"; address.placeholder = "Search or enter a URL"; address.setAttribute("aria-label", "Search or enter a URL"); address.autocomplete = "off"; address.spellcheck = false;
  address.addEventListener("focus", () => address.select());
  address.addEventListener("input", suggestHistory);
  address.addEventListener("keydown", event => {
    if (event.key === "Escape") { closeOverlay(); address.blur(); }
    if (event.key === "ArrowDown" && overlay?.querySelector(".bg-browser-history-item")) { event.preventDefault(); overlay.querySelector(".bg-browser-history-item").focus(); }
  });
  locationField.append(scheme, address, button("Open in default browser", "external", () => act("external")));
  navigation.append(back, forward, reload, locationField, button("Annotate page", "comment", () => { closeOverlay(); act("annotate", { enabled: true }); }), button("Browser menu", "menu", showMenu));
  navigation.addEventListener("submit", event => { event.preventDefault(); const url = address.value; closeOverlay(); address.blur(); errorBox.hidden = true; act("navigate", { url }); });
  findBar = element("div", "bg-browser-find"); findBar.hidden = true;
  const search = element("input"); search.placeholder = "Find in page"; search.setAttribute("aria-label", "Find in page");
  search.addEventListener("input", () => act("find", { text: search.value }));
  search.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); act("find", { text: search.value, next: true, forward: !event.shiftKey }); } if (event.key === "Escape") closeFind(); });
  findBar.append(search, button("Previous match", "back", () => act("find", { text: search.value, next: true, forward: false })), button("Next match", "forward", () => act("find", { text: search.value, next: true, forward: true })), button("Close find", "close", closeFind));
  errorBox = element("div", "bg-browser-error"); errorBox.setAttribute("role", "status"); errorBox.hidden = true;
  viewport = element("div", "bg-browser-viewport"); viewport.dataset.testid = "in-built-browser-viewport";
  const blank = element("div", "bg-browser-blank");
  const globe = element("span", "bg-browser-blank-icon"); globe.innerHTML = svg("globe");
  blank.append(globe, element("h2", "", "Start browsing"), element("p", "", "Enter a URL to open a page"));
  blank.addEventListener("click", focusAddress);
  const frozen = element("img", "bg-browser-frozen"); frozen.alt = "Current browser page"; frozen.hidden = true;
  viewport.append(blank, frozen);
  statusBar = element("div", "bg-browser-status"); statusBar.hidden = true;
  note = element("div", "bg-browser-note"); note.hidden = true;
  root.append(strip, navigation, findBar, errorBox, viewport, statusBar, note);
  body.setAttribute("data-bg-browser-container", ""); body.append(root);
  const onNativeTab = event => { const native = event.target.closest?.("[data-tab-id]"); if (native && native !== trigger) hide(); };
  toolbar.addEventListener("click", onNativeTab, true);
  toolbar._bgBrowserCleanup = () => toolbar?.removeEventListener("click", onNativeTab, true);
  let nativeTab = toolbar.getAttribute("data-active-tab-id");
  toolbarObserver = new MutationObserver(() => { const next = toolbar.getAttribute("data-active-tab-id"); if (next !== nativeTab) { nativeTab = next; if (open) hide(); } });
  toolbarObserver.observe(toolbar, { attributes: true, attributeFilter: ["data-active-tab-id"] });
  resizeObserver = new ResizeObserver(scheduleBounds); resizeObserver.observe(viewport); resizeObserver.observe(body);
  if (plugin.browser?.available) act("attach");
}

function showNativePane() {
  const wrapper = toolbar?.closest("[data-aux-pane-open]");
  if (wrapper?.getAttribute("data-aux-pane-open") === "false" || toolbar?.getBoundingClientRect().width < 5) document.querySelector('[data-testid="toggle-aux-sidebar"]')?.click();
}
async function show() {
  if (!root) mount(document.querySelector('button[data-tab-id="terminal"]'));
  if (!root) { plugin.ui.toast?.("Open a conversation to use the browser."); return; }
  open = true; root.hidden = false; showNativePane(); maskNative(); updateTrigger(); scheduleBounds();
  try { await request("open"); focusAddress(); } catch (error) { showError(error); }
}
function hide() {
  if (!root) return;
  open = false; expanded = false; root.classList.remove("bg-browser-expanded"); root.hidden = true; closeOverlay(); restoreNative(); updateTrigger();
  plugin.browser?.setBounds({ context, x: 0, y: 0, width: 0, height: 0, visible: false });
  act("hide");
}
function maskNative() {
  if (!body || !open) return;
  for (const child of body.children) {
    if (child === root || hiddenChildren.has(child)) continue;
    hiddenChildren.set(child, { visibility: child.style.visibility, inert: child.inert });
    child.style.visibility = "hidden"; child.inert = true;
  }
}
function restoreNative() { for (const [child, previous] of hiddenChildren) { child.style.visibility = previous.visibility; child.inert = previous.inert; } hiddenChildren.clear(); }
function updateTrigger() { trigger?.setAttribute("aria-pressed", String(open)); toolbar?.toggleAttribute("data-bg-browser-selected", open); }
function focusAddress() { if (open) { address?.focus(); address?.select(); } }
function scheduleBounds() { if (!frame && !disposed) frame = requestAnimationFrame(syncBounds); }
function syncBounds() {
  frame = 0;
  if (!viewport || disposed) return;
  const box = viewport.getBoundingClientRect();
  const tab = activeTab();
  const occluded = !!document.querySelector('[role="dialog"], [data-state="open"][role="menu"]');
  const wrapper = toolbar?.closest("[data-aux-pane-open]");
  const visible = open && !document.hidden && !overlay && !state?.permission && !state?.dialog && !state?.selection && !occluded && wrapper?.getAttribute("data-aux-pane-open") !== "false" && tab?.url !== "about:blank" && !!tab && !tab.error;
  const next = { context, x: box.x, y: box.y, width: box.width, height: box.height, visible: !!visible };
  const signature = JSON.stringify(next);
  if (signature !== lastBounds) { lastBounds = signature; plugin.browser?.setBounds(next); }
  if (open) maskNative();
}

function render(next) {
  if (disposed || !root || next.context !== context) return;
  const previousSelection = state?.selection;
  state = next;
  if (!next.enabled) { open = false; root.hidden = true; restoreNative(); updateTrigger(); return; }
  if (next.visible && !open) { open = true; root.hidden = false; showNativePane(); maskNative(); updateTrigger(); }
  if (!next.visible && open) { open = false; root.hidden = true; restoreNative(); updateTrigger(); }
  const signature = JSON.stringify(next.tabs.map(tab => [tab.id, tab.title, tab.loading, tab.id === next.activeTabId]));
  if (signature !== lastTabs) {
    lastTabs = signature; tabs.replaceChildren();
    for (const tab of next.tabs) {
      const item = element("div", "bg-browser-tab"); item.setAttribute("role", "tab"); item.tabIndex = tab.id === next.activeTabId ? 0 : -1; item.setAttribute("aria-selected", String(tab.id === next.activeTabId)); item.title = `${tab.title}\n${tab.url}`;
      const icon = element("span", tab.loading ? "bg-browser-tab-icon bg-browser-spinning" : "bg-browser-tab-icon"); icon.innerHTML = svg(tab.loading ? "reload" : "globe");
      item.append(icon, element("span", "bg-browser-tab-title", tab.title || "New tab"), button(`Close ${tab.title || "tab"}`, "close", event => { event.stopPropagation(); act("close-tab", { tabId: tab.id }); }, "bg-browser-tab-close"));
      item.addEventListener("click", () => { closeOverlay(); act("select", { tabId: tab.id }); });
      item.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); act("select", { tabId: tab.id }); }
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); const index = next.tabs.indexOf(tab); const target = next.tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + next.tabs.length) % next.tabs.length]; act("select", { tabId: target.id }); }
      });
      tabs.append(item);
    }
  }
  const active = activeTab();
  if (document.activeElement !== address) address.value = active && active.url !== "about:blank" ? active.url : "";
  root.querySelector('[data-control="back"]').disabled = !active?.canGoBack;
  root.querySelector('[data-control="forward"]').disabled = !active?.canGoForward;
  const reload = root.querySelector('[data-control="reload"]'); reload.innerHTML = svg(active?.loading ? "stop" : "reload"); reload.title = active?.loading ? "Stop loading" : "Reload"; reload.disabled = !active;
  viewport.querySelector(".bg-browser-blank").hidden = !!active && active.url !== "about:blank";
  if (active?.error) showError(active.error); else if (errorBox.textContent === state?.error) errorBox.hidden = true;
  statusBar.replaceChildren(); statusBar.hidden = !(next.activity || next.paused || next.annotations.length);
  if (!statusBar.hidden) {
    const status = element("span", "bg-browser-status-text", next.paused ? "Browser control paused" : next.activity || `${next.annotations.length} page comment${next.annotations.length === 1 ? "" : "s"}`);
    statusBar.append(status);
    if (next.activity || next.paused) statusBar.append(button(next.paused ? "Resume model control" : "Stop model control", next.paused ? "play" : "stop", () => act(next.paused ? "resume" : "pause")));
    if (next.annotations.length) statusBar.append(button("View page comments", "comment", showComments));
  }
  if (next.permission) showPermission(next.permission);
  else if (next.dialog) showDialog(next.dialog);
  else if (overlay?.dataset.kind === "permission" || overlay?.dataset.kind === "dialog") closeOverlay();
  if (next.selection && next.selection !== previousSelection && JSON.stringify(next.selection) !== note.dataset.selection) showNote(next.selection);
  else if (!next.selection) { note.hidden = true; note.dataset.selection = ""; }
  scheduleBounds();
}

function closeFind() { if (findBar) findBar.hidden = true; act("find", { text: "" }); scheduleBounds(); }
function showFind() { closeOverlay(); findBar.hidden = false; findBar.querySelector("input").focus(); scheduleBounds(); }
function closeOverlay() { overlay?.remove(); overlay = null; if (viewport) viewport.querySelector(".bg-browser-frozen").hidden = true; scheduleBounds(); }
function popover(kind, title) {
  if (overlay?.dataset.kind === kind) return overlay;
  closeOverlay();
  overlay = element("div", "bg-browser-popover"); overlay.dataset.kind = kind;
  if (title) { const heading = element("div", "bg-browser-popover-heading"); heading.append(element("strong", "", title), button("Close", "close", closeOverlay)); overlay.append(heading); }
  root.append(overlay);
  if (activeTab()?.url !== "about:blank") request("capture").then(data => { if (overlay && typeof data === "string") { const img = viewport.querySelector(".bg-browser-frozen"); img.src = data; img.hidden = false; } }).catch(() => {});
  scheduleBounds(); return overlay;
}
function menuItem(container, title, icon, callback, hint = "") {
  const item = button(title, icon, callback, "bg-browser-menu-item"); item.append(element("span", "", title)); if (hint) item.append(element("kbd", "", hint)); container.append(item); return item;
}
function showMenu() {
  if (overlay?.dataset.kind === "menu") { closeOverlay(); return; }
  const menu = popover("menu");
  menuItem(menu, "New tab", "plus", () => { closeOverlay(); act("new-tab").then(focusAddress); }, "Ctrl+T");
  menuItem(menu, "History", "history", showHistory);
  menuItem(menu, "Downloads", "download", showDownloads);
  menuItem(menu, "Find in page", "find", showFind, "Ctrl+F");
  menuItem(menu, "Page comments", "comment", showComments);
  const zoom = element("div", "bg-browser-zoom");
  zoom.append(element("span", "", "Zoom"), button("Zoom out", "back", () => act("zoom", { factor: Math.max(0.25, (activeTab()?.zoom || 1) - 0.1) })), element("span", "", `${Math.round((activeTab()?.zoom || 1) * 100)}%`), button("Zoom in", "plus", () => act("zoom", { factor: Math.min(5, (activeTab()?.zoom || 1) + 0.1) }))); menu.append(zoom);
  menuItem(menu, "Responsive viewport", "expand", showViewport);
  menuItem(menu, "Developer tools", "code", () => { closeOverlay(); act("devtools"); }, "F12");
  menuItem(menu, "Browser settings", "settings", showSettings);
}
async function showHistory() {
  const menu = popover("history", "History"); menu.replaceChildren();
  const heading = element("div", "bg-browser-popover-heading"); heading.append(element("strong", "", "History"), button("Close history", "close", closeOverlay)); menu.append(heading);
  const input = element("input", "bg-browser-search"); input.placeholder = "Search browser history"; input.setAttribute("aria-label", input.placeholder); menu.append(input);
  const results = element("div", "bg-browser-history-results"); menu.append(results);
  const refresh = async () => { const entries = await request("history", { query: input.value }); if (menu !== overlay) return; fillHistory(results, entries || []); };
  input.addEventListener("input", () => refresh().catch(showError)); await refresh(); input.focus();
}
function fillHistory(container, entries) {
  container.replaceChildren();
  if (!entries.length) container.append(element("p", "bg-browser-muted", "No matching pages"));
  for (const entry of entries.slice(0, 25)) {
    const item = element("button", "bg-browser-history-item"); item.type = "button";
    item.append(element("span", "", entry.title || entry.url), element("small", "", entry.url));
    item.addEventListener("click", () => { closeOverlay(); address.blur(); act("navigate", { url: entry.url }); }); container.append(item);
  }
}
async function suggestHistory() {
  const value = address.value.trim();
  if (!value) { closeOverlay(); return; }
  const sequence = ++historyRequest;
  const entries = await request("history", { query: value }).catch(() => []);
  if (sequence !== historyRequest || document.activeElement !== address || !entries?.length) return;
  const suggestions = popover("suggestions"); fillHistory(suggestions, entries.slice(0, 8));
}
function showDownloads() {
  const menu = popover("downloads", "Downloads");
  for (const download of state?.downloads || []) {
    const row = element("div", "bg-browser-download");
    row.append(element("span", "", download.filename), element("small", "", download.state === "progressing" ? `${Math.round(download.received / 1024)} KB${download.total ? ` / ${Math.round(download.total / 1024)} KB` : ""}` : download.state));
    row.append(button(download.state === "progressing" ? "Cancel download" : "Show in folder", download.state === "progressing" ? "close" : "external", () => act(download.state === "progressing" ? "cancel-download" : "downloads-folder", { id: download.id }))); menu.append(row);
  }
  if (!state?.downloads.length) menu.append(element("p", "bg-browser-muted", "Your downloads will appear here."));
}
async function showSettings() {
  const menu = popover("settings", "Browser settings");
  const settings = await request("preferences").catch(() => null); if (!settings || menu !== overlay) return;
  for (const [key, label, description] of [["requireApproval", "Ask before model access", "Ask when the model uses a new website."], ["developerMode", "Developer mode", "Give the model tab-scoped DevTools access."]]) {
    const row = element("label", "bg-browser-setting"); const text = element("span"); text.append(element("strong", "", label), element("small", "", description));
    const check = element("input"); check.type = "checkbox"; check.checked = settings[key]; check.addEventListener("change", () => act("configure", { [key]: check.checked })); row.append(text, check); menu.append(row);
  }
  menu.append(element("p", "bg-browser-muted", "This browser keeps its own sign-ins and history."));
  menuItem(menu, "Reset website permissions", "lock", () => { act("reset-permissions"); closeOverlay(); });
  menuItem(menu, "Clear history", "history", () => { act("clear-history"); closeOverlay(); });
  menuItem(menu, "Clear browsing data and sign-ins", "close", () => { act("clear-data"); closeOverlay(); });
}
function showViewport() {
  const menu = popover("viewport", "Responsive viewport");
  for (const [label, width, height] of [["Fit pane", null, null], ["Mobile · 390 × 844", 390, 844], ["Tablet · 768 × 1024", 768, 1024], ["Desktop · 1440 × 900", 1440, 900]]) menuItem(menu, label, "expand", () => { act("viewport", { width, height }); closeOverlay(); });
}
function showPermission(permission) {
  if (overlay?.dataset.requestId === permission.id) return;
  const modal = popover("permission", "Website access"); modal.dataset.requestId = permission.id;
  modal.append(element("p", "bg-browser-origin", permission.origin), element("p", "", permission.description));
  const actions = element("div", "bg-browser-actions");
  for (const [label, allow, always] of [["Allow once", true, false], ["Always allow", true, true], ["Decline", false, false]]) {
    const b = element("button", allow && !always ? "bg-browser-primary" : "", label); b.addEventListener("click", () => { act("approve", { id: permission.id, allow, always }); closeOverlay(); }); actions.append(b);
  }
  modal.append(actions);
}
function showDialog(dialog) {
  if (overlay?.dataset.requestId === dialog.id) return;
  const modal = popover("dialog", "Message from this page"); modal.dataset.requestId = dialog.id; modal.append(element("p", "", dialog.message));
  const input = element("input", "bg-browser-search"); input.value = dialog.defaultPrompt; input.setAttribute("aria-label", "Response"); if (dialog.type === "prompt") modal.append(input);
  const actions = element("div", "bg-browser-actions");
  for (const [label, accept] of [["OK", true], ["Cancel", false]]) { const b = element("button", accept ? "bg-browser-primary" : "", label); b.addEventListener("click", () => { act("dialog", { accept, text: input.value }); closeOverlay(); }); actions.append(b); }
  modal.append(actions);
}
function showNote(selection) {
  closeOverlay(); note.replaceChildren(); note.hidden = false; note.dataset.selection = JSON.stringify(selection); noteStyles = {}; originalStyle = undefined;
  note.append(element("strong", "", selection.area ? "Comment on selected area" : `Comment on ${selection.element?.tagName || "element"}`));
  const comment = element("textarea"); comment.placeholder = "Describe what should change…"; comment.setAttribute("aria-label", "Page comment"); note.append(comment);
  const styleFields = element("div", "bg-browser-style-fields"); styleFields.hidden = true;
  for (const [key, label] of [["fontSize", "Font size"], ["fontFamily", "Font"], ["color", "Text color"], ["backgroundColor", "Background"], ["padding", "Padding"], ["margin", "Margin"], ["borderRadius", "Corners"], ["gap", "Gap"]]) {
    const field = element("label", "", label); const input = element("input"); input.placeholder = selection.element?.styles?.[key] || ""; field.append(input); styleFields.append(field);
    input.addEventListener("input", () => {
      noteStyles[key] = input.value; clearTimeout(previewTimer);
      previewTimer = setTimeout(async () => { try { const result = await request("style-preview", { tabId: selection.tabId, selector: selection.element.selector.primary, styles: noteStyles }); if (originalStyle === undefined) originalStyle = result.original; } catch (error) { showError(error); } }, 180);
    });
  }
  note.append(styleFields);
  const actions = element("div", "bg-browser-actions");
  const adjust = element("button", "", "Adjust styles"); adjust.disabled = !selection.element?.selector?.primary; adjust.addEventListener("click", () => { styleFields.hidden = !styleFields.hidden; scheduleBounds(); });
  const cancel = element("button", "", "Cancel"); cancel.addEventListener("click", () => { clearTimeout(previewTimer); if (originalStyle !== undefined) act("style-restore", { tabId: selection.tabId, selector: selection.element.selector.primary, original: originalStyle }); act("discard-selection"); });
  const save = element("button", "bg-browser-primary", "Save comment"); save.addEventListener("click", () => { if (!comment.value.trim()) { comment.focus(); return; } clearTimeout(previewTimer); act("save-annotation", { comment: comment.value, styles: noteStyles }); });
  actions.append(adjust, cancel, save); note.append(actions); comment.focus(); scheduleBounds();
}
function showComments() {
  const menu = popover("comments", "Page comments");
  if (!state?.annotations.length) menu.append(element("p", "bg-browser-muted", "Use the comment button, then select an element or drag over an area."));
  for (const annotation of state?.annotations || []) {
    const card = element("div", "bg-browser-comment"); card.append(element("small", "", annotation.title || annotation.url), element("p", "", annotation.comment));
    const actions = element("div", "bg-browser-actions"); const draft = element("button", "", "Add to chat");
    draft.addEventListener("click", () => {
      closeOverlay(); const composer = document.querySelector('[contenteditable="true"][role="textbox"], .tiptap[contenteditable="true"], .ProseMirror[contenteditable="true"]');
      if (!composer) { showError("Comment saved. Ask the model to read your browser comments."); return; }
      composer.focus(); document.execCommand("insertText", false, `Browser comment on ${annotation.url}\n${annotation.comment}${annotation.element?.selector?.primary ? `\nElement: ${annotation.element.selector.primary}` : ""}\n`);
    });
    const remove = element("button", "", "Remove"); remove.addEventListener("click", () => { act("remove-annotation", { id: annotation.id }); closeOverlay(); }); actions.append(draft, remove); card.append(actions); menu.append(card);
  }
}

async function syncContext() {
  const next = currentContext(); if (next === context || disposed) return;
  if (open) { root.hidden = true; restoreNative(); }
  context = next; state = null; open = false; lastTabs = ""; lastBounds = ""; closeOverlay(); updateTrigger();
  if (plugin.browser?.available && root) act("attach");
}
function onKey(event) {
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.shiftKey && event.key.toLowerCase() === "b") { event.preventDefault(); event.stopPropagation(); open ? hide() : void show(); return; }
  if (!open || !modifier) return;
  if (event.key.toLowerCase() === "l") { event.preventDefault(); focusAddress(); }
  else if (event.key.toLowerCase() === "t") { event.preventDefault(); act("new-tab").then(focusAddress); }
  else if (event.key.toLowerCase() === "w" && activeTab()) { event.preventDefault(); act("close-tab"); }
  else if (event.key.toLowerCase() === "f") { event.preventDefault(); showFind(); }
}
function unmount() {
  restoreNative(); resizeObserver?.disconnect(); toolbarObserver?.disconnect(); toolbar?._bgBrowserCleanup?.();
  toolbar?.removeAttribute("data-bg-browser-selected"); body?.removeAttribute("data-bg-browser-container"); trigger?.remove(); root?.remove();
  root = trigger = toolbar = body = viewport = null; lastTabs = ""; lastBounds = "";
}

plugin.dom.observe('button[data-tab-id="terminal"]', mount);
if (plugin.browser?.available) plugin.browser.onStateChanged(next => {
  if (next.context !== context) return;
  render(next);
  if (next.shortcut === "address") focusAddress();
  else if (next.shortcut === "find") showFind();
  else if (next.shortcut === "toggle") open ? hide() : void show();
  else if (next.shortcut) act(next.shortcut).then(() => { if (next.shortcut === "new-tab") focusAddress(); });
});
document.addEventListener("keydown", onKey, true);
window.addEventListener("resize", scheduleBounds);
document.addEventListener("visibilitychange", scheduleBounds);
window.addEventListener("popstate", syncContext);
plugin.patcher.after(history, "pushState", () => { queueMicrotask(syncContext); });
plugin.patcher.after(history, "replaceState", () => { queueMicrotask(syncContext); });
const occlusion = new MutationObserver(() => { if (open) scheduleBounds(); });
occlusion.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-aux-pane-open", "data-state"] });
plugin.onDispose(() => {
  disposed = true; clearTimeout(previewTimer); if (frame) cancelAnimationFrame(frame);
  plugin.browser?.setBounds({ context, x: 0, y: 0, width: 0, height: 0, visible: false });
  if (plugin.browser?.available) plugin.browser.request("detach", { context }).catch(() => {});
  document.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", scheduleBounds); document.removeEventListener("visibilitychange", scheduleBounds); window.removeEventListener("popstate", syncContext); occlusion.disconnect(); unmount();
});
