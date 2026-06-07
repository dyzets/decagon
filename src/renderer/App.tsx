import { useEffect, useState } from "react";
import type { CredentialsStatus } from "../shared/ipc";
import { ProblemDetail } from "./ProblemDetail";
import { ProjectsView } from "./ProjectsView";
import { useToast } from "./Toast";

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

  useEffect(() => {
    void window.polygon.getCredentialsStatus().then(setStatus);
  }, []);

  return (
    <div className="app">
      <div className="row appbar">
        <h1>Decagon</h1>
        <button className="link" onClick={toggleTheme}>
          {theme === "dark" ? "☀ Light mode" : "🌙 Dark mode"}
        </button>
      </div>
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
