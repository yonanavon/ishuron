import { Routes, Route, Navigate } from 'react-router-dom';
import { isLoggedIn, getUserRole } from './lib/api';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/admin/DashboardPage';
import StudentsPage from './pages/admin/StudentsPage';
import TeachersPage from './pages/admin/TeachersPage';
import TemplatesPage from './pages/admin/TemplatesPage';
import WhatsAppPage from './pages/admin/WhatsAppPage';
import LogsPage from './pages/admin/LogsPage';
import GuardDashboardPage from './pages/guard/GuardDashboardPage';
import AdminLayout from './components/layout/AdminLayout';

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  if (!isLoggedIn()) return <Navigate to="/login" />;
  const role = getUserRole();
  if (allowedRoles && role && !allowedRoles.includes(role)) {
    return <Navigate to={role === 'GUARD' ? '/guard' : '/admin'} />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin" element={
        <ProtectedRoute allowedRoles={['ADMIN']}>
          <AdminLayout />
        </ProtectedRoute>
      }>
        <Route index element={<DashboardPage />} />
        <Route path="students" element={<StudentsPage />} />
        <Route path="teachers" element={<TeachersPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="whatsapp" element={<WhatsAppPage />} />
        <Route path="logs" element={<LogsPage />} />
      </Route>
      <Route path="/guard" element={
        <ProtectedRoute allowedRoles={['GUARD', 'ADMIN']}>
          <GuardDashboardPage />
        </ProtectedRoute>
      } />
      <Route path="/" element={<Navigate to={getUserRole() === 'GUARD' ? '/guard' : isLoggedIn() ? '/admin' : '/login'} />} />
    </Routes>
  );
}
