import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ThemeToggle } from './ThemeToggle';

// Mock the theme module
vi.mock('../utils/theme', () => ({
  getTheme: vi.fn(() => 'dark'),
  getResolvedTheme: vi.fn(() => 'dark'),
  setTheme: vi.fn(() => Promise.resolve()),
  subscribe: vi.fn(() => () => {}),
}));

import { getTheme, getResolvedTheme, setTheme, subscribe } from '../utils/theme';

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTheme).mockReturnValue('dark');
    vi.mocked(getResolvedTheme).mockReturnValue('dark');
  });

  afterEach(() => {
    cleanup();
  });

  describe('rendering', () => {
    it('renders three theme buttons', () => {
      render(<ThemeToggle />);

      expect(screen.getByTitle('Light mode')).toBeInTheDocument();
      expect(screen.getByTitle('Dark mode')).toBeInTheDocument();
      expect(screen.getByTitle(/System/)).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(<ThemeToggle className="custom-class" />);

      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('shows dark mode as active by default', () => {
      render(<ThemeToggle />);

      const darkButton = screen.getByTitle('Dark mode');
      expect(darkButton).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows light mode as active when theme is light', () => {
      vi.mocked(getTheme).mockReturnValue('light');

      render(<ThemeToggle />);

      const lightButton = screen.getByTitle('Light mode');
      expect(lightButton).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows system mode as active when theme is system', () => {
      vi.mocked(getTheme).mockReturnValue('system');

      render(<ThemeToggle />);

      const systemButton = screen.getByTitle(/System/);
      expect(systemButton).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows resolved theme in system button title', () => {
      vi.mocked(getTheme).mockReturnValue('system');
      vi.mocked(getResolvedTheme).mockReturnValue('light');

      render(<ThemeToggle />);

      expect(screen.getByTitle('System (light)')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls setTheme with light when light button clicked', async () => {
      render(<ThemeToggle />);

      fireEvent.click(screen.getByTitle('Light mode'));

      await waitFor(() => {
        expect(setTheme).toHaveBeenCalledWith('light');
      });
    });

    it('calls setTheme with dark when dark button clicked', async () => {
      vi.mocked(getTheme).mockReturnValue('light');

      render(<ThemeToggle />);

      fireEvent.click(screen.getByTitle('Dark mode'));

      await waitFor(() => {
        expect(setTheme).toHaveBeenCalledWith('dark');
      });
    });

    it('calls setTheme with system when system button clicked', async () => {
      render(<ThemeToggle />);

      fireEvent.click(screen.getByTitle(/System/));

      await waitFor(() => {
        expect(setTheme).toHaveBeenCalledWith('system');
      });
    });
  });

  describe('subscription', () => {
    it('subscribes to theme changes on mount', () => {
      render(<ThemeToggle />);

      expect(subscribe).toHaveBeenCalled();
    });

    it('unsubscribes on unmount', () => {
      const unsubscribe = vi.fn();
      vi.mocked(subscribe).mockReturnValue(unsubscribe);

      const { unmount } = render(<ThemeToggle />);
      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('has accessible labels for all buttons', () => {
      render(<ThemeToggle />);

      expect(screen.getByLabelText('Light mode')).toBeInTheDocument();
      expect(screen.getByLabelText('Dark mode')).toBeInTheDocument();
      expect(screen.getByLabelText('System preference')).toBeInTheDocument();
    });

    it('uses aria-pressed to indicate selected state', () => {
      vi.mocked(getTheme).mockReturnValue('light');

      render(<ThemeToggle />);

      const lightButton = screen.getByTitle('Light mode');
      const darkButton = screen.getByTitle('Dark mode');
      const systemButton = screen.getByTitle(/System/);

      expect(lightButton).toHaveAttribute('aria-pressed', 'true');
      expect(darkButton).toHaveAttribute('aria-pressed', 'false');
      expect(systemButton).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
