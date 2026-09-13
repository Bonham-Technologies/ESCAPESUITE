// The "Resume Previous Session?" modal on its own. The
// `{showSessionPrompt && pendingSession && …}` guard stays in App, so the
// session is always present here.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionRestorePrompt } from './SessionRestorePrompt';
import type { SessionState } from '../core/storage';
import type { Project, SourceVideo } from '../store/types';

const video = (id: string): SourceVideo => ({
  id,
  name: `${id}.mp4`,
  duration: 10,
  width: 1920,
  height: 1080,
  frameRate: 30,
  mimeType: 'video/mp4',
  size: 1000,
});

function sessionWith(videoCount: number, clipCount: number, timestamp = 1_700_000_000_000): SessionState {
  const project = {
    id: 'project1',
    name: 'Rough Cut',
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 0,
    created: 0,
    modified: 0,
    timeline: {
      clips: Array.from({ length: clipCount }, (_, i) => ({ id: `clip${i}` })),
      tracks: [],
      duration: 0,
    },
  } as unknown as Project;

  return {
    project,
    sourceVideos: Array.from({ length: videoCount }, (_, i) => video(`video${i}`)),
    currentTime: 0,
    selectedClipId: null,
    zoom: 1,
    timestamp,
  };
}

describe('SessionRestorePrompt', () => {
  it('is a modal dialog labelled by its own heading', () => {
    render(<SessionRestorePrompt session={sessionWith(1, 1)} onRestore={vi.fn()} onDecline={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'session-prompt-title');
    expect(screen.getByRole('heading', { name: 'Resume Previous Session?' })).toHaveAttribute(
      'id',
      'session-prompt-title'
    );
  });

  it('dates the session using the viewer\'s own locale formatting', () => {
    const timestamp = 1_700_000_000_000;
    render(<SessionRestorePrompt session={sessionWith(1, 1, timestamp)} onRestore={vi.fn()} onDecline={vi.fn()} />);

    expect(
      screen.getByText(`You have an unsaved session from ${new Date(timestamp).toLocaleString()}`)
    ).toBeInTheDocument();
  });

  it('names the project and counts what is in it', () => {
    render(<SessionRestorePrompt session={sessionWith(2, 3)} onRestore={vi.fn()} onDecline={vi.fn()} />);

    expect(screen.getByText('Rough Cut')).toBeInTheDocument();
    expect(screen.getByText(/2 video\(s\), 3 clip\(s\) on timeline/)).toBeInTheDocument();
  });

  it('counts an empty timeline too', () => {
    render(<SessionRestorePrompt session={sessionWith(1, 0)} onRestore={vi.fn()} onDecline={vi.fn()} />);

    expect(screen.getByText(/1 video\(s\), 0 clip\(s\) on timeline/)).toBeInTheDocument();
  });

  it('hands the session back when restoring', async () => {
    const user = userEvent.setup();
    const session = sessionWith(1, 1);
    const onRestore = vi.fn();
    render(<SessionRestorePrompt session={session} onRestore={onRestore} onDecline={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Restore Session' }));

    expect(onRestore).toHaveBeenCalledWith(session);
  });

  it('reports the decision to start fresh', async () => {
    const user = userEvent.setup();
    const onDecline = vi.fn();
    render(<SessionRestorePrompt session={sessionWith(1, 1)} onRestore={vi.fn()} onDecline={onDecline} />);

    await user.click(screen.getByRole('button', { name: 'Start Fresh' }));

    expect(onDecline).toHaveBeenCalledTimes(1);
  });
});
