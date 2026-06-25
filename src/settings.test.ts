import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from './settings';

describe('mergeSettings', () => {
  it('returns defaults when input is undefined', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when input is null', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when input is not an object', () => {
    expect(mergeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(42)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when input is an empty object', () => {
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('overrides individual fields and leaves the rest as defaults', () => {
    const result = mergeSettings({ liveTracking: false, opacity: 0.75 });
    expect(result).toEqual({
      ...DEFAULT_SETTINGS,
      liveTracking: false,
      opacity: 0.75,
    });
  });

  it('rejects wrong types per field and falls back to defaults', () => {
    const result = mergeSettings({
      liveTracking: 'yes',
      pinned: 1,
      opacity: 'half',
      hasOnboarded: null,
    });
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps opacity to the 0.3 – 1 range', () => {
    expect(mergeSettings({ opacity: 0 }).opacity).toBe(0.3);
    expect(mergeSettings({ opacity: -1 }).opacity).toBe(0.3);
    expect(mergeSettings({ opacity: 2 }).opacity).toBe(1);
    expect(mergeSettings({ opacity: Number.NaN }).opacity).toBe(
      DEFAULT_SETTINGS.opacity,
    );
    expect(mergeSettings({ opacity: 0.5 }).opacity).toBe(0.5);
  });

  it('ignores unknown fields', () => {
    const result = mergeSettings({
      liveTracking: false,
      somethingElse: 'ignored',
    } as unknown);
    expect(result).toEqual({ ...DEFAULT_SETTINGS, liveTracking: false });
    expect(result).not.toHaveProperty('somethingElse');
  });

  it('accepts a custom defaults object', () => {
    const customDefaults = { ...DEFAULT_SETTINGS, opacity: 0.42 };
    expect(mergeSettings({}, customDefaults).opacity).toBe(0.42);
  });
});
