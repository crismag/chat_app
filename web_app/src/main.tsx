import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { App } from './app/App.tsx'
import { bootstrapNative } from './shared/native/bootstrap.ts'
import { registerServiceWorker } from './shared/pwa/install.ts'

void bootstrapNative()
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
