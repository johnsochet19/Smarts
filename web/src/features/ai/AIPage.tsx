import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Card } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useProjects } from '@/lib/projects';
import { usePunchItems } from '@/features/punchlist/api';
import { scheduleApi } from '@/features/schedule/api';
import type { Task } from '@/features/schedule/types';
import { AIChat } from './AIChat';
import './ai.css';

export function AIPage() {
  const { activeId } = useProjects();
  const { items: punch } = usePunchItems(activeId);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (!activeId) return;
    scheduleApi.listTasks(activeId).then((t) => setTasks(Array.isArray(t) ? t : [])).catch(() => setTasks([]));
  }, [activeId]);

  // Deterministic, data-driven insights (useful even without an API key).
  const insights = useMemo(() => {
    const today = new Date(new Date().toDateString());
    const overduePunch = punch.filter((p) => p.due_date && p.status !== 'closed' && new Date(p.due_date) < today).length;
    const openPunch = punch.filter((p) => p.status !== 'closed').length;
    const tasksBehind = tasks.filter((t) => {
      const end = t.finish_date || t.due_date;
      const done = t.status === 'completed' || t.status === 'done' || t.status === 'closed';
      return end && !done && new Date(end) < today;
    }).length;
    const unscheduled = tasks.filter((t) => !t.start_date && !t.finish_date && !t.due_date).length;
    return { overduePunch, openPunch, tasksBehind, unscheduled };
  }, [punch, tasks]);

  return (
    <AppShell title="AI Assistant">
      <div className="ai-insights">
        <Insight icon="alert" color="var(--red-500)" value={insights.overduePunch} label="Overdue punch items" />
        <Insight icon="clock" color="var(--amber-500)" value={insights.tasksBehind} label="Tasks behind schedule" />
        <Insight icon="punch" color="var(--blue-500)" value={insights.openPunch} label="Open punch items" />
        <Insight icon="calendar" color="var(--slate-500)" value={insights.unscheduled} label="Unscheduled tasks" />
      </div>

      <Card style={{ height: 'calc(100vh - 340px)', minHeight: 380, padding: 'var(--space-4)' }}>
        <AIChat />
      </Card>
    </AppShell>
  );
}

function Insight({ icon, color, value, label }: { icon: Parameters<typeof Icon>[0]['name']; color: string; value: number; label: string }) {
  return (
    <Card className="ai-insight" hover>
      <div className="bf-row bf-gap-2" style={{ color, marginBottom: 4 }}><Icon name={icon} size={16} /></div>
      <div className="ai-insight__val" style={{ color: value > 0 && (icon === 'alert' || icon === 'clock') ? color : 'var(--text)' }}>{value}</div>
      <div className="ai-insight__label">{label}</div>
    </Card>
  );
}
