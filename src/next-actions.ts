/**
 * Suggests what a developer should do next with the element VoiceOver is focused
 * on. Maps the element's role/state to the most relevant VoiceOver command(s), so
 * the panel can coach the user through driving the screen reader in context.
 *
 * "VO" is the VoiceOver modifier (Control + Option). Combinations are the same
 * ones verified for the static guide in `voiceover-guide.ts`.
 */

export interface NextHint {
  keys?: string;
  action: string;
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function isOn(value: string): boolean {
  return value === '1' || value.toLowerCase() === 'true';
}

const NEXT_ITEM: NextHint = {
  keys: 'VO + Right Arrow',
  action: 'Move to the next item',
};

const ROTOR: NextHint = {
  keys: 'VO + U',
  action: 'Open the rotor to jump by headings, links, form controls, or landmarks',
};

// Container roles you "interact" with (step inside) to reach their contents.
const CONTAINER_ROLES = new Set([
  'AXGroup',
  'AXWebArea',
  'AXScrollArea',
  'AXList',
  'AXTable',
  'AXOutline',
]);

export function suggestNextActions(element: FocusedElement): NextHint[] {
  if (!element || element.error) {
    return [];
  }

  const role = str(element.role);
  const value = str(element.value);
  const disabled = str(element.enabled) === 'false';

  const hints: NextHint[] = [];

  if (disabled) {
    hints.push({
      action:
        'This control is dimmed (disabled), so VoiceOver users cannot activate it.',
    });
  }

  switch (role) {
    case 'AXButton':
    case 'AXMenuButton':
      hints.push({ keys: 'VO + Space', action: 'Activate this button' });
      break;

    case 'AXPopUpButton':
      hints.push({
        keys: 'VO + Space',
        action: 'Open this pop-up menu, then use the arrow keys to choose',
      });
      break;

    case 'AXLink':
      hints.push({ keys: 'VO + Space', action: 'Follow this link' });
      hints.push({ keys: 'VO + Shift + U', action: 'Hear the link address (URL)' });
      hints.push({ keys: 'VO + Command + L', action: 'Jump to the next link' });
      break;

    case 'AXCheckBox':
      hints.push({
        keys: 'VO + Space',
        action: isOn(value) ? 'Uncheck this checkbox' : 'Check this checkbox',
      });
      break;

    case 'AXRadioButton':
      hints.push({ keys: 'VO + Space', action: 'Select this radio button' });
      hints.push({
        keys: 'VO + Right Arrow',
        action: 'Move through the other options in this group',
      });
      break;

    case 'AXTextField':
    case 'AXTextArea':
      hints.push({
        keys: 'VO + Shift + Down Arrow',
        action: 'Interact with the field, then type your text',
      });
      hints.push({
        keys: 'VO + A',
        action: 'Read back what is currently in the field',
      });
      break;

    case 'AXSlider':
    case 'AXIncrementor':
      hints.push({ keys: 'VO + Up Arrow', action: 'Increase the value' });
      hints.push({ keys: 'VO + Down Arrow', action: 'Decrease the value' });
      break;

    case 'AXHeading':
      hints.push({ keys: 'VO + Command + H', action: 'Jump to the next heading' });
      hints.push({
        keys: 'VO + Shift + Command + H',
        action: 'Jump to the previous heading',
      });
      hints.push(ROTOR);
      break;

    case 'AXImage':
      hints.push({
        action:
          'This is an image. Check the announcement above reads a meaningful description, or nothing if it is decorative.',
      });
      break;

    case 'AXStaticText':
      hints.push({ keys: 'VO + A', action: 'Read continuously from here' });
      break;

    default:
      if (CONTAINER_ROLES.has(role)) {
        hints.push({
          keys: 'VO + Shift + Down Arrow',
          action: 'Step inside this group to reach the items within it',
        });
        hints.push({
          keys: 'VO + Shift + Up Arrow',
          action: 'Step back out when you are done',
        });
      } else {
        hints.push({ keys: 'VO + Space', action: 'Activate this item' });
      }
  }

  hints.push(NEXT_ITEM, ROTOR);

  // De-duplicate by key combination, keeping the first (most relevant) occurrence.
  const seenKeys = new Set<string>();
  return hints.filter((hint) => {
    if (!hint.keys) {
      return true;
    }
    if (seenKeys.has(hint.keys)) {
      return false;
    }
    seenKeys.add(hint.keys);
    return true;
  });
}
