import { Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from '../auth/AuthContext.tsx'
import { AuthPage } from '../auth/AuthPage.tsx'
import { AppShell } from '../shared/layout/AppShell.tsx'
import { ChatPage } from '../chat/ChatPage.tsx'
import { ReflectionsPage } from '../reflections/ReflectionsPage.tsx'
import { CommunityPage } from '../community/CommunityPage.tsx'
import { CreatePage } from '../create/CreatePage.tsx'

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
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
        </Route>
      </Routes>
    </AuthProvider>
  )
}
