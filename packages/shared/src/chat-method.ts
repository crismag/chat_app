import { CHAT_SECTION_TYPES, type ChatSectionType } from './sections.ts';

/*
 * What C.H.A.T. actually is, in the words it was taught in.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The four letters were described in at least four places — the editor's field
 * prompts, the letters on the About page, the meanings handed to the assistant,
 * and the documentation — and each had drifted a little from the method as it
 * was originally written. The drift was not random: every one of them had
 * shortened towards "what do I type here", and two of the four had lost the
 * part that makes the method a method.
 *
 * Application had lost its warning. The original does not merely ask what you
 * will do; it says that biblical knowledge without a commitment to applying it
 * leads only to miscomprehension. Testimony had lost its subject. The original
 * is explicit that it is God-glorifying — about the Lord and His faithfulness —
 * where "what do you believe, declare or pray?" quietly turns it back towards
 * the writer.
 *
 * So the method lives here once, and the places that describe it read from it.
 *
 * ── The one verse that is kept here ─────────────────────────────────────────
 *
 * The method is anchored in Joshua 1:8, and that verse is written out below.
 * It is the single exception to this project's rule against keeping passage
 * text on disk (see the passage store, which will not cache a passage). That
 * rule exists because storing a book, or any substantial part of one, is what
 * a translation's licence is about; one verse quoted with its attribution is
 * not, and the method does not read as a method without it.
 */

export type ChatStep = {
  letter: 'C' | 'H' | 'A' | 'T';
  name: string;
  type: ChatSectionType;
  /** One word for what this step is for, as the original frames it. */
  essence: string;
  /** The method as taught, in prose. */
  description: string;
  /**
   * Questions that belong to the method rather than to any one reflection.
   *
   * These are not the assistant's questions — it is asked to write its own,
   * from what somebody has actually written. These are the ones that are true
   * before anybody has written anything, which is what makes them safe to show
   * on a page and to hand to a model as the shape of a good question.
   */
  questions: readonly string[];
};

export const CHAT_METHOD: readonly ChatStep[] = [
  {
    letter: 'C',
    name: 'Content',
    type: CHAT_SECTION_TYPES.CONTENT,
    essence: 'Focus',
    description:
      'Read the Scripture, and allow God to speak that word to you by focusing on one main thought from your daily reading — not five, not ten. One thing. Highlight a verse or a thought.',
    /* A verb, never a section name: the second section is Heart, not that. */
    questions: [
      'Which single verse or thought are you staying with today?',
      'What made you stop at that one rather than another?',
      'What does the passage plainly say, before you interpret it?',
    ],
  },
  {
    letter: 'H',
    name: 'Heart',
    type: CHAT_SECTION_TYPES.HEART,
    essence: 'Meditate',
    description:
      'Context. Meditate on the Scripture. Observe carefully what the verse says, and take several moments to meditate on it, to let its message soak clear through to your heart.',
    questions: [
      'Who was this said to, and what was happening around it?',
      'What does it say about God, and about the people in it?',
      'What has it stirred, comforted or unsettled in you?',
    ],
  },
  {
    letter: 'A',
    name: 'Application',
    type: CHAT_SECTION_TYPES.APPLICATION,
    essence: 'Personal',
    description:
      'Personal. Application is what seals God’s Word to our hearts. Biblical knowledge without a commitment to applying it to life leads only to miscomprehension.',
    questions: [
      'What does this ask of you, in particular, this week?',
      'What is one thing you will actually do about it?',
      'Where would somebody see this in how you live?',
    ],
  },
  {
    letter: 'T',
    name: 'Testimony',
    type: CHAT_SECTION_TYPES.TESTIMONY,
    essence: 'God-glorifying',
    description:
      'God-glorifying. The focus should be on the Lord and His faithfulness. Testimony is a wonderful way to cement everything that has just happened in your life.',
    questions: [
      'What has God done that you want to remember?',
      'Where have you seen His faithfulness in this?',
      'What would you say to somebody who needed to hear it?',
    ],
  },
] as const;

/**
 * The method in five words, in order.
 *
 * Worth stating because the letters alone read as four boxes to fill. They are
 * a movement: what the passage says, what it means, what it does to you, what
 * you do about it, and what you keep of it afterwards.
 */
export const CHAT_FLOW = [
  'Scripture',
  'Understand',
  'Internalize',
  'Live',
  'Remember and share',
] as const;

/**
 * Where the method is anchored.
 *
 * Everything above is this one verse worked out in practice: keep it on your
 * lips (Content), meditate on it day and night (Heart), be careful to do
 * everything written in it (Application), and what follows from that is what a
 * testimony turns out to be about.
 */
export const CHAT_ANCHOR = {
  reference: 'Joshua 1:8',
  translation: 'NIV',
  text: 'Keep this Book of the Law always on your lips; meditate on it day and night, so that you may be careful to do everything written in it. Then you will be prosperous and successful.',
} as const;

/** The line the original page is headed with. */
export const CHAT_TAGLINE = 'It’s a great day to…';

/** The method's own step, by section, for anything working section by section. */
export const CHAT_METHOD_BY_TYPE = Object.fromEntries(
  CHAT_METHOD.map((step) => [step.type, step]),
) as Record<ChatSectionType, ChatStep>;

/** The same lookup for callers holding a section name that is only a string. */
export function chatStep(type: string): ChatStep | undefined {
  return CHAT_METHOD.find((step) => step.type === type);
}
