import { Routes, Route, Navigate } from 'react-router-dom';
import { isLoggedIn, getUserRole } from './lib/api';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/admin/DashboardPage';
import StudentsPage from './pages/admin/StudentsPage';
import TeachersPage from './pages/admin/TeachersPage';
import TemplatesPage from './pages/admin/TemplatesPage';
import WhatsAppPage from './pages/admin/WhatsAppPage';
import LogsPage from './pages/admin/LogsPage';
import SettingsPage from './pages/admin/SettingsPage';
import GuardDashboardPage from './pages/guard/GuardDashboardPage';
import AdminLayout from './components/layout/AdminLayout';
import SuperLoginPage from './pages/super/SuperLoginPage';
import SuperDashboardPage from './pages/super/SuperDashboardPage';
import { SchoolProvider } from './contexts/SchoolContext';

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  if (!isLoggedIn()) return <Navigate to="/login" />;
  const role = getUserRole();
  if (allowedRoles && role && !allowedRoles.includes(role)) {
    return <Navigate to={role === 'GUARD' ? '/guard' : role === 'SUPER_ADMIN' ? '/super' : '/admin'} />;
  }
  return <>{children}</>;
}

function SuperRoute({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/super/login" />;
  if (getUserRole() !== 'SUPER_ADMIN') return <Navigate to="/super/login" />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/super/login" element={<SuperLoginPage />} />
      <Route path="/super" element={<SuperRoute><SuperDashboardPage /></SuperRoute>} />
      <Route path="/login" element={<SchoolProvider><LoginPage /></SchoolProvider>} />
      <Route path="/admin" element={
        <ProtectedRoute allowedRoles={['ADMIN']}>
          <SchoolProvider><AdminLayout /></SchoolProvider>
        </ProtectedRoute>
      }>
        <Route index element={<DashboardPage />} />
        <Route path="students" element={<StudentsPage />} />
        <Route path="teachers" element={<TeachersPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="whatsapp" element={<WhatsAppPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="/guard" element={
        <ProtectedRoute allowedRoles={['GUARD', 'ADMIN']}>
          <SchoolProvider><GuardDashboardPage /></SchoolProvider>
        </ProtectedRoute>
      } />
      <Route path="/" element={
        <Navigate to={
          !isLoggedIn() ? '/login' :
          getUserRole() === 'GUARD' ? '/guard' :
          getUserRole() === 'SUPER_ADMIN' ? '/super' :
          '/admin'
        } />
      } />
    </Routes>
  );
}
