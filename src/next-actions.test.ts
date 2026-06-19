import { describe, expect, it } from 'vitest';
import { suggestNextActions } from './next-actions';

function keysOf(element: FocusedElement): string[] {
  return suggestNextActions(element)
    .map((hint) => hint.keys)
    .filter((keys): keys is string => Boolean(keys));
}

describe('suggestNextActions', () => {
  it('returns nothing for an error element', () => {
    expect(suggestNextActions({ error: 'No focused element' })).toEqual([]);
  });

  it('suggests activating a button', () => {
    const hints = suggestNextActions({ role: 'AXButton', title: 'Save' });
    expect(hints[0]).toEqual({ keys: 'VO + Space', action: 'Activate this button' });
  });

  it('suggests following and listing links', () => {
    const keys = keysOf({ role: 'AXLink', title: 'Home' });
    expect(keys).toContain('VO + Space');
    expect(keys).toContain('VO + Command + L');
  });

  it('phrases the checkbox hint based on current state', () => {
    expect(suggestNextActions({ role: 'AXCheckBox', value: '0' })[0].action).toBe(
      'Check this checkbox',
    );
    expect(suggestNextActions({ role: 'AXCheckBox', value: '1' })[0].action).toBe(
      'Uncheck this checkbox',
    );
  });

  it('suggests interacting with a text field', () => {
    const keys = keysOf({ role: 'AXTextField' });
    expect(keys).toContain('VO + Shift + Down Arrow');
  });

  it('suggests heading navigation for a heading', () => {
    const keys = keysOf({ role: 'AXHeading', value: '2' });
    expect(keys).toContain('VO + Command + H');
    expect(keys).toContain('VO + Shift + Command + H');
  });

  it('suggests stepping inside a container role', () => {
    const keys = keysOf({ role: 'AXWebArea' });
    expect(keys).toContain('VO + Shift + Down Arrow');
    expect(keys).toContain('VO + Shift + Up Arrow');
  });

  it('notes when a control is disabled', () => {
    const hints = suggestNextActions({ role: 'AXButton', enabled: 'false' });
    expect(hints[0].action).toMatch(/dimmed/i);
  });

  it('always offers a way to keep moving and the rotor', () => {
    const keys = keysOf({ role: 'AXButton' });
    expect(keys).toContain('VO + Right Arrow');
    expect(keys).toContain('VO + U');
  });

  it('does not repeat the same key combination', () => {
    const keys = keysOf({ role: 'AXLink' });
    expect(new Set(keys).size).toBe(keys.length);
  });
});
