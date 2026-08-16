/*
 * One real conversation with the YouVersion Platform API.
 *
 * The only thing in this repository that talks to a Bible provider. It is
 * opt-in TWICE: it runs when `YVP_APP_KEY` is present in the environment *and*
 * `BIBLE_LIVE_TEST=1` is set. Two switches rather than one, because a key
 * exported for ordinary development should not be enough on its own to start
 * making calls against somebody's quota.
 *
 *   set -a; . ~/.config/chat_app/youversion.env; set +a
 *   BIBLE_LIVE_TEST=1 node scripts/verify/bible-live-smoke.mjs
 *
 * ── What it will not print ──────────────────────────────────────────────────
 *
 * Not the key, not a prefix of the key, not its length, not the URL it was sent
 * to, and not the provider's error bodies. This output is the sort of thing
 * that gets pasted into an issue.
 *
 * It also fetches its passage from a PUBLIC DOMAIN translation — the World
 * English Bible, id 206 — so the verse text it prints is nobody's licensed
 * property. The catalog check touches the licensed translations only to confirm
 * their ids and that their copyright notices are present; it prints the first
 * few words of a notice, which is the notice's whole purpose.
 *
 * Do not run it in CI.
 */

const BASE = (process.env.YVP_API_BASE_URL ?? 'https://api.youversion.com/v1').replace(/\/+$/, '');
const KEY = (process.env.YVP_APP_KEY ?? '').trim();

if (!KEY) {
  console.log('skipped: YVP_APP_KEY is not set');
  process.exit(0);
}
if (process.env.BIBLE_LIVE_TEST !== '1') {
  console.log('skipped: set BIBLE_LIVE_TEST=1 to allow real calls');
  process.exit(0);
}

/** A public-domain translation, so the text printed below is free to print. */
const PUBLIC_DOMAIN_ID = 206;

let failures = 0;

function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/**
 * One request.
 *
 * The path is passed in and never logged, because a query string is where a
 * credential ends up when somebody adds one "just to try it". Errors report a
 * status and nothing else.
 */
async function get(path) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'X-YVP-App-Key': KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    return { status: response.status, body: null };
  }
  return { status: response.status, body: await response.json() };
}

console.log('YouVersion live check\n');

/* --- the catalog ---------------------------------------------------------- */

const started = Date.now();
const catalog = await get('/bibles?language_ranges%5B%5D=en&page_size=99');
check('catalog responds', catalog.status === 200, `status ${catalog.status}`);

if (catalog.body) {
  const rows = catalog.body.data ?? [];
  check('catalog is a non-empty list', rows.length > 0, `${rows.length} English translations`);
  check(
    'pagination cursor is absent for English today',
    !catalog.body.next_page_token,
    `next_page_token ${catalog.body.next_page_token === null ? 'null' : 'present'}`,
  );

  /*
   * The fact the whole connector turns on. If this ever reports something other
   * than 111, the preference resolution needs revisiting BEFORE anyone ships —
   * a wrong id here means readers get a Bible they did not choose.
   */
  const niv = rows.find((row) => row.localized_abbreviation === 'NIV');
  check('NIV resolves to id 111', niv?.id === 111, `id ${niv?.id ?? 'not found'}, abbreviation ${niv?.abbreviation ?? '—'}`);
  check(
    'the raw abbreviation is still not "NIV"',
    niv?.abbreviation !== 'NIV',
    `it is ${niv?.abbreviation ?? '—'} — an exact match on "NIV" would find nothing`,
  );

  /* The list endpoint really does omit attribution. This is why the connector
   * hydrates each entry from the single-Bible endpoint. */
  check(
    'the list endpoint omits copyright',
    rows.every((row) => row.copyright === null),
    'attribution must come from GET /bibles/{id}',
  );
}

/* --- more than one language ---------------------------------------------- */

/*
 * The catalog is assembled per language because there is no other way: a
 * request with NO language range is refused outright. That makes the configured
 * language list the whole of what this application can offer, which is worth
 * re-establishing against the real API rather than trusting.
 */
const noRange = await get('/bibles?page_size=99');
check(
  'a request with no language range is refused',
  noRange.status !== 200,
  `status ${noRange.status} — there is no "list everything" call`,
);

for (const [tag, expectedName] of [
  ['tl', 'Filipino'],
  ['ceb', 'Cebuano'],
  ['es', 'Spanish'],
]) {
  const page = await get(`/bibles?language_ranges%5B%5D=${tag}&page_size=99`);
  const rows = page.body?.data ?? [];
  check(
    `${tag} (${expectedName}) has Bibles`,
    page.status === 200 && rows.length > 0,
    rows.map((row) => row.localized_abbreviation ?? row.abbreviation).join(', ') || 'none',
  );
  check(
    `${tag} is named "${expectedName}" for search`,
    new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) === expectedName,
  );
}

/*
 * The sharpest reason this connector never keys anything on an abbreviation.
 *
 * TWO DIFFERENT BIBLES share the raw abbreviation `CCB`: id 9 is Cebuano ("Ang
 * Pulong sa Dios") and id 36 is Chinese ("当代译本"). They are told apart only
 * by `localized_abbreviation` — APD and CCB respectively — and by their
 * language. An interface that displayed the raw abbreviation would show two
 * identical-looking rows for Bibles in unrelated languages, and code that
 * matched on it could resolve either.
 *
 * This is the same hazard as `NIV11` not being `NIV`, in its worst form.
 */
const cebuano = (await get('/bibles?language_ranges%5B%5D=ceb&page_size=99')).body?.data ?? [];
const chinese = (await get('/bibles?language_ranges%5B%5D=zh&page_size=99')).body?.data ?? [];
const cebCCB = cebuano.find((row) => row.abbreviation === 'CCB');
const zhCCB = chinese.find((row) => row.abbreviation === 'CCB');
check(
  'two different Bibles share the raw abbreviation CCB',
  Boolean(cebCCB && zhCCB) && cebCCB.id !== zhCCB.id,
  `Cebuano id ${cebCCB?.id} vs Chinese id ${zhCCB?.id}`,
);
check(
  'their localized abbreviations tell them apart',
  cebCCB?.localized_abbreviation === 'APD' && zhCCB?.localized_abbreviation === 'CCB',
  `${cebCCB?.localized_abbreviation} vs ${zhCCB?.localized_abbreviation} — this is what the picker shows`,
);

/* --- page_size --------------------------------------------------------- */

const oversized = await get('/bibles?language_ranges%5B%5D=en&page_size=100');
check('page_size=100 is refused', oversized.status === 400, `status ${oversized.status} — the ceiling is 99`);

/* --- attribution ---------------------------------------------------------- */

for (const id of [111, 3034, PUBLIC_DOMAIN_ID]) {
  const detail = await get(`/bibles/${id}`);
  const copyright = detail.body?.copyright;
  check(
    `bible ${id} detail carries attribution`,
    detail.status === 200 && typeof copyright === 'string' && copyright.length > 0,
    copyright ? `“${String(copyright).split('\n')[0].slice(0, 60)}…”` : 'no copyright present',
  );
  check(
    `bible ${id} carries a YouVersion link`,
    typeof detail.body?.youversion_deep_link === 'string',
    detail.body?.youversion_deep_link ?? '—',
  );
}

/* --- a passage ------------------------------------------------------------ */

const passage = await get(`/bibles/${PUBLIC_DOMAIN_ID}/passages/PSA.23.1-3`);
check('a three-verse range comes back', passage.status === 200, `status ${passage.status}`);
if (passage.body) {
  check('the response has only id, content and reference', Object.keys(passage.body).sort().join(',') === 'content,id,reference', Object.keys(passage.body).join(', '));
  check('content is plain text, not HTML', !/<[a-z]/i.test(passage.body.content), 'no markup to sanitise');
  check('the canonical reference comes back', typeof passage.body.reference === 'string', passage.body.reference);
  /* Public domain, so printing it costs nobody anything. */
  console.log(`\n  ${passage.body.reference} (WEBUS)\n  ${passage.body.content}\n`);
}

/* --- refusals ------------------------------------------------------------- */

const missingChapter = await get(`/bibles/${PUBLIC_DOMAIN_ID}/passages/JHN.99.1`);
check('a nonexistent chapter is a 404', missingChapter.status === 404, `status ${missingChapter.status}`);
const missingVerse = await get(`/bibles/${PUBLIC_DOMAIN_ID}/passages/JHN.3.999`);
check(
  'a nonexistent verse is a 404',
  missingVerse.status === 404,
  'this is why verse counts are not tabulated locally',
);
const missingVersion = await get('/bibles/999999/passages/JHN.3.16');
check('a nonexistent version is a 404', missingVersion.status === 404, `status ${missingVersion.status}`);

console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`} in ${Date.now() - started}ms`);
process.exit(failures === 0 ? 0 : 1);
