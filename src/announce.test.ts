import { describe, expect, it } from 'vitest';
import { describeAnnouncement } from './announce';

describe('describeAnnouncement', () => {
  it('announces a button as "<name>, button"', () => {
    expect(
      describeAnnouncement({
        role: 'AXButton',
        roleDescription: 'button',
        title: 'Submit',
      }).utterance,
    ).toBe('Submit, button');
  });

  it('announces a link', () => {
    expect(
      describeAnnouncement({
        role: 'AXLink',
        roleDescription: 'link',
        title: 'Home',
      }).utterance,
    ).toBe('Home, link');
  });

  it('announces a text field with its value', () => {
    expect(
      describeAnnouncement({
        role: 'AXTextField',
        roleDescription: 'text field',
        title: 'Email',
        value: 'john@example.com',
      }).utterance,
    ).toBe('Email, text field, john@example.com');
  });

  it('announces a checked checkbox', () => {
    expect(
      describeAnnouncement({
        role: 'AXCheckBox',
        roleDescription: 'checkbox',
        title: 'Accept terms',
        value: '1',
      }).utterance,
    ).toBe('Accept terms, checkbox, checked');
  });

  it('announces an unchecked checkbox', () => {
    expect(
      describeAnnouncement({
        role: 'AXCheckBox',
        roleDescription: 'checkbox',
        title: 'Accept terms',
        value: '0',
      }).utterance,
    ).toBe('Accept terms, checkbox, unchecked');
  });

  it('announces a heading with its level', () => {
    expect(
      describeAnnouncement({
        role: 'AXHeading',
        roleDescription: 'heading',
        title: 'Welcome',
        value: '2',
      }).utterance,
    ).toBe('Welcome, heading level 2');
  });

  it('announces an image using its description (alt text)', () => {
    expect(
      describeAnnouncement({
        role: 'AXImage',
        roleDescription: 'image',
        description: 'Company logo',
      }).utterance,
    ).toBe('Company logo, image');
  });

  it('marks a disabled control as dimmed', () => {
    expect(
      describeAnnouncement({
        role: 'AXButton',
        roleDescription: 'button',
        title: 'Submit',
        enabled: 'false',
      }).utterance,
    ).toBe('Submit, dimmed, button');
  });

  it('announces just the role when a control has no accessible name', () => {
    expect(
      describeAnnouncement({
        role: 'AXButton',
        roleDescription: 'button',
        title: '',
      }).utterance,
    ).toBe('button');
  });

  it('reads static text as its content only (no role word)', () => {
    expect(
      describeAnnouncement({
        role: 'AXStaticText',
        roleDescription: 'text',
        value: 'Hello world',
      }).utterance,
    ).toBe('Hello world');
  });

  it('returns an empty utterance for an error result', () => {
    expect(describeAnnouncement({ error: 'No focused element' }).utterance).toBe(
      '',
    );
  });

  it('exposes a breakdown of parts with their source attribute', () => {
    const result = describeAnnouncement({
      role: 'AXButton',
      roleDescription: 'button',
      title: 'Submit',
    });
    expect(result.parts.map((part) => part.text)).toEqual(['Submit', 'button']);
    expect(result.parts[0].source).toContain('title');
  });
});
