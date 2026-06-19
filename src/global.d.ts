export interface CompanionApi {
  isTrusted: () => Promise<boolean>;
  openAccessibilitySettings: () => Promise<void>;
}

declare global {
  interface Window {
    companion: CompanionApi;
  }
}
