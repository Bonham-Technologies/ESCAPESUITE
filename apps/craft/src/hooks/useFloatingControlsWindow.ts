// The "Float controls" window (ESCSUITE-400): a Document Picture-in-Picture
// window that stays on top of whatever is being recorded, holding the timer,
// the level meters and the transport buttons. This hook owns the window
// itself; what is drawn in it is `FloatingControls`, which App portals into
// the window's document, and the R / P / S / Esc keys in it are bound by
// `useKeyboardShortcuts`, which App hands the window to.
//
// See docs/reference/keyboard-shortcuts.md ("Float controls").
import { useCallback, useEffect, useRef, useState } from 'react';
import { isEmbedded } from '@escapesuite/shared/config';

/** The window's requested size, in CSS pixels. The ticket's ceiling is 360×160. */
export const FLOATING_WINDOW_SIZE = { width: 360, height: 160 } as const;

/** The floating window's document title, which is also its accessible name. */
export const FLOATING_WINDOW_TITLE = 'ESCAPECRAFT controls';

/** The slice of the Document Picture-in-Picture API this hook uses. */
interface DocumentPictureInPictureApi {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

function documentPictureInPicture(): DocumentPictureInPictureApi | undefined {
  return (window as Window & { documentPictureInPicture?: DocumentPictureInPictureApi })
    .documentPictureInPicture;
}

/**
 * Whether this page can open the floating window at all: the API must exist
 * (feature-detected: Chromium has it, Safari does not), and the page must be
 * the top-level document, because `requestWindow()` throws inside an iframe
 * and CRAFT can be embedded in a host page (`docs/reference/embedding.md`).
 */
export function canFloatControls(): boolean {
  return documentPictureInPicture() !== undefined && !isEmbedded();
}

/**
 * Give the new window's empty document what the page's own has: every
 * stylesheet (cloned in document order, so CSS-module class names and the
 * theme tokens resolve the same way), the language and a title. Nothing is
 * fetched — the single-file build's styles are inline `<style>` elements, and
 * a `<link>` clone points at the same URL the page already loaded.
 */
function prepareFloatingDocument(target: Document): void {
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    target.head.append(target.importNode(node, true));
  }
  target.documentElement.lang = document.documentElement.lang || 'en';
  target.title = FLOATING_WINDOW_TITLE;
}

/** Mirror the page's `data-theme` (set by the shared theme module) onto the window. */
function copyTheme(target: Document): void {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === null) {
    target.documentElement.removeAttribute('data-theme');
  } else {
    target.documentElement.setAttribute('data-theme', theme);
  }
}

export interface FloatingControlsWindow {
  /** False where the window cannot be opened; the button is then not drawn. */
  supported: boolean;
  /** The open window, or null. */
  floatingWindow: Window | null;
  /** Open the window, or close it if it is open. */
  toggle: () => void;
}

export function useFloatingControlsWindow(): FloatingControlsWindow {
  const [floatingWindow, setFloatingWindow] = useState<Window | null>(null);
  // A window that finishes opening after App has unmounted has nobody to draw
  // into it, so it is closed on arrival instead of being left on screen.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const open = useCallback(async () => {
    let opened: Window;
    try {
      opened = await documentPictureInPicture()!.requestWindow(FLOATING_WINDOW_SIZE);
    } catch (error) {
      // Refused (no user activation, or the browser said no): the page's own
      // controls are untouched, so there is nothing to undo.
      console.warn('Could not open the floating controls window', error);
      return;
    }
    if (!mountedRef.current) {
      opened.close();
      return;
    }
    prepareFloatingDocument(opened.document);
    // Closing the window — its own close button, or the page's toggle — ends
    // nothing but the window: the take carries on, and the page gets focus
    // back so its own shortcuts answer again.
    opened.addEventListener(
      'pagehide',
      () => {
        setFloatingWindow(null);
        window.focus();
      },
      { once: true }
    );
    setFloatingWindow(opened);
  }, []);

  useEffect(() => {
    if (!floatingWindow) return;
    const target = floatingWindow.document;
    copyTheme(target);
    const observer = new MutationObserver(() => copyTheme(target));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
      // Unmount, or the window already gone: close() on a closed window is a no-op.
      floatingWindow.close();
    };
  }, [floatingWindow]);

  const toggle = useCallback(() => {
    if (floatingWindow) {
      floatingWindow.close();
    } else {
      void open();
    }
  }, [floatingWindow, open]);

  return { supported: canFloatControls(), floatingWindow, toggle };
}
