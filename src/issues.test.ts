import { describe, expect, it } from 'vitest';
import { detectIssues } from './issues';

function ids(element: FocusedElement): string[] {
  return detectIssues(element).map((issue) => issue.id);
}

describe('detectIssues', () => {
  it('flags an image with no alternative text', () => {
    const issues = detectIssues({ role: 'AXImage', roleDescription: 'image' });
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('missing-image-alt');
    expect(issues[0].severity).toBe('error');
  });

  it('does not flag an image that has alt text', () => {
    expect(
      ids({ role: 'AXImage', roleDescription: 'image', description: 'Logo' }),
    ).toEqual([]);
  });

  it('flags a button with no accessible name', () => {
    const issues = detectIssues({ role: 'AXButton', roleDescription: 'button' });
    expect(issues[0].id).toBe('missing-control-name');
    expect(issues[0].severity).toBe('error');
  });

  it('does not flag a named button', () => {
    expect(
      ids({ role: 'AXButton', roleDescription: 'button', title: 'Submit' }),
    ).toEqual([]);
  });

  it('flags a link with no accessible name', () => {
    expect(ids({ role: 'AXLink', roleDescription: 'link' })).toContain(
      'missing-control-name',
    );
  });

  it('flags a form field with no label', () => {
    const issues = detectIssues({
      role: 'AXTextField',
      roleDescription: 'text field',
      value: 'typed text',
    });
    expect(issues[0].id).toBe('missing-field-label');
    expect(issues[0].severity).toBe('error');
  });

  it('does not flag a labelled form field', () => {
    expect(
      ids({ role: 'AXTextField', roleDescription: 'text field', title: 'Email' }),
    ).toEqual([]);
  });

  it('flags an empty heading', () => {
    expect(
      ids({ role: 'AXHeading', roleDescription: 'heading', value: '2' }),
    ).toContain('empty-heading');
  });

  it('flags a link whose text is a raw URL', () => {
    const issues = detectIssues({
      role: 'AXLink',
      roleDescription: 'link',
      title: 'https://example.com/page',
    });
    expect(issues.map((i) => i.id)).toContain('link-raw-url');
    expect(issues.map((i) => i.id)).not.toContain('missing-control-name');
  });

  it('flags focus landing on a generic container', () => {
    expect(ids({ role: 'AXGroup', roleDescription: 'group' })).toContain(
      'generic-control',
    );
  });

  it('flags a disabled control that still has focus', () => {
    expect(
      ids({
        role: 'AXButton',
        roleDescription: 'button',
        title: 'Submit',
        enabled: 'false',
      }),
    ).toContain('disabled-focusable');
  });

  it('returns no issues for a clean control', () => {
    expect(
      ids({
        role: 'AXButton',
        roleDescription: 'button',
        title: 'Submit',
        enabled: 'true',
      }),
    ).toEqual([]);
  });

  it('returns no issues for an error result', () => {
    expect(ids({ error: 'No focused element' })).toEqual([]);
  });

  it('each issue carries a severity, message, and learnMoreId', () => {
    const [issue] = detectIssues({ role: 'AXImage', roleDescription: 'image' });
    expect(issue.message.length).toBeGreaterThan(0);
    expect(issue.learnMoreId.length).toBeGreaterThan(0);
    expect(['error', 'warning', 'info']).toContain(issue.severity);
  });
});
