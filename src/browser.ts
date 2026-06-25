/**
 * Classifies the frontmost macOS app (by bundle identifier) so the UI can warn
 * when the developer is testing in a non-Safari browser. VoiceOver is designed
 * around Safari, so results are most accurate there.
 */

export interface BrowserInfo {
  isBrowser: boolean;
  isSafari: boolean;
  /** Friendly name, e.g. "Google Chrome". Empty for non-browsers / unknown. */
  name: string;
}

interface BrowserEntry {
  id: string;
  name: string;
  isSafari: boolean;
}

// Matched by exact id or by `${id}.` prefix, so channel variants (e.g.
// com.google.Chrome.canary, com.microsoft.edgemac.Beta) resolve to the family.
const BROWSERS: BrowserEntry[] = [
  { id: 'com.apple.Safari', name: 'Safari', isSafari: true },
  {
    id: 'com.apple.SafariTechnologyPreview',
    name: 'Safari Technology Preview',
    isSafari: true,
  },
  { id: 'com.google.Chrome', name: 'Google Chrome', isSafari: false },
  { id: 'org.chromium.Chromium', name: 'Chromium', isSafari: false },
  { id: 'com.microsoft.edgemac', name: 'Microsoft Edge', isSafari: false },
  { id: 'com.brave.Browser', name: 'Brave', isSafari: false },
  { id: 'company.thebrowser.Browser', name: 'Arc', isSafari: false },
  { id: 'org.mozilla.firefox', name: 'Firefox', isSafari: false },
  {
    id: 'org.mozilla.firefoxdeveloperedition',
    name: 'Firefox Developer Edition',
    isSafari: false,
  },
  { id: 'org.mozilla.nightly', name: 'Firefox Nightly', isSafari: false },
  { id: 'com.operasoftware.Opera', name: 'Opera', isSafari: false },
  { id: 'com.operasoftware.OperaGX', name: 'Opera GX', isSafari: false },
  { id: 'com.vivaldi.Vivaldi', name: 'Vivaldi', isSafari: false },
  { id: 'com.duckduckgo.macos.browser', name: 'DuckDuckGo', isSafari: false },
];

const NOT_A_BROWSER: BrowserInfo = {
  isBrowser: false,
  isSafari: false,
  name: '',
};

export function classifyApp(bundleId: string | null | undefined): BrowserInfo {
  const id = (bundleId ?? '').trim();
  if (!id) {
    return { ...NOT_A_BROWSER };
  }
  for (const entry of BROWSERS) {
    if (id === entry.id || id.startsWith(`${entry.id}.`)) {
      return { isBrowser: true, isSafari: entry.isSafari, name: entry.name };
    }
  }
  return { ...NOT_A_BROWSER };
}
