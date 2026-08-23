import { Navigate } from 'react-router'
import { ChatPage } from '../chat/ChatPage.tsx'
import { hasSeenIntro } from '../legal/introSeen.ts'

/*
 * `/` on a browser's very first visit, and `/` on every one after that, are
 * two different pages.
 *
 * `/` opening straight into a blank Content field is deliberate and stays
 * true for a returning browser — see the note on `WelcomePage` and `/welcome`
 * about why that is not the front door. What changes here is the *first*
 * visit only: arriving with nothing written and no idea what the four letters
 * mean, and being handed a blank field with no explanation, is not "no wall",
 * it is the product assuming context a brand-new visitor does not have yet.
 *
 * So the very first `/` in a browser goes to `/intro` instead, once — see
 * `IntroPage`, which marks itself seen the moment it is shown, by whatever
 * route it was reached. Every `/` after that opens Reflect exactly as before,
 * for a guest, a signed-in person or nobody at all: this does not depend on
 * who is visiting, only on whether this browser has been introduced.
 */
export function RootEntry() {
  return hasSeenIntro() ? <ChatPage /> : <Navigate to="/intro" replace />
}
