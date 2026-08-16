import { Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from '../auth/AuthContext.tsx'
import { AuthPage } from '../auth/AuthPage.tsx'
import { AppShell } from '../shared/layout/AppShell.tsx'
import { ChatPage } from '../chat/ChatPage.tsx'
import { ReflectionsPage } from '../reflections/ReflectionsPage.tsx'
import { CommunityPage } from '../community/CommunityPage.tsx'
import { CreatePage } from '../create/CreatePage.tsx'
import { ProfilePage } from '../profile/ProfilePage.tsx'
import { OpenSourceLicencesPage } from '../licenses/OpenSourceLicencesPage.tsx'

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/open-source-licenses" element={<OpenSourceLicencesPage />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/reflections" element={<ReflectionsPage />} />
          {/*
            Library was renamed to Reflections. The old path is kept as a
            redirect rather than deleted, because a bookmark or an open tab
            should not 404 over a rename that is ours to absorb.
          */}
          <Route path="/library" element={<Navigate to="/reflections" replace />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/create" element={<CreatePage />} />
          {/*
            Two paths, one page. `/profile` is "mine" and resolves to the
            handle, so a profile always has a single shareable address rather
            than one URL that means a different person depending on who opens
            it.
          */}
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:handle" element={<ProfilePage />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
