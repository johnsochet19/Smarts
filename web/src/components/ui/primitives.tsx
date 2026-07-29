import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { classNames, initials } from '@/lib/format';
import { Icon, type IconName } from './Icon';
import './ui.css';

/* ---------- Button ---------- */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  icon?: IconName;
  iconOnly?: boolean;
}
export function Button({
  variant = 'secondary', size = 'md', block, icon, iconOnly, className, children, ...rest
}: ButtonProps) {
  return (
    <button
      className={classNames(
        'bf-btn', `bf-btn--${variant}`,
        size !== 'md' && `bf-btn--${size}`,
        iconOnly && 'bf-btn--icon', block && 'bf-btn--block', className
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {!iconOnly && children}
    </button>
  );
}

/* ---------- Badge ---------- */
export function Badge({ children, color, solid, dot }: { children: ReactNode; color?: string; solid?: boolean; dot?: boolean }) {
  const style = solid
    ? { background: color, color: '#fff' }
    : color
    ? { color }
    : undefined;
  return (
    <span className={classNames('bf-badge', solid && 'bf-badge--solid')} style={style}>
      {dot && <span className="bf-badge__dot" />}
      {children}
    </span>
  );
}

/* ---------- Card ---------- */
export function Card({ children, pad, hover, className, ...rest }: { children: ReactNode; pad?: boolean; hover?: boolean; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={classNames('bf-card', pad && 'bf-card--pad', hover && 'bf-card--hover', className)} {...rest}>
      {children}
    </div>
  );
}

/* ---------- Field wrapper ---------- */
export function Field({ label, children, hint }: { label?: string; children: ReactNode; hint?: string }) {
  return (
    <label className="bf-field">
      {label && <span className="bf-label">{label}</span>}
      {children}
      {hint && <span className="bf-subtle" style={{ fontSize: 'var(--text-xs)' }}>{hint}</span>}
    </label>
  );
}

/* ---------- Input / Textarea / Select ---------- */
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={classNames('bf-input', props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={classNames('bf-textarea', props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="bf-select-wrap">
      <select {...props} className={classNames('bf-select', props.className)} />
      <Icon name="chevronDown" size={16} />
    </div>
  );
}

/* ---------- Avatar ---------- */
export function Avatar({ name, size = 30 }: { name?: string | null; size?: number }) {
  return (
    <span className="bf-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} title={name ?? undefined}>
      {initials(name)}
    </span>
  );
}

/* ---------- Spinner ---------- */
export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="bf-spinner" style={{ width: size, height: size }} />;
}

/* ---------- EmptyState ---------- */
export function EmptyState({ icon, title, hint, action }: { icon?: IconName; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="bf-empty">
      {icon && <div className="bf-empty__icon"><Icon name={icon} size={24} /></div>}
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {hint && <div style={{ fontSize: 'var(--text-sm)', maxWidth: 320 }}>{hint}</div>}
      {action}
    </div>
  );
}
