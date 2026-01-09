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
} from './timeUtils'

describe('formatTimecode', () => {
  it('formats seconds without hours by default', () => {
    expect(formatTimecode(0)).toBe('00:00.000')
    expect(formatTimecode(5.5)).toBe('00:05.500')
    expect(formatTimecode(65.123)).toBe('01:05.123')
  })

  it('formats with hours when seconds exceed 60 minutes', () => {
    expect(formatTimecode(3661.5)).toBe('01:01:01.500')
    expect(formatTimecode(7200)).toBe('02:00:00.000')
  })

  it('forces hours display when showHours is true', () => {
    expect(formatTimecode(5.5, true)).toBe('00:00:05.500')
    expect(formatTimecode(65.123, true)).toBe('00:01:05.123')
  })

  it('handles edge cases', () => {
    expect(formatTimecode(0)).toBe('00:00.000')
    expect(formatTimecode(59.999)).toBe('00:59.999')
    expect(formatTimecode(60)).toBe('01:00.000')
  })
})

describe('formatTime', () => {
  it('formats seconds to MM:SS', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(5)).toBe('0:05')
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(125)).toBe('2:05')
  })

  it('floors decimal seconds', () => {
    expect(formatTime(5.9)).toBe('0:05')
    expect(formatTime(65.999)).toBe('1:05')
  })
})

describe('formatDuration', () => {
  it('formats seconds under 60 with decimal', () => {
    expect(formatDuration(5.5)).toBe('5.5s')
    expect(formatDuration(0)).toBe('0.0s')
    expect(formatDuration(59.9)).toBe('59.9s')
  })

  it('formats minutes under 60 as MM:SS', () => {
    expect(formatDuration(60)).toBe('1:00')
    expect(formatDuration(125)).toBe('2:05')
    expect(formatDuration(3599)).toBe('59:59')
  })

  it('formats hours as H:MM:SS', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3661)).toBe('1:01:01')
    expect(formatDuration(7325)).toBe('2:02:05')
  })
})

describe('parseTimecode', () => {
  it('parses HH:MM:SS format', () => {
    expect(parseTimecode('01:02:03')).toBe(3723)
    expect(parseTimecode('00:00:00')).toBe(0)
    expect(parseTimecode('02:30:45')).toBe(9045)
  })

  it('parses MM:SS format', () => {
    expect(parseTimecode('01:30')).toBe(90)
    expect(parseTimecode('00:05')).toBe(5)
    expect(parseTimecode('10:00')).toBe(600)
  })

  it('parses decimal seconds', () => {
    expect(parseTimecode('01:30.5')).toBe(90.5)
    expect(parseTimecode('5.5')).toBe(5.5)
  })

  it('handles plain numbers', () => {
    expect(parseTimecode('45')).toBe(45)
    expect(parseTimecode('0')).toBe(0)
  })

  it('returns 0 for invalid input', () => {
    expect(parseTimecode('')).toBe(0)
    expect(parseTimecode('abc')).toBe(0)
  })
})

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })

  it('clamps to min when below range', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(-100, 0, 10)).toBe(0)
  })

  it('clamps to max when above range', () => {
    expect(clamp(15, 0, 10)).toBe(10)
    expect(clamp(100, 0, 10)).toBe(10)
  })

  it('works with negative ranges', () => {
    expect(clamp(0, -10, -5)).toBe(-5)
    expect(clamp(-20, -10, -5)).toBe(-10)
    expect(clamp(-7, -10, -5)).toBe(-7)
  })
})

describe('roundTo', () => {
  it('rounds to specified decimal places', () => {
    expect(roundTo(3.14159, 2)).toBe(3.14)
    expect(roundTo(3.14159, 3)).toBe(3.142)
    expect(roundTo(3.14159, 0)).toBe(3)
  })

  it('handles whole numbers', () => {
    expect(roundTo(5, 2)).toBe(5)
    expect(roundTo(10, 0)).toBe(10)
  })

  it('rounds correctly at boundaries', () => {
    expect(roundTo(2.5, 0)).toBe(3)
    expect(roundTo(2.4, 0)).toBe(2)
    expect(roundTo(2.555, 2)).toBe(2.56)
  })
})

describe('pixelsToTime', () => {
  it('converts pixels to time based on pixels per second', () => {
    expect(pixelsToTime(100, 100)).toBe(1)
    expect(pixelsToTime(50, 100)).toBe(0.5)
    expect(pixelsToTime(200, 100)).toBe(2)
  })

  it('handles different zoom levels', () => {
    expect(pixelsToTime(100, 50)).toBe(2)
    expect(pixelsToTime(100, 200)).toBe(0.5)
  })

  it('handles zero pixels', () => {
    expect(pixelsToTime(0, 100)).toBe(0)
  })
})

describe('timeToPixels', () => {
  it('converts time to pixels based on pixels per second', () => {
    expect(timeToPixels(1, 100)).toBe(100)
    expect(timeToPixels(0.5, 100)).toBe(50)
    expect(timeToPixels(2, 100)).toBe(200)
  })

  it('handles different zoom levels', () => {
    expect(timeToPixels(1, 50)).toBe(50)
    expect(timeToPixels(1, 200)).toBe(200)
  })

  it('handles zero time', () => {
    expect(timeToPixels(0, 100)).toBe(0)
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
    expect(formatFileSize(10240)).toBe('10.0 KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatFileSize(100 * 1024 * 1024)).toBe('100.0 MB')
  })

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB')
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB')
  })
})
