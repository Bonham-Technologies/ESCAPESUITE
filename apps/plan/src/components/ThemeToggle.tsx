import { useState, useEffect } from 'react';
import {
  getTheme,
  getResolvedTheme,
  setTheme,
  subscribe,
  type ThemePreference,
  type ResolvedTheme,
} from '../utils/theme';
import styles from './ThemeToggle.module.css';

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const [preference, setPreference] = useState<ThemePreference>(getTheme);
  const [resolved, setResolved] = useState<ResolvedTheme>(getResolvedTheme);

  useEffect(() => {
    // Subscribe to theme changes (e.g., from system preference changes)
    const unsubscribe = subscribe((newResolved) => {
      setResolved(newResolved);
      setPreference(getTheme());
    });

    return unsubscribe;
  }, []);

  const handleChange = async (newPreference: ThemePreference) => {
    await setTheme(newPreference);
    setPreference(newPreference);
    setResolved(getResolvedTheme());
  };

  return (
    <div className={`${styles.container} ${className || ''}`}>
      <button
        className={`${styles.option} ${preference === 'light' ? styles.active : ''}`}
        onClick={() => handleChange('light')}
        title="Light mode"
        aria-label="Light mode"
        aria-pressed={preference === 'light'}
      >
        <SunIcon />
      </button>
      <button
        className={`${styles.option} ${preference === 'dark' ? styles.active : ''}`}
        onClick={() => handleChange('dark')}
        title="Dark mode"
        aria-label="Dark mode"
        aria-pressed={preference === 'dark'}
      >
        <MoonIcon />
      </button>
      <button
        className={`${styles.option} ${preference === 'system' ? styles.active : ''}`}
        onClick={() => handleChange('system')}
        title={`System (${resolved})`}
        aria-label="System preference"
        aria-pressed={preference === 'system'}
      >
        <SystemIcon />
      </button>
    </div>
  );
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
