import { describe, expect, it } from 'vitest';
import { getConcept } from './concepts';

// Every learnMoreId emitted by issues.ts must resolve to a concept.
const ISSUE_LEARN_MORE_IDS = [
  'image-alt',
  'control-name',
  'field-label',
  'empty-heading',
  'link-text',
  'generic-role',
  'disabled-focus',
];

describe('getConcept', () => {
  it('returns undefined for an unknown id', () => {
    expect(getConcept('not-a-real-concept')).toBeUndefined();
  });

  it('resolves a concept for every issue learnMoreId', () => {
    for (const id of ISSUE_LEARN_MORE_IDS) {
      expect(getConcept(id), `missing concept for "${id}"`).toBeDefined();
    }
  });

  it('every concept has a title and all three explanation fields', () => {
    for (const id of ISSUE_LEARN_MORE_IDS) {
      const concept = getConcept(id)!;
      expect(concept.id).toBe(id);
      expect(concept.title.trim().length).toBeGreaterThan(0);
      expect(concept.whatItIs.trim().length).toBeGreaterThan(0);
      expect(concept.whyItMatters.trim().length).toBeGreaterThan(0);
      expect(concept.howToFix.trim().length).toBeGreaterThan(0);
    }
  });
});
