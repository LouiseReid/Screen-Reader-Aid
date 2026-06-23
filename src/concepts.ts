/**
 * A small knowledge base of accessibility concepts, keyed by the `learnMoreId`
 * that issues (see `issues.ts`) reference. Each entry is a short, contextual
 * explanation the UI can show on demand: what it is, why it matters, and how to
 * fix it in HTML/ARIA. Kept deliberately concise (2-4 sentences per field).
 */

export interface Concept {
  id: string;
  title: string;
  whatItIs: string;
  whyItMatters: string;
  howToFix: string;
}

const CONCEPTS: Record<string, Concept> = {
  'image-alt': {
    id: 'image-alt',
    title: 'Image alternative text',
    whatItIs:
      'Alt text is a short text description of an image that a screen reader reads in place of the picture.',
    whyItMatters:
      'Without it, VoiceOver announces only "image" or the file name, so the user misses whatever meaning the image carries.',
    howToFix:
      'Add an alt attribute, e.g. <img src="chart.png" alt="Sales up 20% in Q3">. If the image is purely decorative, use an empty alt ("") so screen readers skip it.',
  },
  'control-name': {
    id: 'control-name',
    title: 'Accessible name for controls',
    whatItIs:
      'Every control needs an accessible name: the text VoiceOver speaks to identify what the control is.',
    whyItMatters:
      'An unnamed button or link is announced only by its role, like "button", leaving the user to guess what it does.',
    howToFix:
      'Give it visible text (<button>Save</button>). For icon-only controls, use aria-label (<button aria-label="Search">) or aria-labelledby pointing at visible text.',
  },
  'field-label': {
    id: 'field-label',
    title: 'Form field labels',
    whatItIs:
      'A label tells the user what to type into an input, and ties that text to the field programmatically.',
    whyItMatters:
      'Without a real label, VoiceOver announces the field type but not its purpose, so the user does not know what to enter.',
    howToFix:
      'Associate a label with the field: <label for="email">Email</label><input id="email">, or use aria-label / aria-labelledby. A placeholder alone is not a label.',
  },
  'empty-heading': {
    id: 'empty-heading',
    title: 'Empty headings',
    whatItIs:
      'Headings give a page structure, and VoiceOver users navigate by jumping between them.',
    whyItMatters:
      'An empty heading still appears in heading navigation as a blank entry, which is confusing and clutters the list.',
    howToFix:
      'Put text inside the heading (<h2>Pricing</h2>). If the element is not really a section heading, use a non-heading element instead.',
  },
  'link-text': {
    id: 'link-text',
    title: 'Meaningful link text',
    whatItIs:
      'Link text is what VoiceOver reads for a link, and what shows up in the rotor list of links.',
    whyItMatters:
      'A raw URL such as "https://example.com/path?id=123" is slow and confusing to hear, especially out of context in the links list.',
    howToFix:
      'Use descriptive text that makes sense on its own: <a href="...">View your order</a> rather than pasting the URL.',
  },
  'generic-role': {
    id: 'generic-role',
    title: 'Generic containers vs real controls',
    whatItIs:
      'A <div> or <span> with a click handler is just a generic container, not a control that screen readers understand as interactive.',
    whyItMatters:
      'VoiceOver does not announce it as actionable, and keyboard users may not be able to reach or operate it.',
    howToFix:
      'Use a native element (<button>, <a>). If you must use a generic element, add the right role plus keyboard support: role="button", tabindex="0", and key handlers.',
  },
  'disabled-focus': {
    id: 'disabled-focus',
    title: 'Disabled controls and focus',
    whatItIs:
      'A disabled control is one the user is not allowed to interact with.',
    whyItMatters:
      'If focus still lands on it, screen reader and keyboard users can move to something they cannot use, which is confusing.',
    howToFix:
      'Use the disabled attribute on native controls (<button disabled>), which also removes them from the tab order. For custom controls use aria-disabled="true" and keep them out of the focus order.',
  },
};

export function getConcept(id: string): Concept | undefined {
  return CONCEPTS[id];
}
