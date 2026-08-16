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
