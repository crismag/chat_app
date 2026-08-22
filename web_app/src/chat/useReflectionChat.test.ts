/*
 * The reply thread's rules, tested where they now live.
 *
 * Two of them are easy to lose in a refactor and expensive to lose in use:
 * a failed reply must not disturb the message somebody already sent, and a
 * reply that arrives after they have moved on must not drag them back.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { useReflectionChat } from './useReflectionChat.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function setup(over: { openedId?: () => string | null; reopen?: (id: string) => Promise<unknown> } = {}) {
  const reopen = over.reopen ?? vi.fn(async () => undefined)
  const { result } = renderHook(() =>
    useReflectionChat({
      discussing: null,
      openedId: over.openedId ?? (() => 'c1'),
      reopen,
    }),
  )
  return { result, reopen }
}

test('a reply re-reads the reflection it belongs to, so the answer appears', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) } as Response)),
  )
  const { result, reopen } = setup()

  await act(async () => {
    await result.current.requestReply('c1', 'What does this passage ask of me?')
  })

  expect(reopen).toHaveBeenCalledWith('c1')
  expect(result.current.replying).toBe(false)
  expect(result.current.chatError).toBeNull()
})

test('a reply that lands after they have moved on does not drag them back', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) } as Response)),
  )
  /* They started a different reflection while this one was thinking. */
  const { result, reopen } = setup({ openedId: () => 'c2' })

  await act(async () => {
    await result.current.requestReply('c1', 'A question about the first one.')
  })

  expect(reopen).not.toHaveBeenCalled()
})

test('a failed reply is reported beside the thread and leaves the message alone', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Assistance is unavailable.' }),
      } as Response),
    ),
  )
  const { result, reopen } = setup()

  await act(async () => {
    await result.current.requestReply('c1', 'Something already saved.')
  })

  await waitFor(() => expect(result.current.chatError).toBeTruthy())
  /* Nothing re-read, nothing retried on its own, and no message rewritten. */
  expect(reopen).not.toHaveBeenCalled()
  expect(result.current.replying).toBe(false)
})

test('Try again repeats the last request rather than sending a new message', async () => {
  const fetcher = vi.fn((_input: RequestInfo, _init?: RequestInit) =>
    Promise.resolve({ ok: true, json: async () => ({}) } as Response),
  )
  vi.stubGlobal('fetch', fetcher)
  const { result } = setup()

  await act(async () => {
    await result.current.requestReply('c1', 'The one question.')
  })
  act(() => {
    result.current.retryLast()
  })

  await waitFor(() => expect(fetcher.mock.calls.length).toBe(2))
  /* Both went to assistance; neither posted a second message. */
  for (const [input] of fetcher.mock.calls) {
    expect(String(input)).toContain('/ai/reflection-chat')
  }
})

test('with nothing to repeat, Try again does nothing', () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const { result } = setup()

  act(() => {
    result.current.retryLast()
  })

  expect(fetcher).not.toHaveBeenCalled()
})
