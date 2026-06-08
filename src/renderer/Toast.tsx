import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

/** A toast preserved in the notification log (with the time it was raised). */
export interface ToastNotification extends ToastItem {
  time: number;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  /** Recent toasts (oldest → newest), kept after they auto-dismiss. */
  history: ToastNotification[];
}

const ToastContext = createContext<ToastApi | null>(null);

/** Access the toast API. Must be used inside a <ToastProvider>. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used within a ToastProvider");
  return api;
}

const DISMISS_MS = 4000;
/** Cap on the notification log so it can't grow unbounded. */
const HISTORY_MAX = 50;

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  // Persistent log shown in the notifications panel; survives auto-dismiss.
  const [history, setHistory] = useState<ToastNotification[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number): void => {
    setItems((xs) => xs.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, kind: ToastKind = "info"): void => {
      const id = nextId.current++;
      const item: ToastItem = { id, kind, message };
      setItems((xs) => [...xs, item]);
      setHistory((xs) => [...xs, { ...item, time: Date.now() }].slice(-HISTORY_MAX));
      window.setTimeout(() => remove(id), DISMISS_MS);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show(m, "success"),
      error: (m) => show(m, "error"),
      history,
    }),
    [show, history],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind}`}
            role="status"
            onClick={() => remove(t.id)}
          >
            <span className="toast-icon">
              {t.kind === "success" ? "✓" : t.kind === "error" ? "✕" : "•"}
            </span>
            <span className="toast-msg">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
