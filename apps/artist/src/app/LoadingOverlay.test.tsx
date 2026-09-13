// The modal spinner on its own. The `{isLoading && …}` guard stays in App, so
// this renders only while a project is loading.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingOverlay } from './LoadingOverlay';

describe('LoadingOverlay', () => {
  it('is a modal dialog labelled by its own message', () => {
    render(<LoadingOverlay />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'loading-message');
    expect(screen.getByText('Loading project...')).toHaveAttribute('id', 'loading-message');
  });
});
