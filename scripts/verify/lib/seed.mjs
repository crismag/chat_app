/*
 * A library with something in it.
 *
 * Every interesting failure on these screens needs content: a date group needs
 * dates, a truncation bug needs a long title, a completion indicator needs an
 * unfinished reflection. An empty screen passes every check and proves
 * nothing.
 *
 * Written through the API rather than the interface, because this is setup
 * rather than the thing under test — and from whatever page the browser is
 * already on, because a second navigation drops the mobile emulation.
 */

/**
 * A stored passage, fixed rather than fetched.
 *
 * The viewer shows the passage when one is stored, and until now nothing
 * seeded ever stored one — so that whole branch had been written and never
 * seen. The endpoint takes the passage body directly and does not call the
 * provider, which means this fixture is deterministic: no key, no network, and
 * the same words every run.
 *
 * It is written through the API into the same store the browser reads, so it
 * touches nothing that is not part of the seeded guest's own data.
 */
export const PASSAGE = {
  translationId: 111,
  abbreviation: 'NIV',
  name: 'New International Version',
  passageId: 'JHN.3.16',
  reference: 'John 3:16',
  content:
    'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
  copyright: 'Scripture quotations are illustrative fixture text.',
  retrievedAt: '2026-08-20T00:00:00.000Z',
}

/** The reflections the evidence needs, each one there for a reason. */
export const REFLECTIONS = [
  {
    key: 'complete',
    title: 'The comfort and home of God’s love',
    reference: 'John 3:16',
    passage: true,
    sections: {
      content: 'John 3:16 (NIV) — For God so loved the world that he gave his one and only Son.',
      heart: 'I have read this so often that I had stopped hearing it. Today the word “gave” stopped me.',
      application: 'I will read it slowly each morning this week rather than reciting it.',
      testimony: 'He kept me awake for this one, and I am glad he did.',
    },
  },
  {
    key: 'incomplete',
    title: 'Becoming intentional and consistent',
    reference: 'Luke 22:46',
    sections: {
      content: 'Luke 22:46 (NIV) — Why are you sleeping? Get up and pray so that you will not fall into temptation.',
      heart: 'I have slept through this more often than I have prayed through it.',
    },
  },
  {
    key: 'long-title',
    /* Long enough to force the two-line title the card must grow for. */
    title: 'On learning to wait patiently when the answer has not come and the silence feels longer than it is',
    reference: '1 Thessalonians 5:16-18',
    sections: {
      content: '1 Thessalonians 5:16-18 (NIV) — Rejoice always, pray continually, give thanks in all circumstances.',
      heart: 'Waiting has never been the part I am good at, and I think that is rather the point of it.',
      application: 'I will stop asking for the answer and start asking for company while I wait.',
    },
  },
  {
    key: 'content-only',
    /* Preview must fall through H → A → T to Content, and strip the prefix. */
    title: 'A verse to sit with',
    reference: 'Psalm 23:1',
    sections: {
      content: 'Psalm 23:1 (NIV) — The Lord is my shepherd, I lack nothing.',
    },
  },
  {
    key: 'condensed',
    title: 'A short thought on mercy',
    reference: 'Micah 6:8',
    format: 'condensed',
    sections: {
      verse: 'Micah 6:8 (NIV) — Act justly, love mercy, walk humbly with your God.',
      reflection: 'Mercy is the one I keep wanting to hand to myself and withhold from everyone else.',
    },
  },
  {
    key: 'empty',
    title: 'Nothing written yet',
    reference: 'Romans 8:28',
    sections: {},
  },
]

/** Runs in the browser: creates a guest, then the reflections above. */
const SCRIPT = `
  const put = (p, b) => fetch(p, { method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    .then((r) => r.status);
  const post = (p, b) => fetch(p, { method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    .then((r) => r.json());
  const patch = (p, b) => fetch(p, { method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    .then((r) => r.json().catch(() => ({})));

  return (async () => {
    await post('/api/auth/guest', { creationSource: 'REFLECTION_CREATE' });
    const made = {};
    for (const spec of SPECS) {
      const created = await post('/api/conversations', {
        title: spec.title, scriptureReference: spec.reference });
      if (!created || !created.id) continue;
      made[spec.key] = created.id;
      if (spec.format) await patch('/api/conversations/' + created.id, { format: spec.format });
      for (const [type, content] of Object.entries(spec.sections)) {
        await patch('/api/conversations/' + created.id + '/sections', { type, content });
      }
      /* Re-assert the title: creating from a first message can retitle. */
      await patch('/api/conversations/' + created.id, { title: spec.title });
      /* Only where the fixture asks for one, so the absent case is covered too. */
      if (spec.passage) {
        await put('/api/bible/reflections/' + created.id + '/passage', PASSAGE);
      }
    }
    return JSON.stringify(made);
  })();
`

/** Seed the current browser session. Returns key → conversation id. */
export async function seed(driver, specs = REFLECTIONS) {
  const made = await driver.executeScript(
    `const SPECS = ${JSON.stringify(specs)};
     const PASSAGE = ${JSON.stringify(PASSAGE)};
${SCRIPT}`,
  )
  return JSON.parse(made || '{}')
}
