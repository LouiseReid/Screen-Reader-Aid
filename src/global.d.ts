import type { Settings as SettingsType } from './settings';

export {};

declare global {
  type Settings = SettingsType;

  interface FocusedElement {
    role?: string | null;
    subrole?: string | null;
    roleDescription?: string | null;
    title?: string | null;
    value?: string | number | boolean | null;
    description?: string | null;
    help?: string | null;
    enabled?: string | number | boolean | null;
    focused?: string | number | boolean | null;
    pid?: number;
    bundleId?: string | null;
    appName?: string | null;
    error?: string;
  }

  interface CompanionSettingsApi {
    get: () => Promise<Settings>;
    set: (partial: Partial<Settings>) => Promise<Settings>;
    onChange: (callback: (settings: Settings) => void) => () => void;
  }

  interface CompanionApi {
    isTrusted: () => Promise<boolean>;
    openAccessibilitySettings: () => Promise<void>;
    getFocusedElement: () => Promise<FocusedElement>;
    onFocusedElement: (callback: (data: FocusedElement) => void) => () => void;
    settings: CompanionSettingsApi;
  }

  interface Window {
    companion: CompanionApi;
  }
}
