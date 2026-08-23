/*
 * The method has to reach the model, not just the reader.
 *
 * Every place that describes C.H.A.T. has drifted at least once by being
 * shortened, and the prompt is the copy nobody looks at — a label on a page is
 * noticed when it goes wrong, a system instruction is not. These assert that
 * what the method insists on is actually in what gets sent.
 */
import { describe, expect, test } from 'vitest';
import { CHAT_ANCHOR, CHAT_METHOD, chatStep } from '@chat/shared';
import { SYSTEM_INSTRUCTION, buildGuidancePrompt } from './prompt.ts';

describe('the method reaches the model', () => {
  test('the system instruction carries the verse the method comes from', () => {
    expect(SYSTEM_INSTRUCTION).toContain(CHAT_ANCHOR.reference);
    expect(SYSTEM_INSTRUCTION).toContain(CHAT_ANCHOR.text);
  });

  /*
   * The specific failure this guards: a model given a one-line label for T
   * writes an encouraging closing paragraph, because that is what "testimony"
   * means in general use. The method's T is about the Lord and what He has
   * done, and the instruction has to say so in words the model cannot read
   * past.
   */
  test('Testimony is fixed on God rather than on the writer', () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/the Lord and His faithfulness/);
    expect(SYSTEM_INSTRUCTION).toMatch(/not a summary of the reflection/i);
    expect(SYSTEM_INSTRUCTION).toMatch(/inspirational wrap-up/i);
  });

  test('Application keeps the warning that makes it a step and not a question', () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/miscomprehension/);
  });

  test('every letter is described from the one definition', () => {
    for (const step of CHAT_METHOD) {
      expect(SYSTEM_INSTRUCTION).toContain(step.description);
    }
  });
});

describe('guidance requests carry the method for the sections asked about', () => {
  const base = {
    passageReference: 'Psalm 23:1',
    sections: ['testimony'],
    written: {},
  };

  test('the requested section brings its standing questions with it', () => {
    const prompt = buildGuidancePrompt(base, 'nonce');
    const step = chatStep('testimony');
    expect(step).toBeDefined();
    for (const question of step!.questions) expect(prompt).toContain(question);
    expect(prompt).toContain(step!.description);
  });

  /*
   * Sending all four sections' questions when one was asked about is how a
   * guidance answer comes back aimed at the wrong section — plausible, on
   * topic, and about something the writer did not ask for.
   */
  test('the sections that were not asked about stay out of the prompt', () => {
    const prompt = buildGuidancePrompt(base, 'nonce');
    for (const step of CHAT_METHOD) {
      if (step.type === 'testimony') continue;
      for (const question of step.questions) expect(prompt).not.toContain(question);
    }
  });

  test('the standing questions are marked as not to be returned', () => {
    const prompt = buildGuidancePrompt(base, 'nonce');
    expect(prompt).toMatch(/Do not return these/);
  });

  test('an unknown section name cannot break the request', () => {
    const prompt = buildGuidancePrompt({ ...base, sections: ['nonsense'] }, 'nonce');
    expect(prompt).toContain('Sections requested: nonsense.');
  });
});
