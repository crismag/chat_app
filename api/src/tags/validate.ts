import {
  TAGS_PER_REFLECTION,
  TAG_REFUSALS,
  TAG_REFUSED_MESSAGE,
  checkTagSyntax,
  type TagCandidate,
  type TagRefusal,
} from '@chat/shared';
import { isTagAllowed } from './moderation.ts';

/*
 * The gate every tag passes before it exists anywhere.
 *
 * normalize → syntax → moderation → accept, in that order and in one function,
 * because the ordering is the security property. A tag that is refused must
 * never have been written down first: not in the registry, not on the content,
 * not in anybody's usage, not in a count. Validating after storing, or in two
 * places that could disagree, is how a refused word ends up ranked.
 *
 * The refusals come back as codes with one shared message. Which rule refused a
 * tag is ours to log; the person is told the same neutral sentence either way,
 * because a message that distinguished "too short" from "not allowed" would let
 * anybody map the word list a few attempts at a time.
 */

export type TagVerdict = {
  /** The tags that may be stored, in the order they were given. */
  accepted: TagCandidate[];
  /** What was refused, and why — for the client to mark, and for logs. */
  refused: { input: string; refusal: TagRefusal }[];
};

/**
 * Validate what somebody typed.
 *
 * Deliberately total: a refused tag does not fail the request. Somebody saving
 * a reflection with four good tags and one bad one keeps the four and is told
 * about the one, because losing a reflection's other work to a word is not a
 * proportionate response to a word.
 */
export function validateTags(raw: readonly string[]): TagVerdict {
  const accepted: TagCandidate[] = [];
  const refused: { input: string; refusal: TagRefusal }[] = [];
  const seen = new Set<string>();

  for (const input of raw) {
    const text = String(input).trim();
    if (!text) continue;

    const syntax = checkTagSyntax(text);
    if (!syntax.ok) {
      refused.push({ input: text, refusal: syntax.refusal });
      continue;
    }

    if (!isTagAllowed(text, syntax.tag)) {
      refused.push({ input: text, refusal: TAG_REFUSALS.NOT_ALLOWED });
      continue;
    }

    /* De-duplicated by canonical key, so one word cannot be counted twice. */
    if (seen.has(syntax.tag)) continue;
    seen.add(syntax.tag);
    accepted.push({ tag: syntax.tag, label: syntax.label });

    if (accepted.length >= TAGS_PER_REFLECTION) break;
  }

  return { accepted, refused };
}

/**
 * The strings a client sent, whatever shape it sent them in.
 *
 * Reflection tags have been stored as `["prayer"]` and as `[{tag,label}]` in
 * different versions, and the editor sends a comma-separated line. Reading all
 * three here means the gate below cannot be bypassed by sending the shape it
 * did not expect.
 */
export function rawTagStrings(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'tag' in item) {
        const record = item as { label?: string; tag: string };
        return String(record.label ?? record.tag);
      }
      return String(item);
    });
  }
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return [];
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return rawTagStrings(parsed);
    } catch {
      /* Not JSON: a typed line, which is what the editor actually sends. */
    }
    return text.split(/[\s,]+/);
  }
  return [];
}

/** The sentence a person reads. One string, whatever the code was. */
export function refusalMessage(): string {
  return TAG_REFUSED_MESSAGE;
}
