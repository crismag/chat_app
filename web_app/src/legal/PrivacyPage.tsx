import { ContentPending, DocumentPage } from './DocumentPage.tsx'
import { legalPage } from './pages.ts'

const META = legalPage('privacy')

export function PrivacyPage() {
  return (
    <DocumentPage title={META.title} updated="not yet published">
      <ContentPending page={META.title} />
    </DocumentPage>
  )
}
