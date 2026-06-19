import { describe, expect, it } from 'vitest';
import { VOICEOVER_GUIDE } from './voiceover-guide';

describe('VOICEOVER_GUIDE', () => {
  it('has at least one category', () => {
    expect(VOICEOVER_GUIDE.length).toBeGreaterThan(0);
  });

  it('every category has a title and at least one command', () => {
    for (const category of VOICEOVER_GUIDE) {
      expect(category.title.trim().length).toBeGreaterThan(0);
      expect(category.commands.length).toBeGreaterThan(0);
    }
  });

  it('every command has non-empty keys and action', () => {
    for (const category of VOICEOVER_GUIDE) {
      for (const command of category.commands) {
        expect(command.keys.trim().length).toBeGreaterThan(0);
        expect(command.action.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('includes the essentials (toggle, modifier, rotor, activate)', () => {
    const allKeys = VOICEOVER_GUIDE.flatMap((c) =>
      c.commands.map((cmd) => cmd.keys),
    );
    expect(allKeys).toContain('Command + F5');
    expect(allKeys).toContain('Control + Option');
    expect(allKeys).toContain('VO + U');
    expect(allKeys).toContain('VO + Space');
  });
});
