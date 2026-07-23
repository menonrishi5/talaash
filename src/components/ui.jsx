import { useEffect } from 'react'

// Small shared UI kit — buttons, modal, inputs, badges, cards.

// Segmented control. Lets editors (who are also dancers) flip between the
// admin view and their own personal member view.
export function ViewToggle({ value, onChange, options }) {
  return (
    <div className="inline-flex p-0.5 bg-subtle rounded-xl border border-line">
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
            value === val ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function Button({ variant = 'secondary', size = 'md', className = '', ...props }) {
  const variants = {
    primary: 'bg-accent text-accent-ink hover:bg-accent-strong shadow-sm',
    secondary: 'bg-surface text-ink border border-line-strong hover:bg-subtle hover:border-faint shadow-sm',
    ghost: 'text-muted hover:bg-subtle hover:text-ink',
    danger: 'bg-surface text-bad border border-bad/25 hover:bg-bad-soft shadow-sm',
    success: 'bg-good text-white hover:opacity-90 shadow-sm',
  }
  const sizes = {
    sm: 'px-2.5 py-1 text-xs rounded-lg',
    md: 'px-3.5 py-2 text-sm rounded-xl',
  }
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-all duration-150 cursor-pointer active:scale-[.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  )
}

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative bg-surface rounded-2xl border border-line w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[85vh] flex flex-col`}
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <button
            onClick={onClose}
            className="text-faint hover:text-ink cursor-pointer rounded-lg p-1 hover:bg-subtle"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto thin-scroll">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-muted mb-1">{label}</span>
      {children}
    </label>
  )
}

export const inputCls =
  'w-full px-3 py-2 text-sm bg-surface border border-line-strong rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent placeholder:text-faint'

export function TextInput(props) {
  return <input className={inputCls} {...props} />
}

export function Select({ children, className = '', ...props }) {
  return (
    <select className={`${inputCls} cursor-pointer ${className}`} {...props}>
      {children}
    </select>
  )
}

export function Badge({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${className}`}>
      {children}
    </span>
  )
}

export function Card({ children, className = '' }) {
  return (
    <div
      className={`themed bg-surface rounded-2xl border border-line ${className}`}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between px-5 pt-4 pb-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

export function EmptyState({ icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-12 h-12 rounded-2xl bg-subtle flex items-center justify-center text-faint mb-3">
        {icon}
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="text-xs text-muted mt-1 max-w-xs">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
