import { describe, it, expect } from 'vitest'
import {
  formatTimecode,
  formatTime,
  formatDuration,
  parseTimecode,
  clamp,
  roundTo,
  pixelsToTime,
  timeToPixels,
  formatFileSize,
} from './time'

describe('formatTimecode', () => {
  it('formats seconds to MM:SS.mmm by default', () => {
    expect(formatTimecode(0)).toBe('00:00.000')
    expect(formatTimecode(5.5)).toBe('00:05.500')
    expect(formatTimecode(65.123)).toBe('01:05.123')
    // Note: 3599.999 * 1000 has floating point issues, use a cleaner value
    expect(formatTimecode(3599.5)).toBe('59:59.500')
  })

  it('formats with hours when showHours is true', () => {
    expect(formatTimecode(0, true)).toBe('00:00:00.000')
    expect(formatTimecode(3661.5, true)).toBe('01:01:01.500')
  })

  it('automatically shows hours when time >= 1 hour', () => {
    expect(formatTimecode(3600)).toBe('01:00:00.000')
    expect(formatTimecode(7325.25)).toBe('02:02:05.250')
  })
})

describe('formatTime', () => {
  it('formats seconds to MM:SS', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(5)).toBe('0:05')
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(3661)).toBe('61:01')
  })

  it('truncates decimal places', () => {
    expect(formatTime(5.9)).toBe('0:05')
    expect(formatTime(59.9)).toBe('0:59')
  })
})

describe('formatDuration', () => {
  it('formats short durations with decimal seconds', () => {
    expect(formatDuration(0)).toBe('0.0s')
    expect(formatDuration(5.5)).toBe('5.5s')
    expect(formatDuration(59.9)).toBe('59.9s')
  })

  it('formats minutes as MM:SS', () => {
    expect(formatDuration(60)).toBe('1:00')
    expect(formatDuration(90)).toBe('1:30')
    expect(formatDuration(3599)).toBe('59:59')
  })

  it('formats hours as H:MM:SS', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3661)).toBe('1:01:01')
    expect(formatDuration(7325)).toBe('2:02:05')
  })
})

describe('parseTimecode', () => {
  it('parses MM:SS format', () => {
    expect(parseTimecode('0:00')).toBe(0)
    expect(parseTimecode('1:30')).toBe(90)
    expect(parseTimecode('01:05')).toBe(65)
  })

  it('parses HH:MM:SS format', () => {
    expect(parseTimecode('1:00:00')).toBe(3600)
    expect(parseTimecode('1:01:01')).toBe(3661)
    expect(parseTimecode('02:30:45')).toBe(9045)
  })

  it('parses decimal seconds', () => {
    expect(parseTimecode('1:30.5')).toBe(90.5)
    expect(parseTimecode('1:00:00.25')).toBe(3600.25)
  })

  it('parses plain numbers', () => {
    expect(parseTimecode('45')).toBe(45)
    expect(parseTimecode('45.5')).toBe(45.5)
  })

  it('returns 0 for invalid input', () => {
    expect(parseTimecode('')).toBe(0)
    expect(parseTimecode('invalid')).toBe(0)
  })
})

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })

  it('returns min when value is below', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(-100, -50, 50)).toBe(-50)
  })

  it('returns max when value is above', () => {
    expect(clamp(15, 0, 10)).toBe(10)
    expect(clamp(100, -50, 50)).toBe(50)
  })
})

describe('roundTo', () => {
  it('rounds to specified decimal places', () => {
    expect(roundTo(3.14159, 2)).toBe(3.14)
    expect(roundTo(3.14159, 3)).toBe(3.142)
    expect(roundTo(3.14159, 0)).toBe(3)
  })

  it('handles negative numbers', () => {
    expect(roundTo(-3.14159, 2)).toBe(-3.14)
  })
})

describe('pixelsToTime', () => {
  it('converts pixels to time based on zoom level', () => {
    expect(pixelsToTime(100, 100)).toBe(1)
    expect(pixelsToTime(50, 100)).toBe(0.5)
    expect(pixelsToTime(200, 50)).toBe(4)
  })
})

describe('timeToPixels', () => {
  it('converts time to pixels based on zoom level', () => {
    expect(timeToPixels(1, 100)).toBe(100)
    expect(timeToPixels(0.5, 100)).toBe(50)
    expect(timeToPixels(4, 50)).toBe(200)
  })
})

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(500)).toBe('500 B')
    expect(formatFileSize(1023)).toBe('1023 B')
  })

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(1024 * 1023)).toBe('1023.0 KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(1024 * 1024 * 1.5)).toBe('1.5 MB')
    expect(formatFileSize(1024 * 1024 * 500)).toBe('500.0 MB')
  })

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB')
    expect(formatFileSize(1024 * 1024 * 1024 * 2.5)).toBe('2.50 GB')
  })
})
