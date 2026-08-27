interface BetterGravityDesktopBridge {
  detectInstallation(): Promise<string | undefined>;
  chooseDirectory(): Promise<string | undefined>;
  readonly platform: string;
}

interface Window {
  readonly betterGravityDesktop?: BetterGravityDesktopBridge;
}
