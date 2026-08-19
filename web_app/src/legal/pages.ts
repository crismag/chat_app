/*
 * The standalone document pages: About, and the four it links to.
 *
 * They live outside the application shell, which redirects anyone without a
 * session to /login. That is deliberate and not merely convenient: a privacy
 * policy, terms, a data-deletion route and a support contact have to be
 * readable by someone who has no account and does not want one — including a
 * platform reviewer checking the URLs before approving sign-in with Google,
 * Facebook or Apple. A policy behind a login is not a published policy.
 *
 * `slug` is the URL and `title` is the heading, in one place, so a route, a
 * link and a page heading cannot drift apart.
 */

export type LegalPageSlug = 'privacy' | 'terms' | 'data-deletion' | 'support';

export interface LegalPageMeta {
  slug: LegalPageSlug;
  title: string;
  /** One line, shown under the link on About. */
  summary: string;
}

export const LEGAL_PAGES: readonly LegalPageMeta[] = [
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    summary: 'What is collected, what is never collected, and who can see what you write.',
  },
  {
    slug: 'terms',
    title: 'Terms of Service',
    summary: 'The agreement between you and C.H.A.T. for using the application.',
  },
  {
    slug: 'data-deletion',
    title: 'Data Deletion',
    summary: 'How to delete your account and everything in it, and what happens when you do.',
  },
  {
    slug: 'support',
    title: 'Support',
    summary: 'How to get help, report a problem, or reach a person.',
  },
];

export function legalPage(slug: LegalPageSlug): LegalPageMeta {
  const found = LEGAL_PAGES.find((page) => page.slug === slug);
  if (!found) throw new Error(`No legal page named ${slug}`);
  return found;
}
