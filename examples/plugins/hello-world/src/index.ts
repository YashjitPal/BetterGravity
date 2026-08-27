import type { BetterGravityPlugin } from "@bettergravity/plugin-api";

export const helloWorldPlugin: BetterGravityPlugin = {
  manifest: {
    id: "example.hello-world",
    name: "Hello World",
    version: "0.1.0",
    description: "A minimal BetterGravity plugin example.",
    kind: "plugin",
    author: { name: "BetterGravity Contributors" },
    license: "MIT",
    hostCompatibility: "*"
  },
  activate(context) {
    context.log("Hello from a BetterGravity plugin.");
  }
};
