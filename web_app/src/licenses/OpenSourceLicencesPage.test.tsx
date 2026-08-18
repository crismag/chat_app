import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, test } from 'vitest'
import { OpenSourceLicencesPage } from './OpenSourceLicencesPage.tsx'

test('bundles Create Studio and application notices without a network request', () => {
  render(<MemoryRouter><OpenSourceLicencesPage /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'Open Source Licences' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Fabric.js' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'React' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Capacitor' })).toBeInTheDocument()
  expect(screen.getByText(/remain available without a network connection/i)).toBeInTheDocument()
})
