import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { bucket } from '../test/fixtures';
import { LatencyChart } from './LatencyChart';

const at = (index: number, latency: number | null) => bucket(latency === null ? 0 : 10, latency === null ? 0 : 10, latency, index);

describe('LatencyChart', () => {
  it('shows a message instead of an empty chart when there is no latency data', () => {
    render(<LatencyChart buckets={[at(0, null), at(1, null)]} hours={24} />);
    expect(screen.getByText(/no latency data/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('draws a line and labels the axes', () => {
    const { container } = render(<LatencyChart buckets={[at(0, 80), at(1, 120), at(2, 100)]} hours={24} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Average response time over the last 24 hours');
    expect(container.querySelectorAll('polyline')).toHaveLength(1);
    expect(container.querySelector('polyline')!.getAttribute('points')!.split(' ')).toHaveLength(3);
    // Axis maximum is rounded up to a tidy number: 120 ms -> 150 ms.
    expect(screen.getByText('150 ms')).toBeInTheDocument();
    expect(screen.getByText('0 ms')).toBeInTheDocument();
    expect(screen.getByText('now')).toBeInTheDocument();
    expect(screen.getByText('1d ago')).toBeInTheDocument();
  });

  it('breaks the line at missing slots instead of drawing a misleading slope', () => {
    const { container } = render(
      <LatencyChart buckets={[at(0, 50), at(1, 60), at(2, null), at(3, 70), at(4, 80)]} hours={24} />,
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
  });

  it('draws a lone data point as a dot', () => {
    const { container } = render(<LatencyChart buckets={[at(0, null), at(1, 90), at(2, null)]} hours={24} />);
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });

  it('uses day labels for a 7 day range', () => {
    render(<LatencyChart buckets={[at(0, 50), at(1, 60)]} hours={168} />);
    expect(screen.getByText('7d ago')).toBeInTheDocument();
    expect(screen.getByText('4d ago')).toBeInTheDocument(); // the midpoint, 84 h rounded to days
  });
});
