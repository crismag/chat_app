import { Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from '../auth/AuthContext.tsx'
import { AuthPage } from '../auth/AuthPage.tsx'
import { AppShell } from '../shared/layout/AppShell.tsx'
import { ChatPage } from '../chat/ChatPage.tsx'
import { ReflectionsPage } from '../reflections/ReflectionsPage.tsx'
import { ReflectionViewPage } from '../reflections/ReflectionViewPage.tsx'
import { CommunityPage } from '../community/CommunityPage.tsx'
import { PublicationPage } from '../community/PublicationPage.tsx'
import { CreatePage } from '../create/CreatePage.tsx'
import { ProfilePage } from '../profile/ProfilePage.tsx'
import { OpenSourceLicencesPage } from '../licenses/OpenSourceLicencesPage.tsx'
import { AboutPage } from '../legal/AboutPage.tsx'
import { WelcomePage } from '../legal/WelcomePage.tsx'
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
        The guest-or-sign-in question, mounted once above every route.

        It is opened by the API client when the server refuses a persistent
        action, so it appears wherever the first one happens to be rather
        than being wired into each page that might be it.
      */}
      <AccountChoiceProvider />
      <DeepLinks />
      <Routes>
        <Route path="/login" element={<AuthPage />} />
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
          front of it would be the login wall again, wearing a different coat.
        */}
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/disclaimer" element={<DisclaimerPage />} />
        <Route path="/data-deletion" element={<DataDeletionPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<ChatPage />} />
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
          <Route path="/community" element={<CommunityPage />} />
          {/*
            A publication has its own address, and possessing it grants nothing.
            The page asks the server on every visit, so a member reads it and
            someone who has left the community is told it is unavailable — same
            URL, different answer, decided server-side each time.
          */}
          <Route path="/community/publications/:id" element={<PublicationPage />} />
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
    </AuthProvider>
  )
}
