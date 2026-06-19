/**
 * Approximates what VoiceOver is *likely* to announce for a focused element,
 * derived from its macOS accessibility attributes.
 *
 * This is an approximation, not VoiceOver's real (private) output: it composes a
 * plausible utterance in the order name -> state -> role -> value, plus an
 * optional hint. The `parts` breakdown records which attribute produced each
 * piece so the UI can explain the "why".
 */

export interface AnnouncementPart {
  text: string;
  source: string;
}

export interface Announcement {
  utterance: string;
  parts: AnnouncementPart[];
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

// Fallback role words when AXRoleDescription is missing.
const ROLE_WORDS: Record<string, string> = {
  AXButton: 'button',
  AXLink: 'link',
  AXCheckBox: 'checkbox',
  AXRadioButton: 'radio button',
  AXTextField: 'text field',
  AXTextArea: 'text area',
  AXPopUpButton: 'pop up button',
  AXHeading: 'heading',
  AXImage: 'image',
};

function isChecked(value: string): boolean {
  return value === '1' || value.toLowerCase() === 'true';
}

export function describeAnnouncement(element: FocusedElement): Announcement {
  if (element.error) {
    return { utterance: '', parts: [] };
  }

  const role = str(element.role);
  const roleDescription = str(element.roleDescription);
  const title = str(element.title);
  const description = str(element.description);
  const value = str(element.value);
  const help = str(element.help);
  const disabled = str(element.enabled) === 'false';

  const roleWord = roleDescription || ROLE_WORDS[role] || '';
  const roleSource = roleDescription ? 'role (roleDescription)' : 'role';

  const parts: AnnouncementPart[] = [];

  // 1. Accessible name.
  let name = '';
  let nameSource = '';
  if (role === 'AXImage') {
    name = description || title;
    nameSource = description ? 'description (alt text)' : 'title';
  } else if (role === 'AXStaticText') {
    name = value || title;
    nameSource = value ? 'value (text)' : 'title';
  } else {
    name = title || description;
    nameSource = title ? 'title' : description ? 'description' : '';
  }
  if (name) {
    parts.push({ text: name, source: `name (${nameSource})` });
  }

  // 2. Disabled state (VoiceOver says "dimmed").
  if (disabled) {
    parts.push({ text: 'dimmed', source: 'state (enabled=false)' });
  }

  // 3. Role + value/state, which vary by control type.
  switch (role) {
    case 'AXStaticText':
      // Plain text: VoiceOver just reads the content, no role word.
      break;

    case 'AXCheckBox': {
      if (roleWord) {
        parts.push({ text: roleWord, source: roleSource });
      }
      const checked = isChecked(value);
      parts.push({
        text: checked ? 'checked' : 'unchecked',
        source: `state (value=${value || '0'})`,
      });
      break;
    }

    case 'AXRadioButton': {
      if (roleWord) {
        parts.push({ text: roleWord, source: roleSource });
      }
      const selected = isChecked(value);
      parts.push({
        text: selected ? 'selected' : 'unselected',
        source: `state (value=${value || '0'})`,
      });
      break;
    }

    case 'AXTextField':
    case 'AXTextArea': {
      if (roleWord) {
        parts.push({ text: roleWord, source: roleSource });
      }
      if (value) {
        parts.push({ text: value, source: 'value (content)' });
      }
      break;
    }

    case 'AXHeading': {
      const level = /^\d+(\.0+)?$/.test(value)
        ? String(parseInt(value, 10))
        : '';
      parts.push({
        text: level ? `heading level ${level}` : 'heading',
        source: level ? `role + level (value=${value})` : 'role',
      });
      break;
    }

    default: {
      if (roleWord) {
        parts.push({ text: roleWord, source: roleSource });
      }
    }
  }

  // 4. Optional hint from help text.
  if (help) {
    parts.push({ text: help, source: 'help (hint)' });
  }

  const utterance = parts
    .map((part) => part.text)
    .filter(Boolean)
    .join(', ');

  return { utterance, parts };
}
