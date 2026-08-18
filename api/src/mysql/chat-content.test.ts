import { describe, expect, it } from 'vitest';
import { ChatContentError, validateChatContent } from './chat-content.ts';

describe('chat_content validation', () => {
  it('accepts a FULL payload with the four C.H.A.T. fields', () => {
    expect(
      validateChatContent('FULL', {
        context: 'The passage names the gift.',
        heart: 'I am grateful.',
        application: 'I will tell someone.',
        testimony: 'God met me here.',
      }),
    ).toEqual({
      context: 'The passage names the gift.',
      heart: 'I am grateful.',
      application: 'I will tell someone.',
      testimony: 'God met me here.',
    });
  });

  it('accepts a SHORT payload', () => {
    expect(validateChatContent('SHORT', { reflection: 'God is faithful.' })).toEqual({
      reflection: 'God is faithful.',
    });
  });

  it('rejects a FULL payload missing a field or using the live-app content key', () => {
    expect(() =>
      validateChatContent('FULL', {
        content: 'wrong key',
        heart: 'a',
        application: 'b',
        testimony: 'c',
      }),
    ).toThrow(ChatContentError);
  });

  it('rejects extra keys and non-objects', () => {
    expect(() =>
      validateChatContent('SHORT', { reflection: 'ok', extra: 'no' }),
    ).toThrow(ChatContentError);
    expect(() => validateChatContent('FULL', 'a string')).toThrow(ChatContentError);
  });
});
