// Bridge injected by electron/preload.cjs when running inside the desktop app.
// Undefined in a plain browser.
export {};

declare global {
  interface Window {
    spear?: {
      isDesktop: boolean;
      checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>;
    };
  }
}
