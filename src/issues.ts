/**
 * Heuristic accessibility issue detection for the focused element, derived only
 * from its macOS accessibility attributes. These are reliable-from-AX checks
 * expressed in web/ARIA terms; they are hints to investigate, not a full audit.
 */

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface Issue {
  id: string;
  severity: IssueSeverity;
  message: string;
  learnMoreId: string;
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function accessibleName(element: FocusedElement): string {
  const role = str(element.role);
  if (role === 'AXImage') {
    return str(element.description) || str(element.title);
  }
  if (role === 'AXStaticText') {
    return str(element.value) || str(element.title);
  }
  return str(element.title) || str(element.description);
}

const CONTROL_NAME_ROLES: Record<string, string> = {
  AXButton: 'button',
  AXMenuButton: 'menu button',
  AXPopUpButton: 'pop-up button',
  AXLink: 'link',
  AXCheckBox: 'checkbox',
  AXRadioButton: 'radio button',
  AXComboBox: 'combo box',
};

const FIELD_ROLES = new Set(['AXTextField', 'AXTextArea']);
const GENERIC_ROLES = new Set(['AXGroup', 'AXUnknown', 'AXGenericElement']);

type Rule = (element: FocusedElement) => Issue | null;

const ruleMissingImageAlt: Rule = (element) => {
  if (str(element.role) !== 'AXImage') {
    return null;
  }
  if (accessibleName(element)) {
    return null;
  }
  return {
    id: 'missing-image-alt',
    severity: 'error',
    message:
      'This image has no alternative text, so screen reader users will not know what it shows.',
    learnMoreId: 'image-alt',
  };
};

const ruleMissingControlName: Rule = (element) => {
  const role = str(element.role);
  const word = CONTROL_NAME_ROLES[role];
  if (!word) {
    return null;
  }
  if (accessibleName(element)) {
    return null;
  }
  return {
    id: 'missing-control-name',
    severity: 'error',
    message: `This ${word} has no accessible name, so VoiceOver will only announce its role.`,
    learnMoreId: 'control-name',
  };
};

const ruleMissingFieldLabel: Rule = (element) => {
  if (!FIELD_ROLES.has(str(element.role))) {
    return null;
  }
  if (accessibleName(element)) {
    return null;
  }
  return {
    id: 'missing-field-label',
    severity: 'error',
    message:
      'This form field has no label, so VoiceOver will not say what to enter.',
    learnMoreId: 'field-label',
  };
};

const ruleEmptyHeading: Rule = (element) => {
  if (str(element.role) !== 'AXHeading') {
    return null;
  }
  if (str(element.title) || str(element.description)) {
    return null;
  }
  return {
    id: 'empty-heading',
    severity: 'warning',
    message:
      'This heading has no text, but still appears as an empty entry in VoiceOver heading navigation.',
    learnMoreId: 'empty-heading',
  };
};

const ruleLinkRawUrl: Rule = (element) => {
  if (str(element.role) !== 'AXLink') {
    return null;
  }
  const name = accessibleName(element);
  if (!name) {
    return null;
  }
  if (!/^(https?:\/\/|www\.)/i.test(name)) {
    return null;
  }
  return {
    id: 'link-raw-url',
    severity: 'warning',
    message:
      'This link text is a raw URL, which is hard to follow when read aloud.',
    learnMoreId: 'link-text',
  };
};

const ruleGenericControl: Rule = (element) => {
  if (!GENERIC_ROLES.has(str(element.role))) {
    return null;
  }
  return {
    id: 'generic-control',
    severity: 'warning',
    message:
      'Focus landed on a generic container rather than a real control. Use a native element or a proper ARIA role.',
    learnMoreId: 'generic-role',
  };
};

const ruleDisabledFocusable: Rule = (element) => {
  if (str(element.enabled) !== 'false') {
    return null;
  }
  return {
    id: 'disabled-focusable',
    severity: 'warning',
    message:
      'This control is disabled but focus still reached it. Disabled controls usually should not be focusable.',
    learnMoreId: 'disabled-focus',
  };
};

const RULES: Rule[] = [
  ruleMissingImageAlt,
  ruleMissingControlName,
  ruleMissingFieldLabel,
  ruleEmptyHeading,
  ruleLinkRawUrl,
  ruleGenericControl,
  ruleDisabledFocusable,
];

export function detectIssues(element: FocusedElement): Issue[] {
  if (element.error) {
    return [];
  }
  const issues: Issue[] = [];
  for (const rule of RULES) {
    const issue = rule(element);
    if (issue) {
      issues.push(issue);
    }
  }
  return issues;
}
