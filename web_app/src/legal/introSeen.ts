/*
 * Whether this browser has already been shown the intro.
 *
 * A fact about the browser, not the account — a guest, a signed-in person and
 * somebody who has not decided yet all get the same one look at it, and none
 * of them is asked again once they have had it. So this lives in
 * `localStorage` rather than on any account, and is read before anything else
 * about who is visiting is known.
 */

const INTRO_SEEN_KEY = 'chat.intro.seen'

/**
 * Read defensively. A value here was written by an older version of this
 * code, or by hand, or storage may simply be unavailable — private browsing,
 * a blocked origin, a full quota. None of that may be able to trap somebody
 * behind a redirect that never clears, so a storage failure reads as
 * "already seen" rather than looping them back to the intro forever.
 */
export function hasSeenIntro(): boolean {
  try {
    return window.localStorage.getItem(INTRO_SEEN_KEY) === 'seen'
  } catch {
    return true
  }
}

/**
 * Called the moment the intro is shown, not only when somebody presses a
 * button to leave it. Arriving here at all — by the first-open redirect, or
 * later from the header — is what "seen" means; there is no unread state to
 * return to.
 */
export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(INTRO_SEEN_KEY, 'seen')
  } catch {
    /* Storage refused the write. The intro shows again next time, which is
       the same outcome as never having visited — not a failure to report. */
  }
}
