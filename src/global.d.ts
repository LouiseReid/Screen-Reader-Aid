export {};

declare global {
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
    error?: string;
  }

  interface CompanionApi {
    isTrusted: () => Promise<boolean>;
    openAccessibilitySettings: () => Promise<void>;
    getFocusedElement: () => Promise<FocusedElement>;
    onFocusedElement: (callback: (data: FocusedElement) => void) => () => void;
  }

  interface Window {
    companion: CompanionApi;
  }
}
