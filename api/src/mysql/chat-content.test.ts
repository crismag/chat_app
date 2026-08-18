import { describe, expect, it } from 'vitest';
import { AUTHOR_ORIGINS } from '@chat/shared';
import { ChatContentError, parseStoredChatContent, validateChatContent } from './chat-content.ts';

const user = (content: string) => ({ content, authorOrigin: AUTHOR_ORIGINS.USER });

describe('chat_content validation', () => {
  it('accepts a FULL payload with the four C.H.A.T. sections', () => {
    const payload = {
      content: user('The passage names the gift.'),
      heart: user('I am grateful.'),
      application: user('I will tell someone.'),
      testimony: user('God met me here.'),
    };
    expect(validateChatContent('FULL', payload)).toEqual(payload);
  });

  it('accepts a SHORT payload with both condensed fields', () => {
    const payload = { verse: user('John 3:16'), reflection: user('God is faithful.') };
    expect(validateChatContent('SHORT', payload)).toEqual(payload);
  });

  it('rejects a SHORT payload that has lost its verse', () => {
    expect(() => validateChatContent('SHORT', { reflection: user('alone') })).toThrow(
      ChatContentError,
    );
  });

  it('rejects the retired section name', () => {
    expect(() =>
      validateChatContent('FULL', {
        context: user('the name this product stopped using'),
        heart: user('a'),
        application: user('b'),
        testimony: user('c'),
      }),
    ).toThrow(ChatContentError);
  });

  it('requires an author origin on every section', () => {
    expect(() =>
      validateChatContent('SHORT', { verse: user('John 3:16'), reflection: { content: 'no origin' } }),
    ).toThrow(ChatContentError);
    expect(() =>
      validateChatContent('SHORT', {
        verse: user('John 3:16'),
        reflection: { content: 'bad origin', authorOrigin: 'borrowed' },
      }),
    ).toThrow(ChatContentError);
  });

  it('rejects extra keys and non-objects', () => {
    expect(() =>
      validateChatContent('SHORT', {
        verse: user('John 3:16'),
        reflection: user('ok'),
        extra: user('no'),
      }),
    ).toThrow(ChatContentError);
    expect(() => validateChatContent('FULL', 'a string')).toThrow(ChatContentError);
  });

  /* The column is LONGTEXT on this server, so what comes back is a string. */
  it('parses a stored payload back through the same rule', () => {
    const payload = { verse: user('John 3:16'), reflection: user('God is faithful.') };
    expect(parseStoredChatContent('SHORT', JSON.stringify(payload))).toEqual(payload);
    expect(() => parseStoredChatContent('SHORT', '{not json')).toThrow(ChatContentError);
  });
});
