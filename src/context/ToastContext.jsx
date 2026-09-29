import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

const ToastContext = createContext(null);
const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (type, message, { duration = type === 'error' ? 7000 : 4000 } = {}) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-4), { id, type, message }]);
      if (duration) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  const toast = useMemo(
    () => ({
      success: (m, o) => push('success', m, o),
      error: (m, o) => push('error', m instanceof Error ? m.message : m, o),
      info: (m, o) => push('info', m, o),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-region" role="region" aria-label="Notifications">
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div
              key={t.id}
              className={`toast toast-${t.type}`}
              role={t.type === 'error' ? 'alert' : 'status'}
              aria-live={t.type === 'error' ? 'assertive' : 'polite'}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{t.message}</span>
              <button type="button" className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
