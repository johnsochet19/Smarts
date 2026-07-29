import { useState } from 'react';
import { Drawer } from '@/components/ui/overlays';
import { Icon } from '@/components/ui/Icon';
import { AIChat } from './AIChat';
import './ai.css';

// Global floating AI assistant — available on every authenticated page.
export function AIAssistant() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="ai-fab" onClick={() => setOpen(true)} aria-label="Open AI assistant" title="BuildForge AI">
        <Icon name="zap" size={22} />
      </button>
      {open && (
        <Drawer open onClose={() => setOpen(false)} title={<div className="bf-row bf-gap-2"><Icon name="zap" size={16} /> <strong>BuildForge AI</strong></div>}>
          <AIChat compact />
        </Drawer>
      )}
    </>
  );
}
