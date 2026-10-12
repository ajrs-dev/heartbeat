import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { bucket, healthyBuckets } from '../test/fixtures';
import { UptimeBar } from './UptimeBar';

describe('UptimeBar', () => {
  it('renders one bar per bucket', () => {
    const { container } = render(<UptimeBar buckets={healthyBuckets()} hours={24} />);
    expect(container.querySelectorAll('.bar')).toHaveLength(48);
  });

  it('colours each bar by how healthy its slot was', () => {
    const { container } = render(
      <UptimeBar buckets={[bucket(10, 10, 80, 0), bucket(10, 9, 80, 1), bucket(10, 4, 80, 2), bucket(0, 0, null, 3)]} hours={4} />,
    );
    const bars = [...container.querySelectorAll('.bar')].map((b) => b.className);
    expect(bars[0]).toContain('bar-good');
    expect(bars[1]).toContain('bar-warn');
    expect(bars[2]).toContain('bar-bad');
    expect(bars[3]).toContain('bar-empty');
  });

  it('describes the overall uptime for screen readers', () => {
    render(<UptimeBar buckets={[bucket(10, 10, 80, 0), bucket(10, 9, 80, 1)]} hours={24} />);
    // 19 of 20 checks succeeded.
    expect(screen.getByRole('img')).toHaveAccessibleName('Uptime over the last 24 hours: 95.00%');
  });

  it('says so when there is no data', () => {
    render(<UptimeBar buckets={[bucket(0, 0, null, 0), bucket(0, 0, null, 1)]} hours={24} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Uptime over the last 24 hours: no data');
  });

  it('puts a per-slot summary in each tooltip', () => {
    const { container } = render(<UptimeBar buckets={[bucket(30, 29, 120, 0)]} hours={24} />);
    const title = container.querySelector('.bar')!.getAttribute('title')!;
    expect(title).toContain('96.66% up');
    expect(title).toContain('30 checks');
    expect(title).toContain('120 ms');
  });
});
