interface BetterGravityDesktopBridge {
  chooseDirectory(): Promise<string | undefined>;
  readonly platform: string;
}

interface Window {
  readonly betterGravityDesktop?: BetterGravityDesktopBridge;
}
