import { describe, expect, it } from 'vitest';
import { classifyApp } from './browser';

describe('classifyApp', () => {
  it('treats Safari as a browser that needs no warning', () => {
    const info = classifyApp('com.apple.Safari');
    expect(info).toEqual({ isBrowser: true, isSafari: true, name: 'Safari' });
  });

  it('treats Safari Technology Preview as Safari', () => {
    const info = classifyApp('com.apple.SafariTechnologyPreview');
    expect(info.isBrowser).toBe(true);
    expect(info.isSafari).toBe(true);
  });

  it('flags Chrome as a non-Safari browser', () => {
    expect(classifyApp('com.google.Chrome')).toEqual({
      isBrowser: true,
      isSafari: false,
      name: 'Google Chrome',
    });
  });

  it('resolves Chrome channel variants to the Chrome family', () => {
    expect(classifyApp('com.google.Chrome.canary').name).toBe('Google Chrome');
    expect(classifyApp('com.google.Chrome.beta').isSafari).toBe(false);
  });

  it('resolves Edge channel variants', () => {
    expect(classifyApp('com.microsoft.edgemac.Beta').name).toBe(
      'Microsoft Edge',
    );
  });

  it('recognises other common browsers as non-Safari', () => {
    for (const id of [
      'com.brave.Browser',
      'company.thebrowser.Browser',
      'org.mozilla.firefox',
      'com.operasoftware.Opera',
      'com.vivaldi.Vivaldi',
      'org.chromium.Chromium',
      'com.duckduckgo.macos.browser',
    ]) {
      const info = classifyApp(id);
      expect(info.isBrowser, id).toBe(true);
      expect(info.isSafari, id).toBe(false);
    }
  });

  it('does not flag Firefox Developer Edition as plain Firefox by prefix', () => {
    expect(classifyApp('org.mozilla.firefoxdeveloperedition').name).toBe(
      'Firefox Developer Edition',
    );
  });

  it('returns not-a-browser for native apps', () => {
    expect(classifyApp('com.apple.TextEdit')).toEqual({
      isBrowser: false,
      isSafari: false,
      name: '',
    });
  });

  it('returns not-a-browser for empty / missing bundle ids', () => {
    expect(classifyApp('')).toEqual({
      isBrowser: false,
      isSafari: false,
      name: '',
    });
    expect(classifyApp(null).isBrowser).toBe(false);
    expect(classifyApp(undefined).isBrowser).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(classifyApp('  com.apple.Safari  ').isSafari).toBe(true);
  });
});
