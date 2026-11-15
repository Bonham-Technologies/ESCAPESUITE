// The editor's own `confirm()` (ESCSUITE-448): one question at a time, in a
// module-level slot that `ConfirmDialog` and `App` read.
import { describe, it, expect, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { answerConfirm, confirmAction, useConfirmRequest } from './confirmAction'

afterEach(() => {
  // Never leave a question up for the next test.
  answerConfirm(false)
})

describe('confirmAction', () => {
  it('resolves true when the question is answered yes', async () => {
    const answer = confirmAction('Delete it?', 'Delete')
    answerConfirm(true)
    await expect(answer).resolves.toBe(true)
  })

  it('resolves false when the question is answered no', async () => {
    const answer = confirmAction('Delete it?', 'Delete')
    answerConfirm(false)
    await expect(answer).resolves.toBe(false)
  })

  it('answers a question that is replaced before it is answered with no', async () => {
    const first = confirmAction('First?', 'Delete')
    const second = confirmAction('Second?', 'Remove')

    await expect(first).resolves.toBe(false)
    answerConfirm(true)
    await expect(second).resolves.toBe(true)
  })

  it('ignores an answer when nothing is being asked', () => {
    expect(() => answerConfirm(true)).not.toThrow()
  })
})

describe('useConfirmRequest', () => {
  it('reports the question that is up, and null once it is answered', () => {
    const { result } = renderHook(() => useConfirmRequest())
    expect(result.current).toBeNull()

    act(() => {
      void confirmAction('Start over?', 'Start new project')
    })
    expect(result.current).toEqual(
      expect.objectContaining({ message: 'Start over?', confirmLabel: 'Start new project' })
    )

    act(() => answerConfirm(true))
    expect(result.current).toBeNull()
  })

  it('stops listening once unmounted', () => {
    const { result, unmount } = renderHook(() => useConfirmRequest())
    unmount()

    act(() => {
      void confirmAction('Start over?', 'Start new project')
    })
    expect(result.current).toBeNull()
  })
})
