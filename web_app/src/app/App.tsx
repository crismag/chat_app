import { Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from '../auth/AuthContext.tsx'
import { ThemeProvider } from '../shared/theme/ThemeProvider.tsx'
import { AuthPage } from '../auth/AuthPage.tsx'
import { PasswordResetPage } from '../auth/PasswordResetPage.tsx'
import { VerifyEmailPage } from '../auth/VerifyEmailPage.tsx'
import { AppShell } from '../shared/layout/AppShell.tsx'
import { RootEntry } from './RootEntry.tsx'
import { ReflectionsPage } from '../reflections/ReflectionsPage.tsx'
import { ReflectionViewPage } from '../reflections/ReflectionViewPage.tsx'
import { NotesPage } from '../notes/NotesPage.tsx'
import { MessagesPage } from '../messaging/MessagesPage.tsx'
import { CommunityPage } from '../community/CommunityPage.tsx'
import { CommunityManagePage } from '../community/CommunityManagePage.tsx'
import { PublicationPage } from '../community/PublicationPage.tsx'
import { CreatePage } from '../create/CreatePage.tsx'
import { ProfilePage } from '../profile/ProfilePage.tsx'
import { OpenSourceLicencesPage } from '../licenses/OpenSourceLicencesPage.tsx'
import { AboutPage } from '../legal/AboutPage.tsx'
import { WelcomePage } from '../legal/WelcomePage.tsx'
import { IntroPage } from '../legal/IntroPage.tsx'
import { PrivacyPage } from '../legal/PrivacyPage.tsx'
import { TermsPage } from '../legal/TermsPage.tsx'
import { DisclaimerPage } from '../legal/DisclaimerPage.tsx'
import { DataDeletionPage } from '../legal/DataDeletionPage.tsx'
import { SupportPage } from '../legal/SupportPage.tsx'
import { NotFoundPage } from '../shared/ui/NotFoundPage.tsx'
import { DeepLinks } from '../shared/native/DeepLinks.tsx'
import { AccountChoiceProvider } from '../auth/AccountChoice.tsx'

export function App() {
  return (
    <AuthProvider>
      {/*
        Inside the auth provider, because preferences belong to an account:
        signing in must bring this person's theme with them, and signing out
        must leave the browser with its own.
      */}
      <ThemeProvider>
        {/*
        The guest-or-sign-in question, mounted once above every route.

        It is opened by the API client when the server refuses a persistent
        action, so it appears wherever the first one happens to be rather
        than being wired into each page that might be it.
      */}
        <AccountChoiceProvider />
        <DeepLinks />
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          {/*
          Getting back in. Two addresses for one errand: the first is what a
          person reaches from the sign-in form, the second is where the emailed
          link lands. Both outside the shell — somebody who cannot sign in
          cannot be asked to sign in to reach them.
        */}
          <Route path="/forgot-password" element={<PasswordResetPage />} />
          <Route path="/reset-password" element={<PasswordResetPage />} />
          {/*
            Where a confirmation link lands. Outside the shell, like the reset
            pages: somebody opening it from their email may not be signed in on
            this device, and confirming an address does not require that they
            are.
          */}
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/open-source-licenses" element={<OpenSourceLicencesPage />} />
          {/*
          About and the documents it links to sit outside the shell.

          That is the point rather than a convenience: a privacy policy, terms,
          a deletion route and a support contact have to be readable by someone
          with no account — including a platform reviewer checking these URLs
          before approving sign-in with Google, Facebook or Apple. A policy
          behind a login is not a published policy.
        */}
          {/*
          The front door, for a link that has to explain itself: the banner,
          the four letters, and every other page from one place. Not at `/` on
          purpose — that opens straight into writing, and a splash screen in
          front of it on every visit would be the login wall again, wearing a
          different coat. `RootEntry`, below, carries the one exception: a
          browser's very first `/` goes to the intro instead, exactly once.
        */}
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/about" element={<AboutPage />} />
          {/*
          The intro (the C.H.A.T. method, as it was taught), at an address
          that can be sent to somebody who has never heard of the
          application — and, since `RootEntry` sends a brand-new browser's
          first `/` here, usually the very first page Reflections shows
          anyone. Outside the shell for the same reason /welcome is: no
          account, because C.H.A.T. is not ours.
        */}
          <Route path="/intro" element={<IntroPage />} />
          {/*
          Renamed from Method to Intro once it stopped being only a document
          About linked to and became a first visit's front page too. Kept
          resolving here rather than removed: a bookmark, a shared link or a
          platform reviewer's saved URL should not 404 over a rename that is
          ours to absorb.
        */}
          <Route path="/method" element={<Navigate to="/intro" replace />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/disclaimer" element={<DisclaimerPage />} />
          <Route path="/data-deletion" element={<DataDeletionPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<RootEntry />} />
            <Route path="/reflections" element={<ReflectionsPage />} />
            {/*
            A reflection has an address of its own, and it is a reading one.
            Opening something you wrote should not put a caret in it.
          */}
            <Route path="/reflections/:id" element={<ReflectionViewPage />} />
            {/*
            Library was renamed to Reflections. The old path is kept as a
            redirect rather than deleted, because a bookmark or an open tab
            should not 404 over a rename that is ours to absorb.
          */}
            <Route path="/library" element={<Navigate to="/reflections" replace />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:threadId" element={<MessagesPage />} />
            <Route path="/community" element={<CommunityPage />} />
            {/*
            A publication has its own address, and possessing it grants nothing.
            The page asks the server on every visit, so a member reads it and
            someone who has left the community is told it is unavailable — same
            URL, different answer, decided server-side each time.
          */}
            <Route path="/community/publications/:id" element={<PublicationPage />} />
            {/*
              A community the reader belongs to. Creating one used to be the
              last thing the interface offered; this is where the person who
              started it — or anyone they made an owner — looks after it.
            */}
            <Route path="/community/:id" element={<CommunityManagePage />} />
            <Route path="/create" element={<CreatePage />} />
            {/*
            Two paths, one page. `/profile` is "mine" and resolves to the
            handle, so a profile always has a single shareable address rather
            than one URL that means a different person depending on who opens
            it.
          */}
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/profile/:handle" element={<ProfilePage />} />
            {/*
            An unknown URL used to render a blank white document. It is inside
            the shell so the navigation survives the mistake.
          */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ThemeProvider>
    </AuthProvider>
  )
}
