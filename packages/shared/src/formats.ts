/*
 * The two C.H.A.T. content formats, and the rules that govern their length.
 *
 * This lives in `shared` because the same limits must be enforced by the web
 * editor, the mobile editor, the API, the persistence layer, the publication
 * service, the Create renderer, the export service and community sharing. One
 * implementation with many callers is the only arrangement in which those nine
 * places cannot disagree — and the client is a convenience, never the
 * authority. The server validates again with this same code.
 *
 * Two rules here are the ones most likely to be implemented wrong, so they are
 * stated plainly:
 *
 *   1. The COMBINED limit overrides the per-field limits. Every section can sit
 *      under its own maximum while the C.H.A.T. is still invalid.
 *
 *   2. A Condensed C.H.A.T. has NO override for a one-page failure. Not a
 *      checkbox, not an acknowledgement, not a smaller font.
 */

export const CHAT_FORMATS = {
  FULL: 'full',
  CONDENSED: 'condensed',
} as const;

export type ChatFormat = (typeof CHAT_FORMATS)[keyof typeof CHAT_FORMATS];

/** Where a length sits against the limits. */
export const LENGTH_STATUS = {
  /** Within the recommended budget. Nothing is required of the user. */
  RECOMMENDED: 'recommended',
  /** Over the recommended budget but under the hard maximum. */
  EXTENDED: 'extended',
  /** Over a hard maximum, or unrenderable. Blocks completion and publication. */
  INVALID: 'invalid',
} as const;

export type LengthStatus = (typeof LENGTH_STATUS)[keyof typeof LENGTH_STATUS];

export interface FieldLimit {
  recommended: number;
  hard: number;
}

export interface FormatLimits {
  fields: Record<string, FieldLimit>;
  /** The limit that overrides the sum of the fields it covers. */
  combined: FieldLimit & { of: readonly string[] };
  maxPages: number;
  /**
   * Whether exceeding `combined.recommended` can be allowed by the author
   * acknowledging it. False for Condensed, where one page is absolute.
   */
  extensionAllowed: boolean;
}

/*
 * Centrally configurable, as the spec requires. Changing these must never
 * retroactively truncate stored content: previously valid publications stay
 * readable, and only editing and republishing require current compliance.
 */
export const FORMAT_LIMITS: Record<ChatFormat, FormatLimits> = {
  [CHAT_FORMATS.FULL]: {
    fields: {
      title: { recommended: 60, hard: 100 },
      scriptureReference: { recommended: 60, hard: 100 },
      context: { recommended: 400, hard: 700 },
      heart: { recommended: 300, hard: 600 },
      application: { recommended: 300, hard: 600 },
      testimony: { recommended: 300, hard: 600 },
    },
    combined: {
      recommended: 1200,
      hard: 2400,
      of: ['context', 'heart', 'application', 'testimony'],
    },
    maxPages: 2,
    extensionAllowed: true,
  },
  [CHAT_FORMATS.CONDENSED]: {
    fields: {
      title: { recommended: 50, hard: 80 },
      scriptureReference: { recommended: 40, hard: 80 },
      verse: { recommended: 280, hard: 350 },
      reflection: { recommended: 400, hard: 550 },
    },
    combined: { recommended: 600, hard: 800, of: ['verse', 'reflection'] },
    maxPages: 1,
    extensionAllowed: false,
  },
};

/** Sections a completed Full C.H.A.T. must carry. Absent one, it is a draft. */
export const REQUIRED_FULL_FIELDS = [
  'title',
  'scriptureReference',
  'context',
  'heart',
  'application',
  'testimony',
] as const;

/**
 * Fields a completed Condensed C.H.A.T. must carry. `translation` is required
 * only when verse text is quoted — checked separately, since attribution for
 * someone else's translation is a rights question rather than a length one.
 */
export const REQUIRED_CONDENSED_FIELDS = [
  'scriptureReference',
  'verse',
  'reflection',
] as const;

/** A caption travels beside a C.H.A.T. and is never counted as part of it. */
export const SHARING_CAPTION_MAX = 280;

/* ------------------------------------------------------------------ render */

/**
 * The canonical render profile.
 *
 * Character count alone does not decide page count, so length is validated
 * twice and the stricter answer wins. This profile is what the second check
 * measures against, and it belongs here rather than in the Create page because
 * the editor has to predict the same answer the renderer will give.
 */
export interface RenderProfile {
  width: number;
  height: number;
  margin: number;
  /** Type is never reduced below this to make content fit. */
  minFontSize: number;
  minLineHeight: number;
  sectionGap: number;
  /** Space that is not content: header, footer, attribution, page number. */
  reservedHeight: number;
}

/*
 * Calibrated so that the recommended budget actually fits the page it is the
 * budget for. A profile that cannot hold 1,200 characters on one page would
 * mark compliant content as Extended and quietly make the recommendation a lie
 * — which is exactly what the first set of numbers here did.
 *
 * At these values one page holds roughly 1,500 characters of prose, so 1,200
 * fits with room for the section gaps, and the 2,400 hard maximum lands inside
 * two pages.
 */
export const DEFAULT_RENDER_PROFILE: RenderProfile = {
  width: 1080,
  height: 1080,
  margin: 72,
  minFontSize: 26,
  minLineHeight: 1.35,
  sectionGap: 24,
  reservedHeight: 120,
};

/**
 * A deliberately conservative estimate of how many pages content needs.
 *
 * This is an estimate and is named as one. It exists so the editor can warn
 * while typing; the renderer measures for real before anything is published,
 * and the stricter of the two answers is the one that counts. Erring toward
 * "needs another page" is the safe direction — it asks the author to shorten
 * something that might have fitted, rather than promising a fit that fails at
 * export.
 */
export function estimatePages(
  texts: readonly string[],
  profile: RenderProfile = DEFAULT_RENDER_PROFILE,
): number {
  const usableWidth = profile.width - profile.margin * 2;
  const usableHeight = profile.height - profile.margin * 2 - profile.reservedHeight;

  // ~0.52em average advance for a serif at reading sizes.
  const charsPerLine = Math.max(1, Math.floor(usableWidth / (profile.minFontSize * 0.52)));
  const lineHeight = profile.minFontSize * profile.minLineHeight;
  const linesPerPage = Math.max(1, Math.floor(usableHeight / lineHeight));

  let lines = 0;
  for (const text of texts) {
    if (!text.trim()) continue;
    // Hard breaks the author typed cost real lines; they are not free.
    for (const paragraph of text.split('\n')) {
      lines += Math.max(1, Math.ceil(paragraph.length / charsPerLine));
    }
    lines += Math.ceil(profile.sectionGap / lineHeight);
  }

  return Math.max(1, Math.ceil(lines / linesPerPage));
}

/* -------------------------------------------------------------- validation */

export interface FieldReport {
  field: string;
  length: number;
  recommended: number;
  hard: number;
  status: LengthStatus;
}

/**
 * The structured validation response the spec requires an invalid request to
 * return: which field, how long it is, both limits, the combined length, the
 * rendered page count, and what the author has to do about it.
 */
export interface ValidationResult {
  format: ChatFormat;
  status: LengthStatus;
  /** True only when every rule passes and required content is present. */
  publishable: boolean;
  fields: FieldReport[];
  combined: FieldReport;
  pages: number;
  maxPages: number;
  /** Set when the author must acknowledge a two-page Full C.H.A.T. */
  requiresExtensionAcknowledgement: boolean;
  missing: string[];
  corrections: string[];
}

function classify(length: number, limit: FieldLimit): LengthStatus {
  if (length > limit.hard) return LENGTH_STATUS.INVALID;
  if (length > limit.recommended) return LENGTH_STATUS.EXTENDED;
  return LENGTH_STATUS.RECOMMENDED;
}

const lengthOf = (value: unknown): number =>
  typeof value === 'string' ? value.length : 0;

export interface ValidateOptions {
  /** The author has accepted a two-page Full C.H.A.T. Ignored for Condensed. */
  extensionAcknowledged?: boolean;
  profile?: RenderProfile;
  /** Verse text is quoted, so a translation must be named. */
  quotesVerseText?: boolean;
}

/**
 * Validate a draft against its format.
 *
 * Returns a report rather than throwing: the editor needs to show status while
 * typing, and an author part-way through a sentence is not an error.
 */
export function validateChat(
  format: ChatFormat,
  draft: Record<string, unknown>,
  options: ValidateOptions = {},
): ValidationResult {
  const limits = FORMAT_LIMITS[format];
  const corrections: string[] = [];

  const fields: FieldReport[] = Object.entries(limits.fields).map(
    ([field, limit]) => {
      const length = lengthOf(draft[field]);
      const status = classify(length, limit);
      if (status === LENGTH_STATUS.INVALID) {
        corrections.push(
          `Shorten ${field} by ${length - limit.hard} characters (${length}/${limit.hard}).`,
        );
      }
      return { field, length, recommended: limit.recommended, hard: limit.hard, status };
    },
  );

  const combinedLength = limits.combined.of.reduce(
    (total, field) => total + lengthOf(draft[field]),
    0,
  );
  const combined: FieldReport = {
    field: limits.combined.of.join(' + '),
    length: combinedLength,
    recommended: limits.combined.recommended,
    hard: limits.combined.hard,
    status: classify(combinedLength, limits.combined),
  };

  if (combined.status === LENGTH_STATUS.INVALID) {
    corrections.push(
      `Shorten the combined content by ${combinedLength - limits.combined.hard} characters (${combinedLength}/${limits.combined.hard}).`,
    );
  }

  const pages = estimatePages(
    limits.combined.of.map((field) => String(draft[field] ?? '')),
    options.profile,
  );
  if (pages > limits.maxPages) {
    corrections.push(
      limits.maxPages === 1
        ? 'This must fit one page. Shorten the verse or the reflection, or choose another layout.'
        : `This needs ${pages} pages and may use at most ${limits.maxPages}.`,
    );
  }

  const required: readonly string[] =
    format === CHAT_FORMATS.FULL ? REQUIRED_FULL_FIELDS : REQUIRED_CONDENSED_FIELDS;
  const missing: string[] = required.filter(
    (field) => !String(draft[field] ?? '').trim(),
  );

  if (
    format === CHAT_FORMATS.CONDENSED &&
    options.quotesVerseText &&
    !String(draft['translation'] ?? '').trim()
  ) {
    missing.push('translation');
    corrections.push('Name the Bible translation for the quoted verse.');
  }

  /*
   * A Full C.H.A.T. over its recommended budget is Extended, and Extended is a
   * decision the author has to make rather than one the app makes for them.
   * Condensed never reaches here: `extensionAllowed` is false, so anything over
   * its budget that will not render on one page is simply invalid.
   */
  const overRecommended =
    combined.status === LENGTH_STATUS.EXTENDED || pages > 1;
  const requiresExtensionAcknowledgement =
    limits.extensionAllowed && overRecommended && !options.extensionAcknowledged;

  if (requiresExtensionAcknowledgement) {
    corrections.push(
      'This C.H.A.T. exceeds the recommended one-page length and may be presented as two pages. Allow it to use two pages, or shorten it.',
    );
  }

  const invalid =
    fields.some((f) => f.status === LENGTH_STATUS.INVALID) ||
    combined.status === LENGTH_STATUS.INVALID ||
    pages > limits.maxPages;

  const status: LengthStatus = invalid
    ? LENGTH_STATUS.INVALID
    : overRecommended
      ? LENGTH_STATUS.EXTENDED
      : LENGTH_STATUS.RECOMMENDED;

  return {
    format,
    status,
    publishable:
      !invalid && missing.length === 0 && !requiresExtensionAcknowledgement,
    fields,
    combined,
    pages,
    maxPages: limits.maxPages,
    requiresExtensionAcknowledgement,
    missing,
    corrections,
  };
}

/**
 * What a counter should show for one field: the count, the limit it is measured
 * against, and whether it has gone past it.
 */
export function counterFor(
  format: ChatFormat,
  field: string,
  value: string,
): FieldReport | null {
  const limit = FORMAT_LIMITS[format].fields[field];
  if (!limit) return null;
  return {
    field,
    length: value.length,
    recommended: limit.recommended,
    hard: limit.hard,
    status: classify(value.length, limit),
  };
}

/**
 * Clamp for input handling — never for storage.
 *
 * The spec forbids silently discarding what someone wrote, so this returns the
 * overflow as well as the kept text. The caller is expected to keep the excess
 * in front of the author, offering to move it to a note or a draft, rather than
 * dropping it on the floor.
 */
export function splitAtLimit(
  format: ChatFormat,
  field: string,
  value: string,
): { kept: string; overflow: string } {
  const limit = FORMAT_LIMITS[format].fields[field];
  if (!limit || value.length <= limit.hard) return { kept: value, overflow: '' };
  return { kept: value.slice(0, limit.hard), overflow: value.slice(limit.hard) };
}
