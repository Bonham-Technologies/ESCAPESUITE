// The status toast on its own. The `{notification && …}` guard stays in App,
// so this component always has something to say.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotificationToast } from './NotificationToast';
import styles from '../App.module.css';

describe('NotificationToast', () => {
  it('announces the message politely', () => {
    render(<NotificationToast notification={{ message: 'Project saved', type: 'success' }} />);

    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Project saved');
    expect(toast).toHaveAttribute('aria-live', 'polite');
  });

  it.each(['info', 'error', 'success'] as const)('styles a %s notification by its type', (type) => {
    render(<NotificationToast notification={{ message: 'Something happened', type }} />);

    const toast = screen.getByRole('status');
    expect(toast).toHaveClass(styles.notification);
    expect(toast).toHaveClass(styles[type]);
  });
});
