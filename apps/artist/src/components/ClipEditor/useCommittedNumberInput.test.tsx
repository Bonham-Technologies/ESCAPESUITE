// The committed number field (ESCSUITE-256): text is held while the user types
// and only a blur or Enter turns it into a number.
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useCommittedNumberInput } from './useCommittedNumberInput'

type Options = Parameters<typeof useCommittedNumberInput>[0]

function setup(overrides: Partial<Options> = {}) {
  const onCommit = vi.fn()
  const props: Options = { value: 48, min: 8, max: 200, onCommit, ...overrides }
  const view = renderHook((p: Options) => useCommittedNumberInput(p), { initialProps: props })
  const type = (text: string) =>
    act(() => view.result.current.onChange({ target: { value: text } } as ChangeEvent<HTMLInputElement>))
  const key = (k: string) =>
    act(() => view.result.current.onKeyDown({ key: k, preventDefault: () => {} } as KeyboardEvent<HTMLInputElement>))
  const blur = () => act(() => view.result.current.onBlur())
  return { view, onCommit, type, key, blur, props }
}

describe('useCommittedNumberInput', () => {
  it('shows the value as text until the user types', () => {
    const { view } = setup()
    expect(view.result.current.text).toBe('48')
  })

  it('holds typed text without committing', () => {
    const { view, onCommit, type } = setup()
    type('2')
    type('24')
    expect(view.result.current.text).toBe('24')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits the typed number once, on blur', () => {
    const { onCommit, type, blur } = setup()
    type('2')
    type('24')
    blur()
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(24)
  })

  it('commits on Enter', () => {
    const { onCommit, type, key } = setup()
    type('72')
    key('Enter')
    expect(onCommit).toHaveBeenCalledWith(72)
  })

  it('reads scientific notation with Number', () => {
    const { onCommit, type, blur } = setup()
    type('1e2')
    blur()
    expect(onCommit).toHaveBeenCalledWith(100)
  })

  it('clamps to the maximum', () => {
    const { onCommit, type, blur } = setup()
    type('5000')
    blur()
    expect(onCommit).toHaveBeenCalledWith(200)
  })

  it('clamps to the minimum', () => {
    const { onCommit, type, blur } = setup()
    type('4')
    blur()
    expect(onCommit).toHaveBeenCalledWith(8)
  })

  it('reverts an empty field to the value without committing', () => {
    const { view, onCommit, type, blur } = setup()
    type('')
    blur()
    expect(onCommit).not.toHaveBeenCalled()
    expect(view.result.current.text).toBe('48')
  })

  it('reverts text that is not a number, and one that is not finite', () => {
    const { view, onCommit, type, blur } = setup()
    type('abc')
    blur()
    type('1e999')
    blur()
    expect(onCommit).not.toHaveBeenCalled()
    expect(view.result.current.text).toBe('48')
  })

  it('reverts on Escape without committing', () => {
    const { view, onCommit, type, key } = setup()
    type('99')
    key('Escape')
    expect(onCommit).not.toHaveBeenCalled()
    expect(view.result.current.text).toBe('48')
  })

  it('ignores other keys', () => {
    const { view, onCommit, type, key } = setup()
    type('99')
    key('a')
    expect(onCommit).not.toHaveBeenCalled()
    expect(view.result.current.text).toBe('99')
  })

  it('does not commit a number equal to the value, and settles the text', () => {
    const { view, onCommit, type, blur } = setup()
    type('048')
    blur()
    expect(onCommit).not.toHaveBeenCalled()
    expect(view.result.current.text).toBe('48')
  })

  it('does not commit a clamped number that equals the value', () => {
    const { onCommit, type, blur } = setup({ value: 200 })
    type('900')
    blur()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('rounds to an integer when the field is integer-valued', () => {
    const { onCommit, type, blur } = setup({ integer: true })
    type('24.6')
    blur()
    expect(onCommit).toHaveBeenCalledWith(25)
  })

  it('keeps a fraction when the field is not integer-valued', () => {
    const { onCommit, type, blur } = setup()
    type('24.6')
    blur()
    expect(onCommit).toHaveBeenCalledWith(24.6)
  })

  it('follows the value again once committed or reverted', () => {
    const { view, type, blur, props } = setup()
    type('24')
    blur()
    view.rerender({ ...props, value: 24 })
    expect(view.result.current.text).toBe('24')
    view.rerender({ ...props, value: 30 })
    expect(view.result.current.text).toBe('30')
  })
})
