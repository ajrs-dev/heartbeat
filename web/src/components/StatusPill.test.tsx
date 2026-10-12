import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MonitorStatus } from '../types';
import { StatusPill } from './StatusPill';

describe('StatusPill', () => {
  it.each<[MonitorStatus, string]>([
    ['up', 'Operational'],
    ['down', 'Down'],
    ['paused', 'Paused'],
    ['pending', 'Pending'],
  ])('shows a readable label for %s', (status, label) => {
    const { container } = render(<StatusPill status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass(`pill-${status}`);
  });
});
