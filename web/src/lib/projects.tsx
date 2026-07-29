import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Project {
  id: number;
  name: string;
  status?: string;
  address?: string | null;
  workspace_id?: number | null;
}

interface ProjectState {
  projects: Project[];
  activeId: number | null;
  active: Project | null;
  setActiveId: (id: number) => void;
  loading: boolean;
  error: string | null;
}
const ProjectContext = createContext<ProjectState | null>(null);
const ACTIVE_KEY = 'bf_active_project';

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveIdState] = useState<number | null>(() => {
    const raw = localStorage.getItem(ACTIVE_KEY);
    return raw ? Number(raw) : null;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<Project[]>('/projects')
      .then((rows) => {
        if (!active) return;
        const list = Array.isArray(rows) ? rows : [];
        setProjects(list);
        setActiveIdState((cur) => (cur && list.some((p) => p.id === cur) ? cur : list[0]?.id ?? null));
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const setActiveId = (id: number) => {
    setActiveIdState(id);
    localStorage.setItem(ACTIVE_KEY, String(id));
  };

  const value: ProjectState = {
    projects,
    activeId,
    active: projects.find((p) => p.id === activeId) ?? null,
    setActiveId,
    loading,
    error,
  };
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjects(): ProjectState {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectProvider');
  return ctx;
}
