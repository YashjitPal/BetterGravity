/**
 * Styles for the settings panel. They live inside a shadow root, so Antigravity
 * cannot restyle the panel and the panel cannot leak into Antigravity.
 */
export const PANEL_STYLES = `
:host {
  all: initial;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }

.scrim {
  position: fixed;
  inset: 0;
  z-index: 2147483600;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 7, 10, 0.55);
  backdrop-filter: blur(2px);
}

.panel {
  display: flex;
  flex-direction: column;
  width: min(760px, calc(100vw - 48px));
  height: min(620px, calc(100vh - 64px));
  border-radius: 14px;
  overflow: hidden;
  color: #e8e8ec;
  background: #17181c;
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55);
}

header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.mark {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: linear-gradient(135deg, #7c5cff, #4aa8ff);
  flex: none;
}

.title { font-size: 14px; font-weight: 600; }
.subtitle { font-size: 11.5px; color: #8b8d98; margin-top: 2px; }
.grow { flex: 1; }

.close {
  border: 0;
  border-radius: 8px;
  width: 30px;
  height: 30px;
  font-size: 16px;
  cursor: pointer;
  color: #b6b8c2;
  background: rgba(255, 255, 255, 0.05);
}
.close:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }

nav {
  display: flex;
  gap: 4px;
  padding: 10px 14px 0;
}

nav button {
  border: 0;
  border-radius: 8px 8px 0 0;
  padding: 8px 14px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  color: #8b8d98;
  background: transparent;
}
nav button:hover { color: #d6d7dd; }
nav button[aria-selected="true"] { color: #fff; background: rgba(255, 255, 255, 0.06); }

main {
  flex: 1;
  overflow-y: auto;
  padding: 14px 18px 18px;
}

.row {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 13px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 8px;
}

.row-name { font-size: 13px; font-weight: 600; }
.row-meta { font-size: 11px; color: #7f818c; margin-top: 3px; }
.row-desc { font-size: 12px; color: #a9abb5; margin-top: 5px; line-height: 1.45; }

.switch {
  position: relative;
  flex: none;
  width: 38px;
  height: 22px;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.14);
  transition: background 120ms ease;
}
.switch::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 120ms ease;
}
.switch[aria-checked="true"] { background: #7c5cff; }
.switch[aria-checked="true"]::after { transform: translateX(16px); }

.empty {
  padding: 34px 18px;
  text-align: center;
  font-size: 12.5px;
  line-height: 1.6;
  color: #8b8d98;
}

.notice {
  padding: 13px 14px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.55;
  color: #d8c9a4;
  background: rgba(214, 168, 62, 0.09);
  border: 1px solid rgba(214, 168, 62, 0.22);
  margin-bottom: 12px;
}

.settings {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: grid;
  gap: 10px;
}

.field { display: flex; align-items: center; gap: 12px; }
.field-label { font-size: 12px; flex: 1; }
.field-hint { font-size: 11px; color: #7f818c; margin-top: 2px; }

input[type="text"], input[type="number"], select {
  min-width: 150px;
  padding: 6px 9px;
  font: inherit;
  font-size: 12px;
  color: #e8e8ec;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.28);
}

footer {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

footer button {
  padding: 7px 12px;
  font: inherit;
  font-size: 12px;
  border-radius: 8px;
  cursor: pointer;
  color: #c9cad2;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
footer button:hover { color: #fff; background: rgba(255, 255, 255, 0.1); }

.hint { font-size: 11px; color: #6e707a; }

.diagnostic {
  font-size: 11.5px;
  line-height: 1.5;
  color: #e0a3a3;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(224, 90, 90, 0.08);
  border: 1px solid rgba(224, 90, 90, 0.2);
  margin-bottom: 6px;
}
`;
