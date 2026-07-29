import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { type ReactNode } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ThemeProvider } from '@/lib/theme';
import { ProjectProvider } from '@/lib/projects';
import { ToastProvider } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/primitives';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { PunchlistPage } from '@/features/punchlist/PunchlistPage';
import { ResourceModule } from '@/features/modules/ResourceModule';
import { ClassicBridge } from '@/features/modules/ClassicBridge';
import { MODULES } from '@/features/modules/registry';
import { SheetsPage } from '@/features/sheets/SheetsPage';
import { SchedulePage } from '@/features/schedule/SchedulePage';
import { InspectionsPage } from '@/features/inspections/InspectionsPage';
import { BudgetPage } from '@/features/budget/BudgetPage';
import { TimesheetsPage } from '@/features/timesheets/TimesheetsPage';
import { AutomationsPage } from '@/features/automations/AutomationsPage';
import { FormsPage } from '@/features/forms/FormsPage';
import { PublicFormPage } from '@/features/forms/PublicFormPage';
import { NotificationsProvider } from '@/features/notifications/context';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { AIPage } from '@/features/ai/AIPage';
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { FilesPage } from '@/features/files/FilesPage';
import { SecurityPage } from '@/features/settings/SecurityPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { CostPage } from '@/features/cost/CostPage';
import { UsersPage } from '@/features/admin/UsersPage';
import { AuditLogPage } from '@/features/admin/AuditLogPage';
import { SearchPage } from '@/features/search/SearchPage';
import { ReportsPage } from '@/features/reports/ReportsPage';

function FullScreenLoader() {
  return (
    <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
      <Spinner size={28} />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <ProjectProvider>
      <NotificationsProvider>{children}</NotificationsProvider>
    </ProjectProvider>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={loading ? <FullScreenLoader /> : user ? <Navigate to="/" replace /> : <LoginPage />} />
      {/* Public, unauthenticated form fill-out */}
      <Route path="/f/:token" element={<PublicFormPage />} />
      <Route path="/" element={<RequireAuth><DashboardPage /></RequireAuth>} />
      <Route path="/punchlist" element={<RequireAuth><PunchlistPage /></RequireAuth>} />
      <Route path="/sheets" element={<RequireAuth><SheetsPage /></RequireAuth>} />
      <Route path="/schedule" element={<RequireAuth><SchedulePage /></RequireAuth>} />
      <Route path="/inspections" element={<RequireAuth><InspectionsPage /></RequireAuth>} />
      <Route path="/budget" element={<RequireAuth><BudgetPage /></RequireAuth>} />
      <Route path="/timesheets" element={<RequireAuth><TimesheetsPage /></RequireAuth>} />
      <Route path="/automations" element={<RequireAuth><AutomationsPage /></RequireAuth>} />
      <Route path="/forms" element={<RequireAuth><FormsPage /></RequireAuth>} />
      <Route path="/notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />
      <Route path="/assistant" element={<RequireAuth><AIPage /></RequireAuth>} />
      <Route path="/analytics" element={<RequireAuth><AnalyticsPage /></RequireAuth>} />
      <Route path="/projects" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
      <Route path="/calendar" element={<RequireAuth><CalendarPage /></RequireAuth>} />
      <Route path="/files" element={<RequireAuth><FilesPage /></RequireAuth>} />
      {/* Documents & Photos are covered by the Files page */}
      <Route path="/documents" element={<RequireAuth><FilesPage /></RequireAuth>} />
      <Route path="/photos" element={<RequireAuth><FilesPage /></RequireAuth>} />
      <Route path="/security" element={<RequireAuth><SecurityPage /></RequireAuth>} />
      <Route path="/cost" element={<RequireAuth><CostPage /></RequireAuth>} />
      <Route path="/users" element={<RequireAuth><UsersPage /></RequireAuth>} />
      <Route path="/audit-log" element={<RequireAuth><AuditLogPage /></RequireAuth>} />
      <Route path="/search" element={<RequireAuth><SearchPage /></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
      <Route path="/reports" element={<RequireAuth><ReportsPage /></RequireAuth>} />
      {MODULES.filter((cfg) => !['schedule', 'inspections', 'budget', 'timesheets', 'documents', 'photos', 'cost', 'users', 'audit-log', 'search', 'settings', 'reports'].includes(cfg.slug)).map((cfg) => (
        <Route
          key={cfg.slug}
          path={`/${cfg.slug}`}
          element={<RequireAuth>{cfg.ported ? <ResourceModule cfg={cfg} /> : <ClassicBridge cfg={cfg} />}</RequireAuth>}
        />
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
