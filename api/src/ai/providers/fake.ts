/*
 * A provider that answers without a network, a key or a model.
 *
 * It exists for three jobs, and it is honest about all three:
 *
 *   1. The test suite. Deterministic answers mean a test asserts on the
 *      application's behaviour rather than on a model's mood, and the whole
 *      route — validation, limits, accept, discard — is exercised for real.
 *   2. Browser verification. The UI can be driven end to end with `AI_PROVIDER=fake`,
 *      so screenshots prove the interface works without spending a request.
 *   3. Failure rehearsal. `FakeProvider` can be told to time out, to return
 *      malformed data or to fall over, because those paths are the ones a
 *      person will actually meet and they must not be theoretical.
 *
 * It never pretends to be Gemini. `name` says `fake`, the status endpoint says
 * `fake`, and the questions it returns are plainly templated.
 */

import { AI_GUIDANCE_NOTICE, AI_OUTCOMES, type AiGuidanceSection } from '@chat/shared';
import { AiFailure } from '../types.ts';
import type {
  AIProvider,
  AiCallOptions,
  ImproveWritingRequest,
  ImproveWritingResult,
  ReflectionChatRequest,
  ReflectionChatResult,
  ReflectionGuidanceRequest,
  ReflectionGuidanceResult,
} from '../types.ts';

/**
 * Templated questions, one to three per section.
 *
 * They are questions and only questions: none of them contains a phrase the
 * writer could paste in as an answer, which is the same rule the real prompt
 * puts on the model. A fake that broke the rule would let a test pass on
 * behaviour the real provider is forbidden.
 */
const QUESTIONS: Record<AiGuidanceSection, string[]> = {
  context: [
    'What is happening immediately before and after this passage?',
    'Who is speaking here, and who are they speaking to?',
  ],
  heart: [
    'Which words in this passage stayed with you, and why those?',
    'Where does this passage meet something you are carrying at the moment?',
  ],
  application: [
    'What would be different this week if you took this seriously?',
    'Is there one specific thing this passage asks of you?',
  ],
  testimony: [
    'What would you want to say you believe, having read this?',
    'Is there something here you would want to pray back?',
  ],
};

export interface FakeProviderBehaviour {
  /** Fail every call with this outcome, instead of answering. */
  failWith?: AiFailure;
  /** Fail the first call only, so retry behaviour can be observed. */
  failOnceWith?: AiFailure;
  /** Never settle until the signal aborts, so a timeout can be observed. */
  hang?: boolean;
  /** Answer improve-writing by asking, rather than by rewording. */
  needsClarification?: string;
}

export class FakeProvider implements AIProvider {
  readonly name = 'fake';
  /** How many times a provider method was entered. Asserted on by tests. */
  calls = 0;
  private readonly behaviour: FakeProviderBehaviour;
  private failuresLeft: number;

  constructor(behaviour: FakeProviderBehaviour = {}) {
    this.behaviour = behaviour;
    this.failuresLeft = behaviour.failOnceWith ? 1 : 0;
  }

  private async gate(options?: AiCallOptions): Promise<void> {
    this.calls += 1;

    if (this.behaviour.failWith) throw this.behaviour.failWith;

    if (this.behaviour.failOnceWith && this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw this.behaviour.failOnceWith;
    }

    if (this.behaviour.hang) {
      await new Promise<never>((_resolve, reject) => {
        const signal = options?.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(new AiFailure(AI_OUTCOMES.TIMEOUT, 'aborted'));
          return;
        }
        signal.addEventListener(
          'abort',
          () => reject(new AiFailure(AI_OUTCOMES.TIMEOUT, 'aborted')),
          { once: true },
        );
      });
    }
  }

  async generateReflectionGuidance(
    request: ReflectionGuidanceRequest,
    options?: AiCallOptions,
  ): Promise<ReflectionGuidanceResult> {
    await this.gate(options);

    const sections: ReflectionGuidanceResult['sections'] = {};
    for (const section of request.sections) {
      const pool = QUESTIONS[section];
      /*
       * A section the writer has already filled gets its second question — the
       * one that follows on — rather than the opening one they have answered.
       */
      const alreadyWritten = (request.written[section] ?? '').trim().length > 0;
      sections[section] = {
        questions: alreadyWritten ? [pool[1] ?? pool[0]!] : pool.slice(0, 2),
      };
    }

    return { sections, notice: AI_GUIDANCE_NOTICE };
  }

  /**
   * A bounded reply, without a model.
   *
   * Plainly templated, and it obeys the two rules the real instruction imposes,
   * because a fake that broke them would let a test pass on behaviour the real
   * provider is forbidden:
   *
   *   1. Anything not about this reflection is declined and redirected, warmly.
   *   2. A request to author the writer's Heart, Application or Testimony is
   *      refused and turned back into a question — including when it arrives
   *      dressed as an instruction to ignore instructions.
   *
   * What this cannot show is that a real model resists persuasion; only a live
   * call speaks to that. What it does show is that the application never
   * *depends* on the model resisting, and that the test asserting so exercises
   * a real code path rather than a stub.
   */
  async discussReflection(
    request: ReflectionChatRequest,
    options?: AiCallOptions,
  ): Promise<ReflectionChatResult> {
    await this.gate(options);

    const message = request.message.toLowerCase();

    const asksForAuthorship =
      /\b(write|compose|draft|create|generate|fill in|make up)\b[\s\S]{0,40}\b(heart|testimony|application)\b/.test(
        message,
      ) || /\bignore\b[\s\S]{0,60}\binstructions?\b/.test(message);

    if (asksForAuthorship) {
      return {
        reply:
          'That part has to be yours — a testimony written for you would not be one. Tell me what happened, even roughly, and I can help you find the words for it. What did this passage stir in you?',
        redirected: false,
      };
    }

    const offTopic =
      /\b(recipe|weather|homework|python|javascript|stock|football|capital of|translate)\b/.test(
        message,
      );

    if (offTopic) {
      return {
        reply: `That is outside what I can help with here — I am only the helper for this reflection. Shall we stay with ${request.passageReference}?`,
        redirected: true,
      };
    }

    const written = Object.entries(request.sections).filter(([, value]) => value?.trim());

    return {
      reply:
        `Looking at ${request.passageReference} with you. ` +
        (written.length > 0
          ? `You have written your ${written.map(([section]) => section).join(' and ')} so far. `
          : 'You have not written any sections yet. ') +
        (request.history.length > 0
          ? `We have said ${request.history.length} things about it already. `
          : '') +
        'What is standing out to you in the passage itself?',
      redirected: false,
    };
  }

  async improveReflectionWriting(
    request: ImproveWritingRequest,
    options?: AiCallOptions,
  ): Promise<ImproveWritingResult> {
    await this.gate(options);

    if (this.behaviour.needsClarification) {
      return {
        outcome: AI_OUTCOMES.NEEDS_USER_CLARIFICATION,
        original: request.text,
        question: this.behaviour.needsClarification,
      };
    }

    /*
     * A minimal, meaning-preserving edit: collapse runs of whitespace, and
     * close the sentence. Nothing is added, nothing is removed, and the first
     * person is untouched — which is exactly what the real instruction demands
     * and what the tests assert about the result.
     */
    const tidied = request.text.replace(/\s+/g, ' ').trim();
    const suggested = /[.!?]$/.test(tidied) ? tidied : `${tidied}.`;

    const summaryOfChanges: string[] = [];
    if (tidied !== request.text.trim()) summaryOfChanges.push('Tidied spacing.');
    if (suggested !== tidied) summaryOfChanges.push('Closed the final sentence.');
    if (summaryOfChanges.length === 0) summaryOfChanges.push('No changes were needed.');

    return {
      outcome: AI_OUTCOMES.OK,
      original: request.text,
      suggested,
      summaryOfChanges,
      meaningChanged: false,
    };
  }
}
