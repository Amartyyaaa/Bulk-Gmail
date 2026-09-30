import { cloneElement, useEffect, useId, useRef } from 'react';
import { Loader2, X } from 'lucide-react';

export function Button({ variant = 'secondary', size, loading, icon: Icon, children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${className}`}
      disabled={loading || props.disabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 size={16} className="spin" aria-hidden="true" /> : Icon && <Icon size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}

/**
 * Accessible form field: wires label, hint and inline error to the control
 * via id / aria-describedby / aria-invalid.
 */
export function Field({ label, hint, error, required, children, className = '' }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control = cloneElement(children, {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
    'aria-required': required || undefined,
  });
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden="true"> *</span>}
      </label>
      {control}
      {hint && !error && <p id={hintId} className="field-hint">{hint}</p>}
      {error && <p id={errorId} className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', padded = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty-state">
      {Icon && (
        <div className="empty-icon" aria-hidden="true">
          <Icon size={28} />
        </div>
      )}
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="spinner-wrap" role="status">
      <Loader2 size={22} className="spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Skeleton({ rows = 4 }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - (i % 3) * 15}%` }} />
      ))}
    </div>
  );
}

const STATUS_TONES = {
  draft: 'neutral', scheduled: 'info', sending: 'accent', paused: 'warn', sent: 'good', cancelled: 'neutral',
  queued: 'neutral', delivered: 'good', bounced: 'bad', failed: 'bad', skipped: 'neutral',
};

export function StatusBadge({ status }) {
  return <span className={`badge badge-${STATUS_TONES[status] ?? 'neutral'}`}>{status}</span>;
}

export function Tag({ children, onRemove }) {
  return (
    <span className="tag">
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove tag ${children}`}>
          <X size={12} />
        </button>
      )}
    </span>
  );
}

export function StatCard({ label, value, sub, loading }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{loading ? <span className="skeleton skeleton-inline" /> : value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  const refs = useRef([]);
  const onKeyDown = (e, i) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    const next = (i + dir + tabs.length) % tabs.length;
    onChange(tabs[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          tabIndex={value === t.value ? 0 : -1}
          className={`tab ${value === t.value ? 'active' : ''}`}
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, size = 'md' }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal modal-${size}`}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className="modal-inner">
          <header className="modal-header">
            <h2 id="modal-title">{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
              <X size={18} />
            </button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', danger, loading, onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

export function Pager({ page, pages, count, onPage }) {
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="muted small">{new Intl.NumberFormat().format(count)} total</span>
      <Button size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="small">Page {page + 1} of {pages}</span>
      <Button size="sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </nav>
  );
}

/** Free-text tag entry: Enter or comma adds a tag, Backspace removes the last. */
export function TagInput({ value, onChange, suggestions = [], placeholder = 'Add tag…', id, ...aria }) {
  const listId = useId();
  const add = (raw) => {
    const t = raw.trim().toLowerCase();
    if (t && !value.includes(t)) onChange([...value, t]);
  };
  return (
    <div className="tag-input">
      {value.map((t) => (
        <Tag key={t} onRemove={() => onChange(value.filter((x) => x !== t))}>
          {t}
        </Tag>
      ))}
      <input
        id={id}
        {...aria}
        list={listId}
        placeholder={value.length ? '' : placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(e.currentTarget.value);
            e.currentTarget.value = '';
          } else if (e.key === 'Backspace' && !e.currentTarget.value && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={(e) => {
          add(e.currentTarget.value);
          e.currentTarget.value = '';
        }}
      />
      <datalist id={listId}>
        {suggestions.filter((s) => !value.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
