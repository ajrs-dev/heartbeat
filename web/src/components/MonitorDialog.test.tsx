import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { monitor } from '../test/fixtures';
import { MonitorDialog } from './MonitorDialog';

const { createMonitor, updateMonitor } = vi.hoisted(() => ({ createMonitor: vi.fn(), updateMonitor: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { createMonitor, updateMonitor },
}));

beforeEach(() => {
  createMonitor.mockReset();
  updateMonitor.mockReset();
});

describe('MonitorDialog (create)', () => {
  it('opens as a modal dialog', () => {
    render(<MonitorDialog onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Add monitor' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add monitor' })).toBeInTheDocument();
  });

  it('submits the entered values and reports the created monitor', async () => {
    const created = monitor({ id: 7, name: 'API' });
    createMonitor.mockResolvedValue(created);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<MonitorDialog onClose={vi.fn()} onSaved={onSaved} />);

    await user.type(screen.getByLabelText('Name'), 'API');
    await user.clear(screen.getByLabelText(/^URL/));
    await user.type(screen.getByLabelText(/^URL/), 'https://api.example.com/health');
    await user.selectOptions(screen.getByLabelText('Check every'), '300');
    await user.click(screen.getByLabelText('Show on my public status page'));
    await user.click(screen.getByRole('button', { name: 'Add monitor' }));

    expect(createMonitor).toHaveBeenCalledWith({
      name: 'API',
      url: 'https://api.example.com/health',
      intervalSec: 300,
      isPublic: true,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
  });

  it('defaults to a one-minute interval and a private monitor', async () => {
    createMonitor.mockResolvedValue(monitor());
    const user = userEvent.setup();
    render(<MonitorDialog onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText('Name'), 'Site');
    await user.clear(screen.getByLabelText(/^URL/));
    await user.type(screen.getByLabelText(/^URL/), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Add monitor' }));
    expect(createMonitor).toHaveBeenCalledWith(expect.objectContaining({ intervalSec: 60, isPublic: false }));
  });

  it('shows the server error and lets the user try again', async () => {
    createMonitor.mockRejectedValueOnce(new ApiError('URL points at a private or internal address', 400));
    const user = userEvent.setup();
    render(<MonitorDialog onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText('Name'), 'Internal');
    await user.clear(screen.getByLabelText(/^URL/));
    await user.type(screen.getByLabelText(/^URL/), 'http://10.0.0.5/');
    await user.click(screen.getByRole('button', { name: 'Add monitor' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('URL points at a private or internal address');
    // The button is usable again after a failure.
    expect(screen.getByRole('button', { name: 'Add monitor' })).toBeEnabled();
  });

  it('closes without saving when cancelled', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<MonitorDialog onClose={onClose} onSaved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(createMonitor).not.toHaveBeenCalled();
  });
});

describe('MonitorDialog (edit)', () => {
  it('pre-fills the form and sends an update', async () => {
    const existing = monitor({ id: 3, name: 'Old name', url: 'https://old.example.com', intervalSec: 300, isPublic: true });
    updateMonitor.mockResolvedValue({ ...existing, name: 'New name' });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<MonitorDialog monitor={existing} onClose={vi.fn()} onSaved={onSaved} />);

    expect(screen.getByRole('heading', { name: 'Edit monitor' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Old name');
    expect(screen.getByLabelText('Check every')).toHaveValue('300');
    expect(screen.getByLabelText('Show on my public status page')).toBeChecked();

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'New name');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateMonitor).toHaveBeenCalledWith(3, {
      name: 'New name',
      url: 'https://old.example.com',
      intervalSec: 300,
      isPublic: true,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
