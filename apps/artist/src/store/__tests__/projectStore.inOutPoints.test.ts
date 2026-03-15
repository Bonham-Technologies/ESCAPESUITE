import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '../projectStore'

describe('In/Out Points', () => {
  beforeEach(() => {
    // Reset the store before each test
    useEditorStore.getState().resetProject()
    useEditorStore.getState().clearHistory()
  })

  it('should set in point', () => {
    useEditorStore.getState().setInPoint(5)
    expect(useEditorStore.getState().inPoint).toBe(5)
  })

  it('should set out point', () => {
    useEditorStore.getState().setOutPoint(10)
    expect(useEditorStore.getState().outPoint).toBe(10)
  })

  it('should clear in/out points', () => {
    useEditorStore.getState().setInPoint(5)
    useEditorStore.getState().setOutPoint(10)
    useEditorStore.getState().clearInOutPoints()
    expect(useEditorStore.getState().inPoint).toBeNull()
    expect(useEditorStore.getState().outPoint).toBeNull()
  })

  it('should swap if in > out', () => {
    // Set out point first, then set in point after it
    useEditorStore.getState().setOutPoint(5)
    useEditorStore.getState().setInPoint(10)
    // Should swap: in=5, out=10
    expect(useEditorStore.getState().inPoint).toBe(5)
    expect(useEditorStore.getState().outPoint).toBe(10)
  })

  it('should swap if out < in', () => {
    // Set in point first, then set out point before it
    useEditorStore.getState().setInPoint(10)
    useEditorStore.getState().setOutPoint(3)
    // Should swap: in=3, out=10
    expect(useEditorStore.getState().inPoint).toBe(3)
    expect(useEditorStore.getState().outPoint).toBe(10)
  })

  it('should handle setting only in point', () => {
    useEditorStore.getState().setInPoint(7.5)
    expect(useEditorStore.getState().inPoint).toBe(7.5)
    expect(useEditorStore.getState().outPoint).toBeNull()
  })

  it('should handle setting only out point', () => {
    useEditorStore.getState().setOutPoint(12.3)
    expect(useEditorStore.getState().inPoint).toBeNull()
    expect(useEditorStore.getState().outPoint).toBe(12.3)
  })

  it('should clear on resetProject', () => {
    useEditorStore.getState().setInPoint(2)
    useEditorStore.getState().setOutPoint(8)
    useEditorStore.getState().resetProject()
    expect(useEditorStore.getState().inPoint).toBeNull()
    expect(useEditorStore.getState().outPoint).toBeNull()
  })

  it('should not swap when in < out (normal case)', () => {
    useEditorStore.getState().setInPoint(2)
    useEditorStore.getState().setOutPoint(8)
    expect(useEditorStore.getState().inPoint).toBe(2)
    expect(useEditorStore.getState().outPoint).toBe(8)
  })

  it('should allow updating in point to a new value', () => {
    useEditorStore.getState().setInPoint(2)
    useEditorStore.getState().setOutPoint(8)
    useEditorStore.getState().setInPoint(4)
    expect(useEditorStore.getState().inPoint).toBe(4)
    expect(useEditorStore.getState().outPoint).toBe(8)
  })

  it('should allow updating out point to a new value', () => {
    useEditorStore.getState().setInPoint(2)
    useEditorStore.getState().setOutPoint(8)
    useEditorStore.getState().setOutPoint(6)
    expect(useEditorStore.getState().inPoint).toBe(2)
    expect(useEditorStore.getState().outPoint).toBe(6)
  })
})
