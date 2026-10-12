import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { formatInterval } from '../lib/format';
import type { Monitor } from '../types';

const INTERVALS = [30, 60, 300, 900, 3600];

interface Props {
  /** When provided the dialog edits this monitor; otherwise it creates a new one. */
  monitor?: Monitor;
  onClose: () => void;
  onSaved: (monitor: Monitor) => void;
}

export function MonitorDialog({ monitor, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(monitor?.name ?? '');
  const [url, setUrl] = useState(monitor?.url ?? 'https://');
  const [intervalSec, setIntervalSec] = useState(monitor?.intervalSec ?? 60);
  const [isPublic, setIsPublic] = useState(monitor?.isPublic ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A native <dialog> gives us focus trapping, Escape-to-close and the backdrop for free.
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const input = { name, url, intervalSec, isPublic };
      onSaved(monitor ? await api.updateMonitor(monitor.id, input) : await api.createMonitor(input));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
      <form onSubmit={submit} className="stack">
        <h2>{monitor ? 'Edit monitor' : 'Add monitor'}</h2>

        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing site" maxLength={80} required autoFocus />
        </label>

        <label>
          URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/health" type="url" required />
          <span className="hint">Any 2xx or 3xx response counts as up. Private and internal addresses are blocked.</span>
        </label>

        <label>
          Check every
          <select value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))}>
            {INTERVALS.map((s) => (
              <option key={s} value={s}>
                {formatInterval(s)}
              </option>
            ))}
          </select>
        </label>

        <label className="check">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          Show on my public status page
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="row end">
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : monitor ? 'Save changes' : 'Add monitor'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
