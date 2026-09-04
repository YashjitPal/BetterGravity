/**
 * `plugin.account`, the signed-in user's name and nothing else.
 *
 * The page cannot read files, and the name is not in Antigravity's own state — it
 * is in the Chromium profile Antigravity signs into Google through — so the main
 * process reads it and this relays the answer.
 *
 * One read per page, shared by every plugin: a plugin that greets the user asks
 * on every visit to the home screen, and Google's record does not change between
 * them. A read that fails is not remembered, so a profile that is being rewritten
 * as the page loads is asked again rather than held wrong for the session.
 */

import type { AccountProfile, PluginAccount } from "@bettergravity/plugin-api";
import { resolveBridge } from "./bridge.js";

const NO_NAME: AccountProfile = {};

let pending: Promise<AccountProfile> | undefined;

export function createAccountTools(): PluginAccount {
  return {
    read: () => {
      if (pending) return pending;

      const bridge = resolveBridge();
      if (!bridge) return Promise.resolve(NO_NAME);

      pending = bridge.readAccount().then(
        (profile) => profile ?? NO_NAME,
        () => {
          pending = undefined;
          return NO_NAME;
        }
      );
      return pending;
    }
  };
}
