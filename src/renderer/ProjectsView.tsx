import { useEffect, useState } from "react";
import type { ProjectEntry } from "../shared/ipc";
import { useToast } from "./Toast";

export function ProjectsView({
  onOpenDetails,
}: {
  onOpenDetails: (project: ProjectEntry) => void;
}): JSX.Element {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      setProjects(await window.polygon.listProjects());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div>
      <div className="grid2">
        <NewProblemForm onDone={refresh} />
        <ImportProblemForm onDone={refresh} />
      </div>

      <div className="card">
        <div className="row" style={{ marginTop: 0 }}>
          <h3>My projects ({projects.length})</h3>
          <OpenFolderButton onDone={refresh} />
        </div>
        {error && <p className="error">{error}</p>}
        {projects.length === 0 && (
          <p className="muted">
            No projects yet. Create a new problem or import an existing one by id.
          </p>
        )}
        {projects.map((p) => (
          <ProjectRow
            key={p.path}
            project={p}
            onChanged={refresh}
            onOpenDetails={() => onOpenDetails(p)}
          />
        ))}
      </div>
    </div>
  );
}

function NewProblemForm({ onDone }: { onDone: () => void }): JSX.Element {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const entry = await window.polygon.createLocalProject(name.trim());
      if (entry) {
        setMsg(`Created folder at ${entry.path}. Bind a Polygon id from its details.`);
        setName("");
        onDone();
        toast.success(`Created project "${entry.name}".`);
      } else {
        setMsg("Cancelled.");
        toast.show("Creation cancelled.");
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={create}>
      <h3>New project</h3>
      <p className="muted">
        Scaffolds a local project folder (files/, solutions/, statements/) you choose.
        No Polygon problem is created — open its details to bind a problem id when ready.
      </p>
      <input
        placeholder="Project name (e.g. div2-a-apples)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <div style={{ marginTop: 10 }}>
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create folder…"}
        </button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function OpenFolderButton({ onDone }: { onDone: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function open(): Promise<void> {
    setBusy(true);
    try {
      const entry = await window.polygon.openProject();
      if (entry) {
        onDone();
        toast.success(`Opened "${entry.name}".`);
      } else {
        toast.show("Open cancelled.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="link" onClick={open} disabled={busy}>
      {busy ? "Opening…" : "Open existing folder…"}
    </button>
  );
}

function ImportProblemForm({ onDone }: { onDone: () => void }): JSX.Element {
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function importIt(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const problemId = Number(id);
    if (!Number.isFinite(problemId) || problemId <= 0) {
      setError("Enter a valid numeric problem id.");
      toast.error("Enter a valid numeric problem id.");
      return;
    }
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const entry = await window.polygon.importProblem(problemId);
      if (entry) {
        setMsg(`Imported "${entry.name}" (#${entry.problemId}) to ${entry.path}`);
        setId("");
        onDone();
        toast.success(`Imported "${entry.name}" (#${entry.problemId}).`);
      } else {
        setMsg("Cancelled.");
        toast.show("Import cancelled.");
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={importIt}>
      <h3>Import from Polygon</h3>
      <p className="muted">
        Pulls an existing problem by its Polygon id into a new local project folder
        you choose.
      </p>
      <input
        placeholder="Problem id (e.g. 123456)"
        value={id}
        onChange={(e) => setId(e.target.value)}
        inputMode="numeric"
        required
      />
      <div style={{ marginTop: 10 }}>
        <button type="submit" disabled={busy || !id.trim()}>
          {busy ? "Importing…" : "Import by id…"}
        </button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function ProjectRow({
  project,
  onChanged,
  onOpenDetails,
}: {
  project: ProjectEntry;
  onChanged: () => void;
  onOpenDetails: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  async function run(action: "open" | "remove"): Promise<void> {
    setBusy(action);
    try {
      if (action === "open") {
        await window.polygon.revealProject(project.path);
      } else {
        await window.polygon.removeProject(project.path);
        toast.success(`Removed "${project.name}" from the project list.`);
        onChanged();
        return;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="project">
      <div className="row" style={{ marginTop: 0 }}>
        <div>
          <strong>{project.name}</strong>{" "}
          <span className="muted">
            {project.problemId ? `#${project.problemId}` : "(no id)"}
          </span>
          <div className="muted path">{project.path}</div>
        </div>
        <div className="actions">
          <button onClick={onOpenDetails}>Open details</button>
          <button className="link" onClick={() => run("open")} disabled={busy !== null}>
            Open folder
          </button>
          <button
            className="link danger"
            onClick={() => run("remove")}
            disabled={busy !== null}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
