import type { PluginPets } from "@bettergravity/plugin-api";
import { resolveBridge } from "./bridge.js";

const listeners = new Set<() => void>();
let subscribed = false;

function bridge() {
  const value = resolveBridge();
  if (!value?.petsRead) throw new Error("Restart Antigravity to activate pet creation.");
  return value;
}

export function createPetTools(owner: string, track: (cleanup: () => void) => void): PluginPets {
  return {
    read: async () => bridge().petsRead(owner),
    load: async id => bridge().petsLoad(owner, id),
    prepareCreation: async () => bridge().petsPrepare(owner),
    openFolder: async () => bridge().petsOpenFolder(owner),
    onChanged: listener => {
      if (!subscribed && resolveBridge()?.onPetsChanged) {
        resolveBridge()!.onPetsChanged(() => { for (const callback of [...listeners]) callback(); });
        subscribed = true;
      }
      listeners.add(listener);
      const remove = () => { listeners.delete(listener); };
      track(remove);
      return remove;
    }
  };
}
