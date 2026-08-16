/*
 * One real call to Gemini. Opt-in twice over, and never part of CI.
 *
 * Everything else in this repository is tested against a deterministic fake,
 * which is correct: a suite that reaches a paid third party is slow, flaky and
 * unrunnable offline. But nothing in a fake can tell you the credential works,
 * the configured model exists, or that structured output comes back in the
 * shape the schema asked for. That is what this is for, and it is the only
 * thing it is for.
 *
 * It refuses to run unless BOTH are true:
 *
 *   GEMINI_API_KEY   is present in the environment
 *   AI_LIVE_TEST=1   is set explicitly
 *
 * Two switches rather than one, because a key exported for ordinary
 * development should never be enough on its own to start spending on it.
 *
 * ── What this script will never do ──
 *
 * It does not read, print, log or write the key anywhere. It does not print the
 * prompt or the response. It reports only: whether the call succeeded, how long
 * it took, how many questions came back, and the token counts. The content is
 * synthetic and impersonal — a passage reference and a plainly invented
 * sentence — so that nothing anyone actually wrote is ever sent by a test.
 */
import { readAiConfig } from '../../api/src/ai/config.ts';

const hasKey = (process.env.GEMINI_API_KEY ?? '').trim().length > 0;
const optedIn = process.env.AI_LIVE_TEST === '1';

if (!hasKey || !optedIn) {
  console.log('Skipped. This test makes a real, billable Gemini call and needs both:');
  console.log(`  GEMINI_API_KEY present : ${hasKey ? 'yes' : 'no'}`);
  console.log(`  AI_LIVE_TEST=1         : ${optedIn ? 'yes' : 'no'}`);
  console.log('\nSet both to run it. Never set AI_LIVE_TEST in CI.');
  process.exit(0);
}

/* Imported only past the guard, so the SDK is not loaded on a skipped run. */
const { GeminiProvider } = await import('../../api/src/ai/providers/gemini.ts');

const config = readAiConfig();
console.log(`Model (from configuration): ${config.model}`);
console.log(`Timeout: ${config.timeoutMs}ms\n`);

/*
 * Synthetic content. Not a real person's reflection, not anyone's real
 * experience, and deliberately flat — a live test is not the place for
 * something someone meant.
 */
const SYNTHETIC = {
  passageReference: 'Psalm 23:1',
  written: { content: 'This is placeholder text written for a connectivity test.' },
};

const provider = new GeminiProvider({ model: config.model, timeoutMs: config.timeoutMs });
let failures = 0;

async function timed(label, run) {
  const started = Date.now();
  try {
    const value = await run();
    console.log(`  PASS  ${label} — ${Date.now() - started}ms`);
    return value;
  } catch (caught) {
    failures += 1;
    /*
     * The outcome code and nothing else. A raw provider message can carry an
     * endpoint, a project identifier or a fragment of what was sent, and this
     * output is the sort of thing that gets pasted into an issue.
     */
    const outcome = caught?.outcome ?? 'unknown';
    console.log(`  FAIL  ${label} — ${Date.now() - started}ms — outcome: ${outcome}`);
    return null;
  }
}

const guidance = await timed('reflection guidance', () =>
  provider.generateReflectionGuidance(
    { ...SYNTHETIC, sections: ['content', 'heart'] },
    { requestId: 'live-smoke' },
  ),
);

if (guidance) {
  const counts = Object.entries(guidance.sections).map(
    ([section, value]) => `${section}:${value.questions.length}`,
  );
  console.log(`        sections returned — ${counts.join(', ')}`);
  console.log(`        tokens — ${JSON.stringify(guidance.usage ?? {})}`);
  const allQuestions = Object.values(guidance.sections).flatMap((s) => s.questions);
  const shaped = allQuestions.every((q) => q.trim().endsWith('?'));
  console.log(`        every result is a question — ${shaped ? 'yes' : 'NO'}`);
  if (!shaped) failures += 1;
}

const improved = await timed('improve writing', () =>
  provider.improveReflectionWriting(
    {
      section: 'content',
      text: 'this is  placeholder text written for a connectivity test and it has no  personal meaning',
      passageReference: SYNTHETIC.passageReference,
    },
    { requestId: 'live-smoke' },
  ),
);

if (improved) {
  /* Lengths and flags. Never the wording — not the input and not the output. */
  console.log(`        outcome — ${improved.outcome}`);
  if (improved.outcome === 'ok') {
    console.log(`        suggested length — ${improved.suggested.length} chars`);
    console.log(`        changes summarised — ${improved.summaryOfChanges.length}`);
  }
  console.log(`        tokens — ${JSON.stringify(improved.usage ?? {})}`);
}

console.log(`\n${failures === 0 ? 'Live smoke test passed.' : `${failures} check(s) failed.`}`);
process.exitCode = failures === 0 ? 0 : 1;
