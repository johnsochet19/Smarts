import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Button } from './primitives';
import './ui.css';

function useLockScroll(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}
export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  useLockScroll(open);
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <>
      <div className="bf-scrim" onClick={onClose} />
      <div className="bf-modal" role="dialog" aria-modal="true" aria-label={title}>
        {title && (
          <div className="bf-modal__head">
            <span className="bf-modal__title">{title}</span>
            <span className="bf-spacer" />
            <Button variant="ghost" size="sm" iconOnly icon="close" onClick={onClose} aria-label="Close" />
          </div>
        )}
        <div className="bf-modal__body">{children}</div>
        {footer && <div className="bf-modal__foot">{footer}</div>}
      </div>
    </>
  );
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}
export function Drawer({ open, onClose, title, children, footer }: DrawerProps) {
  useLockScroll(open);
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <>
      <div className="bf-scrim" onClick={onClose} />
      <aside className="bf-drawer" role="dialog" aria-modal="true">
        <div className="bf-drawer__head">
          <div style={{ flex: 1, minWidth: 0 }}>{title}</div>
          <Button variant="ghost" size="sm" iconOnly icon="close" onClick={onClose} aria-label="Close" />
        </div>
        <div className="bf-drawer__body">{children}</div>
        {footer && <div className="bf-drawer__foot">{footer}</div>}
      </aside>
    </>
  );
}

export function SegmentedControl<T extends string>({
  value, options, onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: Parameters<typeof Icon>[0]['name'] }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="bf-seg" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className={`bf-seg__btn${value === o.value ? ' bf-seg__btn--active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={15} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
