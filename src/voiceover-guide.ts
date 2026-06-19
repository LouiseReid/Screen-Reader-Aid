/**
 * A small, static quick-reference of the VoiceOver commands a developer most
 * commonly needs while testing a web app. "VO" is the VoiceOver modifier
 * (Control + Option). Key combinations verified against Apple's VoiceOver guide
 * and the Deque / AppleVis references (2026).
 */

export interface VoCommand {
  keys: string;
  action: string;
}

export interface VoCategory {
  title: string;
  commands: VoCommand[];
}

export const VOICEOVER_GUIDE: VoCategory[] = [
  {
    title: 'Getting started',
    commands: [
      { keys: 'Command + F5', action: 'Turn VoiceOver on or off' },
      {
        keys: 'Control + Option',
        action:
          'The VoiceOver modifier, shown as VO below. Hold it together with the other keys.',
      },
      {
        keys: 'VO + ;',
        action: 'Lock or unlock the VO keys so you do not have to hold them',
      },
      { keys: 'VO + H', action: 'Open the VoiceOver Help menu' },
    ],
  },
  {
    title: 'Reading',
    commands: [
      { keys: 'VO + A', action: 'Read everything from the cursor onward' },
      { keys: 'Control', action: 'Stop or pause speech' },
      { keys: 'VO + Z', action: 'Repeat the last thing spoken' },
    ],
  },
  {
    title: 'Moving around',
    commands: [
      { keys: 'VO + Right Arrow', action: 'Move to the next item' },
      { keys: 'VO + Left Arrow', action: 'Move to the previous item' },
      {
        keys: 'VO + Space',
        action: 'Activate the item (click a button, follow a link)',
      },
      {
        keys: 'VO + Shift + Down Arrow',
        action: 'Interact with a group, list, or web area (step inside it)',
      },
      {
        keys: 'VO + Shift + Up Arrow',
        action: 'Stop interacting (step back out)',
      },
    ],
  },
  {
    title: 'Jump by type (web pages)',
    commands: [
      {
        keys: 'VO + U',
        action:
          'Open the rotor, then use arrows to pick a type (headings, links, form controls, landmarks) and move between them',
      },
      { keys: 'VO + Command + H', action: 'Jump to the next heading' },
      { keys: 'VO + Command + L', action: 'Jump to the next link' },
      { keys: 'VO + Command + J', action: 'Jump to the next form control' },
      {
        keys: 'VO + Shift + Command + H',
        action: 'Jump to the previous heading (add Shift to reverse any of these)',
      },
    ],
  },
];
