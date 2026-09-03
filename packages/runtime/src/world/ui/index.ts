import type { PluginUi, SettingsSectionHandle, SettingsSectionOptions } from "@bettergravity/plugin-api";
import { el } from "../el.js";
import { addToolbarButton } from "./button.js";
import { HOST_CLASSES, ICONS, renderIcon } from "./chrome.js";
import { addMenuContributor } from "./menu.js";
import { openModal } from "./modal.js";
import { registerSection, requestSectionRefresh } from "./sections-registry.js";
import { showToast } from "./toast.js";

/**
 * Everything a plugin uses to put its own controls into Antigravity's
 * interface. Each registration is tracked so disabling the plugin takes its UI
 * with it.
 */
export function createUiTools(pluginId: string, track: (cleanup: () => void) => void): PluginUi {
  return {
    toast: (options) => showToast(options, track),

    contextMenu: (contributor) => {
      const remove = addMenuContributor(contributor);
      track(remove);
      return remove;
    },

    button: (spec) => {
      const handle = addToolbarButton(spec);
      track(handle.remove);
      return handle;
    },

    modal: (options) => openModal(options, track),

    settingsSection: (options: SettingsSectionOptions): SettingsSectionHandle => {
      // Namespaced so two plugins can both call their section "Advanced".
      const id = `${pluginId}:${options.label}`;
      const remove = registerSection({ id, pluginId, label: options.label, render: options.render });
      track(remove);
      return {
        refresh: () => requestSectionRefresh(id),
        remove
      };
    },

    element: (tag, attributes = {}, children = []) => {
      const normalised = Object.fromEntries(
        Object.entries(attributes).map(([name, value]) => [name, value as string | number | boolean | undefined])
      );
      return el(tag as "div", normalised, children);
    },

    icon: (path, size) => renderIcon(path, size),
    classes: HOST_CLASSES,
    icons: ICONS
  };
}
