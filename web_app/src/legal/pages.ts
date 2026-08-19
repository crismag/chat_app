/*
 * The standalone document pages: About, and the documents it links to.
 *
 * They live outside the application shell, which redirects anyone without a
 * session to /login. That is deliberate and not merely convenient: a privacy
 * policy, terms, a disclaimer, a data-deletion route and a support contact
 * have to be readable by someone who has no account and does not want one —
 * including a platform reviewer checking the URLs before approving sign-in
 * with Google, Facebook or Apple. A policy behind a login is not a published
 * policy.
 *
 * The markdown is the source of truth. Titles and dates are read out of the
 * documents themselves rather than repeated here, so a page and the text it
 * shows cannot disagree.
 */

import privacyMarkdown from './content/privacy.md?raw';
import termsMarkdown from './content/terms.md?raw';
import dataDeletionMarkdown from './content/data-deletion.md?raw';
import disclaimerMarkdown from './content/disclaimer.md?raw';

export type LegalPageSlug =
  | 'privacy'
  | 'terms'
  | 'disclaimer'
  | 'data-deletion'
  | 'support';

export interface LegalPageMeta {
  slug: LegalPageSlug;
  /** The name used in navigation, which is shorter than some document titles. */
  label: string;
  /** One line, shown under the link on About. */
  summary: string;
  /** The document, or null where none has been supplied yet. */
  markdown: string | null;
}

export const LEGAL_PAGES: readonly LegalPageMeta[] = [
  {
    slug: 'privacy',
    label: 'Privacy Policy',
    summary: 'What is collected, what is never sold, and who can see what you write.',
    markdown: privacyMarkdown,
  },
  {
    slug: 'terms',
    label: 'Terms & Conditions',
    summary: 'The agreement between you and Reflections for using the service.',
    markdown: termsMarkdown,
  },
  {
    slug: 'disclaimer',
    label: 'Disclaimer',
    summary: 'What Reflections is not: not a church, not counselling, not infallible.',
    markdown: disclaimerMarkdown,
  },
  {
    slug: 'data-deletion',
    label: 'Data Deletion',
    summary: 'How to delete your account and everything in it, and what happens next.',
    markdown: dataDeletionMarkdown,
  },
  {
    slug: 'support',
    label: 'Support',
    summary: 'How to get help, report a problem, or reach a person.',
    markdown: null,
  },
];

export function legalPage(slug: LegalPageSlug): LegalPageMeta {
  const found = LEGAL_PAGES.find((page) => page.slug === slug);
  if (!found) throw new Error(`No legal page named ${slug}`);
  return found;
}
