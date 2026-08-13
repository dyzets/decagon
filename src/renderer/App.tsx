import { useEffect, useState } from "react";
import type { AppSettings, CredentialsStatus } from "../shared/ipc";
import { ProblemDetail } from "./ProblemDetail";
import { ProjectsView } from "./ProjectsView";
import { useToast } from "./Toast";
import logo from "../../resources/icon.png";

interface Selection {
  path: string;
  problemId: number;
  problemName: string;
}

type Theme = "dark" | "light";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("decagon-theme") as Theme) || "dark",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("decagon-theme", theme);
  }, [theme]);
  const toggle = (): void => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return [theme, toggle];
}

export function App(): JSX.Element {
  const [status, setStatus] = useState<CredentialsStatus | null>(null);
  const [theme, toggleTheme] = useTheme();
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void window.polygon.getCredentialsStatus().then(setStatus);
  }, []);

  return (
    <div className="app">
      <div className="row appbar">
        <div className="brand">
          <img className="brand-logo" src={logo} alt="" />
          <h1>Decagon</h1>
        </div>
        <div className="actions">
          <button className="link" onClick={() => setShowSettings((s) => !s)}>
            ⚙ Settings
          </button>
          <button className="link" onClick={toggleTheme}>
            {theme === "dark" ? "☀ Light mode" : "🌙 Dark mode"}
          </button>
        </div>
      </div>
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {!status ? (
        <p className="loading">Loading…</p>
      ) : status.configured ? (
        <Workspace apiKey={status.apiKey!} onClear={setStatus} />
      ) : (
        <CredentialsForm onSaved={setStatus} />
      )}
    </div>
  );
}

function Workspace({
  apiKey,
  onClear,
}: {
  apiKey: string;
  onClear: (s: CredentialsStatus) => void;
}): JSX.Element {
  const [selected, setSelected] = useState<Selection | null>(null);
  const toast = useToast();

  async function clear(): Promise<void> {
    try {
      onClear(await window.polygon.clearCredentials());
      toast.success("Credentials cleared.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div>
      <div className="row">
        <span className="muted">
          Signed in with key <code>{apiKey}</code>
        </span>
        <button className="link" onClick={clear}>
          Change credentials
        </button>
      </div>

      {selected ? (
        <ProblemDetail
          path={selected.path}
          problemId={selected.problemId}
          problemName={selected.problemName}
          onBack={() => setSelected(null)}
        />
      ) : (
        <ProjectsView
          onOpenDetails={(project) =>
            setSelected({
              path: project.path,
              problemId: project.problemId,
              problemName: project.name,
            })
          }
        />
      )}
    </div>
  );
}

// Mirrors the clamp in main's settings.ts (main is authoritative and re-clamps).
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 16;
const MAX_REQUEST_INTERVAL_MS = 5000;
const MAX_RETRIES = 10;

/** App preferences. Currently just how hard pull/push hits the Polygon API. */
function SettingsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    void window.polygon.getSettings().then(setSettings);
  }, []);

  async function save(): Promise<void> {
    if (!settings) return;
    setSaving(true);
    try {
      setSettings(await window.polygon.saveSettings(settings));
      toast.success("Settings saved.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <p className="loading">Loading settings…</p>;

  return (
    <div className="card">
      <h2>Settings</h2>
      <label>
        Parallel Polygon requests
        <div className="actions">
          <input
            type="range"
            min={MIN_CONCURRENCY}
            max={MAX_CONCURRENCY}
            step={1}
            value={settings.syncConcurrency}
            onChange={(e) =>
              setSettings({ ...settings, syncConcurrency: Number(e.target.value) })
            }
          />
          <input
            type="number"
            min={MIN_CONCURRENCY}
            max={MAX_CONCURRENCY}
            step={1}
            style={{ width: "5em" }}
            value={settings.syncConcurrency}
            onChange={(e) =>
              setSettings({ ...settings, syncConcurrency: Number(e.target.value) })
            }
          />
        </div>
      </label>
      <p className="muted">
        How many Polygon API calls Pull and Push may have in flight at once
        (1–{MAX_CONCURRENCY}). Polygon rate-limits its API without publishing the
        limit: if a push fails with <code>Too many requests</code>, lower this (try 2,
        or 1 for fully sequential). Raise it for faster syncs. Applies to the next
        pull/push — no restart needed.
      </p>
      <label className="field">
        Minimum delay between requests (ms)
        <input
          type="number"
          min={0}
          max={MAX_REQUEST_INTERVAL_MS}
          step={50}
          value={settings.requestIntervalMs}
          onChange={(e) =>
            setSettings({ ...settings, requestIntervalMs: Number(e.target.value) })
          }
        />
      </label>
      <p className="muted">
        Spaces out every Polygon request, across all parallel workers (0 = no extra
        spacing, max {MAX_REQUEST_INTERVAL_MS}). Use this when lowering the concurrency
        alone isn&apos;t enough — e.g. 200 ms caps the app at ~5 requests/second.
      </p>
      <label className="field">
        Retries on &quot;Too many requests&quot;
        <input
          type="number"
          min={0}
          max={MAX_RETRIES}
          step={1}
          value={settings.maxRetries}
          onChange={(e) =>
            setSettings({ ...settings, maxRetries: Number(e.target.value) })
          }
        />
      </label>
      <p className="muted">
        A throttled request is retried automatically with exponential backoff (1s, 2s,
        4s, …) instead of failing the whole sync. 0 disables retrying.
      </p>
      <div className="actions">
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function CredentialsForm({
  onSaved,
}: {
  onSaved: (s: CredentialsStatus) => void;
}): JSX.Element {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const s = await window.polygon.saveCredentials({ apiKey, apiSecret });
      onSaved(s);
      toast.success("Credentials saved.");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(m);
      toast.error(m);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Polygon API credentials</h2>
      <p className="muted">
        Create a key in Polygon → Settings. The secret is encrypted on this device
        and never leaves the main process.
      </p>
      <label>
        API key
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
      </label>
      <label>
        API secret
        <input
          type="password"
          value={apiSecret}
          onChange={(e) => setApiSecret(e.target.value)}
          required
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save & continue"}
      </button>
    </form>
  );
}
