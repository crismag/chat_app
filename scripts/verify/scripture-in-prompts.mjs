/*
 * Does the model invent Scripture when it has none?
 *
 * `BIBLE_SCRIPTURE_IN_PROMPTS` used to default to off, and nothing called
 * `scriptureForPrompt` at all, so every prompt went out carrying a bare
 * reference. That is the condition in which a model does not decline: asked to
 * prepare a Content section for "Habakkuk 3:17-19 NLT" it reconstructs the
 * verse from memory and names the translation, and the writer is one paste away
 * from sharing a false attribution of Scripture.
 *
 * This is the only check in the repository that puts that question to the real
 * model, so it is opt-in twice over, exactly like `ai-live-smoke.mjs`: it needs
 * `GEMINI_API_KEY` in the environment AND `AI_LIVE_TEST=1`. A key exported for
 * ordinary development should not be enough on its own to start spending on it.
 *
 *   AI_LIVE_TEST=1 node scripts/verify/scripture-in-prompts.mjs
 *
 * It talks to the running API rather than to Gemini directly, because the claim
 * being tested is about the prompt this application builds, not about the
 * model. It never prints a key. The passage it fetches is from the World
 * English Bible (id 206), which is public domain, so nothing it prints is
 * anybody's licensed property.
 *
 * Two of its assertions are mechanical and one is not. **Read what it prints.**
 * "No invented verse" is ultimately a judgement about prose.
 */

const API = 'http://localhost:8000/api';
/* Public domain. Nothing printed by this script belongs to a publisher. */
const WEB_TRANSLATION = 206;
const results = [];

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

if (!process.env.GEMINI_API_KEY || process.env.AI_LIVE_TEST !== '1') {
  console.log('Skipped: needs GEMINI_API_KEY in the environment and AI_LIVE_TEST=1.');
  process.exit(0);
}

let cookie = '';

async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

/** Ask for a Content section, the way the chip does. */
async function prepareContent(conversationId) {
  const { status, body } = await call('/ai/reflection-chat', {
    method: 'POST',
    body: {
      conversationId,
      message: 'Prepare my Content section.',
      action: 'draft_section',
      section: 'content',
    },
  });
  if (status !== 200) throw new Error(`reflection-chat answered ${status}`);
  return {
    reply: body.message?.content ?? '',
    draft: body.message?.draftText ?? '',
  };
}

/**
 * Anything that looks like a quoted verse.
 *
 * Deliberately blunt: a long run inside quotation marks, of the kind a
 * reconstructed verse arrives in. It is a signal to read, not a verdict — a
 * model can invent Scripture without quotation marks, and it can legitimately
 * quote the passage it was actually given.
 */
function quotedRuns(text) {
  return [...text.matchAll(/[“"']([^“”"']{40,})[”"']/g)].map((match) => match[1]);
}

/** Translation names a model reaches for when it is filling a gap. */
const TRANSLATIONS = /\b(NIV|NLT|ESV|NASB|NKJV|KJV|NRSV|CSB|MSG|AMP|TPT|GNT|NET)\b/g;

console.log('\n— setting up ---------------------------------------------------');

const email = `scripture${Date.now()}@example.com`;
const registered = await call('/auth/register', {
  method: 'POST',
  body: { email, password: 'password123' },
});
check('registered', registered.status === 201, `status ${registered.status}`);

console.log('\n— A passage with no retrievable text ----------------------------');
console.log('  (a reference on the reflection, and nothing stored against it)\n');

const bare = await call('/conversations', {
  method: 'POST',
  body: { title: 'Living without a passage', scriptureReference: 'Habakkuk 3:17-19 NLT' },
});
const bareId = bare.body.id;
const stored = await call(`/bible/reflections/${bareId}/passage`);
check('nothing is stored against it', stored.body.passage === null);

const withoutText = await prepareContent(bareId);
console.log(`\n  reply:\n    ${withoutText.reply.replace(/\n/g, '\n    ')}`);
console.log(`\n  draft:\n    ${(withoutText.draft || '(none)').replace(/\n/g, '\n    ')}\n`);

const answered = `${withoutText.reply}\n${withoutText.draft}`;
const invented = quotedRuns(answered);
check(
  'no long quotation was produced from nothing',
  invented.length === 0,
  invented.length ? `quoted: ${JSON.stringify(invented[0]).slice(0, 120)}` : '',
);
const named = [...answered.matchAll(TRANSLATIONS)].map((match) => match[0]);
/*
 * Naming a translation to ASK for it is fine — "which translation would you
 * like?" — and naming one as the source of wording it did not have is the
 * failure. The two are told apart by whether wording came with it, which the
 * check above already answers, so this one only reports.
 */
console.log(
  `  translations named: ${named.length ? [...new Set(named)].join(', ') : 'none'}` +
    ' (naming one to ask for it is fine; naming one over invented wording is not)',
);
check(
  'it says what it would need instead of supplying it',
  /would need|which translation|not (been )?given|do not have|don't have|paste|bring (the|it)|choose a passage/i.test(
    answered,
  ),
  '',
);

console.log('\n— A passage that was actually retrieved -------------------------');

const real = await call('/conversations', {
  method: 'POST',
  body: { title: 'Living with a passage', scriptureReference: 'Romans 8:28' },
});
const realId = real.body.id;

const looked = await call(
  `/bible/passages?translationId=${WEB_TRANSLATION}&reference=${encodeURIComponent('Romans 8:28')}`,
);
if (looked.status !== 200) {
  check('the passage could be fetched', false, `status ${looked.status}`);
} else {
  const passage = looked.body.passage;
  const saved = await call(`/bible/reflections/${realId}/passage`, {
    method: 'PUT',
    body: passage,
  });
  check('the passage was saved against the reflection', saved.status === 200);
  console.log(`\n  fetched (${passage.abbreviation}): ${passage.content}\n`);

  const withText = await prepareContent(realId);
  console.log(`  reply:\n    ${withText.reply.replace(/\n/g, '\n    ')}`);
  console.log(`\n  draft:\n    ${(withText.draft || '(none)').replace(/\n/g, '\n    ')}\n`);

  /*
   * The words it was given, not words like them. Five consecutive words from
   * the retrieved text is a low bar deliberately: the author may arrange the
   * reference before or after, and the point is provenance, not layout.
   */
  const words = passage.content.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean);
  const produced = `${withText.reply}\n${withText.draft}`.replace(/[^\p{L}\s]/gu, '');
  let echoed = false;
  for (let i = 0; i + 5 <= words.length; i += 1) {
    if (produced.includes(words.slice(i, i + 5).join(' '))) {
      echoed = true;
      break;
    }
  }
  check('the draft uses the retrieved wording, not a remembered one', echoed);
  /*
   * The abbreviation the reflection actually carries, not a near-miss. The
   * first run of this script produced "(WEB)" against a passage stored as
   * `WEBUS`, because the translation was never sent with the text — the model
   * had inferred it. It is sent now, and this is what proves it.
   */
  check(
    'and it names the translation it was actually given',
    `${withText.reply}\n${withText.draft}`.includes(passage.abbreviation),
    passage.abbreviation,
  );
}

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
