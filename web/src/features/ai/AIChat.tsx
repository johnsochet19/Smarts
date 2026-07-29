import { useEffect, useRef, useState } from 'react';
import { Button, Textarea } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useProjects } from '@/lib/projects';
import { aiApi, SUGGESTED_PROMPTS, type ChatMessage } from './api';
import './ai.css';

export function AIChat({ compact }: { compact?: boolean }) {
  const { activeId, active } = useProjects();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await aiApi.chat(next, activeId);
      setMessages([...next, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed';
      setError(msg.includes('not configured') || msg.includes('ANTHROPIC')
        ? 'The AI assistant needs an ANTHROPIC_API_KEY set on the backend to answer. Once configured, ask away.'
        : msg);
      setMessages(messages); // roll back the optimistic user message on hard error
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-chat">
      <div className="ai-msgs">
        {messages.length === 0 && !busy ? (
          <div className="ai-empty">
            <div className="ai-msg__avatar" style={{ width: 40, height: 40, margin: '0 auto var(--space-3)' }}><Icon name="zap" size={20} /></div>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>BuildForge AI</div>
            <div style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>{active ? `Ask about ${active.name}` : 'Ask about your projects, schedule, or punch list.'}</div>
            <div className="ai-suggest">
              {SUGGESTED_PROMPTS.slice(0, compact ? 3 : 5).map((p) => (
                <button key={p} className="ai-suggest__btn" onClick={() => send(p)}>{p}</button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`ai-msg ai-msg--${m.role}`}>
              {m.role === 'assistant' && <span className="ai-msg__avatar"><Icon name="zap" size={14} /></span>}
              <div className="ai-msg__bubble">{m.content}</div>
            </div>
          ))
        )}
        {busy && (
          <div className="ai-msg ai-msg--assistant">
            <span className="ai-msg__avatar"><Icon name="zap" size={14} /></span>
            <div className="ai-msg__bubble"><span className="ai-typing"><span /><span /><span /></span></div>
          </div>
        )}
        {error && <div className="bf-subtle" style={{ fontSize: 'var(--text-xs)', color: 'var(--amber-500)', padding: 'var(--space-2)' }}>{error}</div>}
        <div ref={endRef} />
      </div>

      <div className="ai-input">
        <Textarea
          rows={1}
          placeholder="Ask BuildForge AI…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          style={{ minHeight: 40 }}
        />
        <Button variant="primary" iconOnly icon="arrowRight" onClick={() => send(input)} disabled={busy || !input.trim()} aria-label="Send" />
      </div>
    </div>
  );
}
