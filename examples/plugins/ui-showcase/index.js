// UI Showcase — one working example of every surface `plugin.ui` offers.
//
// Copy this folder into %APPDATA%\BetterGravity\plugins\ and turn on developer
// mode to run it.

const { ui } = plugin;

const settings = plugin.settings.define({
  greetOnStart: {
    type: "boolean",
    label: "Say hello on start",
    description: "Shows a toast when Antigravity finishes loading.",
    default: true
  }
});

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

if (settings.greetOnStart) {
  ui.toast({
    title: "UI Showcase is running",
    body: "Look for its button in the sidebar and its entry in Settings.",
    kind: "success"
  });
}

// ---------------------------------------------------------------------------
// Context menu entries
// ---------------------------------------------------------------------------

// Menus are identified by the test ids of the entries Antigravity put in them,
// because its component names are mangled by its compiler.
ui.contextMenu((menu) => {
  if (!menu.has("conversation-rename-menu-item")) return undefined;

  // The row the menu belongs to carries the conversation's id.
  const row = menu.trigger?.closest("[data-cascade-id]");
  const id = row instanceof HTMLElement ? row.dataset.cascadeId : undefined;
  if (!id) return undefined;

  return [
    {
      label: "Copy conversation id",
      icon: ui.icons.copy,
      onSelect: () => {
        void navigator.clipboard.writeText(id);
        ui.toast({ title: "Copied", body: id, kind: "success", duration: 2500 });
      }
    }
  ];
});

// ---------------------------------------------------------------------------
// Toolbar buttons and dialogs
// ---------------------------------------------------------------------------

let opened = plugin.storage.get("opened", 0);

ui.button({
  area: "sidebar",
  label: "UI Showcase",
  icon: ui.icons.star,
  tooltip: "Open the showcase dialog",
  onClick: () => {
    opened += 1;
    plugin.storage.set("opened", opened);

    ui.modal({
      title: "UI Showcase",
      description: "Everything here is built from Antigravity's own class names.",
      render: (body, close) => {
        const list = ui.element("div", { class: "flex flex-col gap-2" }, [
          ui.element("p", { class: ui.classes.subtitle, text: `Opened ${opened} time${opened === 1 ? "" : "s"}.` }),
          ui.element("input", { class: ui.classes.input, placeholder: "Type something" })
        ]);

        const done = ui.element("button", { class: ui.classes.button, text: "Close" });
        done.addEventListener("click", () => {
          close();
          ui.toast({ title: "Dialog closed", kind: "info", duration: 2000 });
        });

        body.append(list, ui.element("div", { class: "flex justify-end mt-3" }, [done]));
      }
    });
  }
});

// ---------------------------------------------------------------------------
// A settings screen of its own
// ---------------------------------------------------------------------------

// Small options belong on the plugin's row in the BetterGravity section. A
// section of its own is for plugins with enough to say to need the space.
const section = ui.settingsSection({
  label: "UI Showcase",
  render: (container) => {
    /**
     * @param {string} title
     * @param {string} description
     * @param {HTMLElement} control
     */
    const row = (title, description, control) =>
      ui.element("div", { class: ui.classes.row }, [
        ui.element("div", { class: "flex-1 flex flex-col gap-0.5" }, [
          ui.element("span", { class: "text-sm", text: title }),
          ui.element("span", { class: "text-xs text-muted-foreground", text: description })
        ]),
        control
      ]);

    const kinds = /** @type {const} */ (["info", "success", "warning", "error"]);
    const buttons = kinds.map((kind) => {
      const button = ui.element("button", { class: ui.classes.button, text: kind });
      button.addEventListener("click", () => ui.toast({ title: `A ${kind} toast`, kind }));
      return button;
    });

    const reset = ui.element("button", { class: ui.classes.button, text: "Reset counter" });
    reset.addEventListener("click", () => {
      opened = 0;
      plugin.storage.set("opened", 0);
      // The section is only re-rendered on request, so the count updates here.
      section.refresh();
    });

    container.replaceChildren(
      ui.element("div", { class: "p-6 flex flex-col gap-4 w-full max-w-2xl mx-auto" }, [
        ui.element("h2", { class: ui.classes.title, text: "UI Showcase" }),
        ui.element("div", { class: ui.classes.subtitle, text: "A plugin's own screen in Antigravity's settings." }),
        ui.element("div", { class: ui.classes.group }, [
          ui.element("h3", { class: ui.classes.groupHeading, text: "Toasts" }),
          ui.element("div", { class: ui.classes.card }, [
            row("Show a toast", "One of each kind.", ui.element("div", { class: "flex gap-1.5" }, buttons))
          ])
        ]),
        ui.element("div", { class: ui.classes.group }, [
          ui.element("h3", { class: ui.classes.groupHeading, text: "Dialog" }),
          ui.element("div", { class: ui.classes.card }, [row("Times opened", String(opened), reset)])
        ])
      ])
    );
  }
});

plugin.log.info("ui-showcase ready");
