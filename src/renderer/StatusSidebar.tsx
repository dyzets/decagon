import { useEffect, useState, type ReactNode } from "react";
import type { Problem } from "../core/types";
import type { ProjectContent } from "../shared/ipc";
import { useToast } from "./Toast";

const POLYGON_PROBLEMS_URL = "https://polygon.codeforces.com/problems";

/**
 * Right-hand sidebar mirroring Polygon's problem status box: it summarizes the project
 * (statements, checker/validator, tests, solutions) from the loaded ProjectContent and
 * the live problem metadata (owner/access/revision/package) from `problem.info`-class
 * data via problemMeta. Read-only — it just reflects state.
 */
export function StatusSidebar({
  content,
  problemId,
  problemName,
  refreshKey,
}: {
  content: ProjectContent | null;
  problemId: number;
  problemName: string;
  /** Bump to re-fetch live metadata (e.g. after a Pull/Push). */
  refreshKey: number;
}): JSX.Element {
  const [meta, setMeta] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!problemId) {
      setMeta(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    window.polygon
      .problemMeta(problemId)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => {
        if (!cancelled) setMeta(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [problemId, refreshKey]);

  const testsCount = content
    ? content.testsets.reduce((n, ts) => n + ts.tests.length, 0)
    : 0;
  const mainSolution = content?.solutions.find((s) => s.tag === "MA")?.name;
  const langs = content?.statements.map((s) => s.lang) ?? [];

  async function openPolygon(): Promise<void> {
    try {
      await window.polygon.openExternal(POLYGON_PROBLEMS_URL);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const none = <span className="muted">none</span>;

  return (
    <div className="card status-card">
      <div className="status-head">
        <h3>Project status</h3>
        {loading && <span className="spinner" />}
      </div>
      <dl className="status-list">
        <StatusRow label="Problem">
          <strong>{problemName}</strong>{" "}
          {problemId ? (
            <span className="muted">#{problemId}</span>
          ) : (
            <span className="muted">not bound</span>
          )}
        </StatusRow>
        {meta && <StatusRow label="Owner">{meta.owner}</StatusRow>}
        <StatusRow label="Statements">
          {langs.length ? langs.join(", ") : none}
        </StatusRow>
        <StatusRow label="Checker">{content?.checker || none}</StatusRow>
        <StatusRow label="Validator">{content?.validator || none}</StatusRow>
        {content?.interactor ? (
          <StatusRow label="Interactor">{content.interactor}</StatusRow>
        ) : null}
        <StatusRow label="Tests">{content ? testsCount : "—"}</StatusRow>
        <StatusRow label="Solutions">
          {content ? content.solutions.length : "—"}
          {mainSolution ? (
            <span className="muted"> · main: {mainSolution}</span>
          ) : null}
        </StatusRow>
        {meta && (
          <>
            <StatusRow label="Access">
              <span className="badge" data-access={meta.accessType}>
                {meta.accessType}
              </span>
            </StatusRow>
            <StatusRow label="Revision">{meta.revision}</StatusRow>
            {meta.latestPackage !== undefined ? (
              <StatusRow label="Package">#{meta.latestPackage}</StatusRow>
            ) : (
              <StatusRow label="Package">{none}</StatusRow>
            )}
            <StatusRow label="Uncommitted">
              {meta.modified ? (
                <span className="status-warn">yes</span>
              ) : (
                <span className="muted">no</span>
              )}
            </StatusRow>
          </>
        )}
      </dl>
      {problemId ? (
        <button className="link" onClick={openPolygon}>
          Open on Polygon ↗
        </button>
      ) : null}
    </div>
  );
}

function StatusRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="status-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Format an absolute time as a short "Ns / Nm / Nh ago" string. */
function relTime(time: number): string {
  const s = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** A log of recent toasts (newest first), so popups that auto-dismissed aren't lost. */
export function NotificationsPanel(): JSX.Element {
  const { history } = useToast();
  // Re-render every 30s so the relative times stay roughly fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const recent = [...history].reverse().slice(0, 12);
  return (
    <div className="card notif-card">
      <h3>Notifications</h3>
      {recent.length === 0 ? (
        <p className="muted">No recent notifications.</p>
      ) : (
        <ul className="notif-list">
          {recent.map((n) => (
            <li key={n.id} className={`notif ${n.kind}`}>
              <span className="notif-dot" aria-hidden />
              <span className="notif-body">
                <span className="notif-msg">{n.message}</span>
                <span className="notif-time">{relTime(n.time)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
