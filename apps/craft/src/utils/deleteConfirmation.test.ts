// The question the library's Delete button asks (ESCSUITE-483): named after
// the row, and saying how many files go whenever deleting the row cascades.
import { describe, it, expect } from 'vitest'
import { companionsOf, deleteConfirmation, DELETE_IS_PERMANENT } from './deleteConfirmation'
import type { Recording, RecordingRole } from '../store/types'

function row(id: string, name: string, extra: Partial<Recording> = {}): Recording {
  return {
    id,
    name,
    duration: 5,
    createdAt: 1_000,
    size: 2048,
    hasWebcam: false,
    hasAudio: true,
    ...extra,
  }
}

const primary = row('t', 'Standup', { takeId: 't', role: 'screen' })
const webcam = row('t-cam', 'Standup — webcam', { takeId: 't', role: 'webcam' })
const mic = row('t-mic', 'Standup — microphone', { takeId: 't', role: 'mic' })
const system = row('t-sys', 'Standup — system audio', { takeId: 't', role: 'system' })
const plain = row('p', 'Plain Take')

describe('deleteConfirmation', () => {
  it('asks about a plain take by name, with no file count', () => {
    expect(deleteConfirmation(plain, [plain, primary])).toEqual({
      title: 'Delete "Plain Take"?',
      message: DELETE_IS_PERMANENT,
      confirmLabel: 'Delete',
    })
  })

  it('says how many files a take is and names each, in library order', () => {
    // Out of order on purpose: the question lists them as the library does.
    const list = [system, primary, mic, webcam]
    expect(deleteConfirmation(primary, list).message).toBe(
      "This take is 4 files, and all of them will be deleted: the recording, the webcam track, the microphone track and the system audio track. This can't be undone."
    )
  })

  it('says two files as "a and b"', () => {
    expect(deleteConfirmation(primary, [primary, webcam]).message).toBe(
      "This take is 2 files, and all of them will be deleted: the recording and the webcam track. This can't be undone."
    )
  })

  it('asks about a companion row alone, since deleting it deletes only itself', () => {
    expect(deleteConfirmation(webcam, [primary, webcam, mic])).toEqual({
      title: 'Delete "Standup — webcam"?',
      message: DELETE_IS_PERMANENT,
      confirmLabel: 'Delete',
    })
  })

  it('still counts a part whose role this CRAFT does not know', () => {
    const future = row('t-x', 'Standup — x', { takeId: 't', role: 'hologram' as RecordingRole })
    expect(deleteConfirmation(primary, [primary, future]).message).toBe(
      "This take is 2 files, and all of them will be deleted: the recording and another track. This can't be undone."
    )
  })
})

describe('companionsOf', () => {
  it('is what the delete cascades over: the rows naming the take, minus the take', () => {
    expect(companionsOf('t', [plain, mic, primary, webcam]).map((r) => r.id)).toEqual([
      't-cam',
      't-mic',
    ])
    expect(companionsOf('p', [plain, primary])).toEqual([])
  })
})
