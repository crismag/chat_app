import { Route, Routes } from 'react-router'
import { AuthProvider } from '../auth/AuthContext.tsx'
import { AuthPage } from '../auth/AuthPage.tsx'
import { AppShell } from '../shared/layout/AppShell.tsx'
import { ChatPage } from '../chat/ChatPage.tsx'
import { LibraryPage } from '../library/LibraryPage.tsx'
import { CommunityPage } from '../community/CommunityPage.tsx'
import { CreatePage } from '../create/CreatePage.tsx'

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/create" element={<CreatePage />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
