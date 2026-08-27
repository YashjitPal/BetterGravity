import { createPreviewPatcher, type Patcher } from "@bettergravity/patcher";

// The browser build uses a safe preview adapter. A desktop shell will replace
// this with the native filesystem patcher once Antigravity's format is mapped.
export function createPatcherGateway(): Patcher {
  return createPreviewPatcher();
}
