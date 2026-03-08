import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { logout } from '@/lib/api';
import { Users, GraduationCap, FileText, MessageSquare, ScrollText, LayoutDashboard, LogOut, Shield } from 'lucide-react';

const navItems = [
  { to: '/admin', icon: LayoutDashboard, label: 'דשבורד', end: true },
  { to: '/admin/students', icon: Users, label: 'תלמידים' },
  { to: '/admin/teachers', icon: GraduationCap, label: 'מורים' },
  { to: '/admin/templates', icon: FileText, label: 'תבניות' },
  { to: '/admin/whatsapp', icon: MessageSquare, label: 'וואטסאפ' },
  { to: '/admin/logs', icon: ScrollText, label: 'לוגים' },
];

export default function AdminLayout() {
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-l border-border shadow-sm">
        <div className="p-4 border-b border-border">
          <h1 className="text-xl font-bold text-primary">Ishuron</h1>
          <p className="text-sm text-muted-foreground">ניהול אישורי יציאה</p>
        </div>
        <nav className="p-2 space-y-1">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-muted'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
          <NavLink
            to="/guard"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-foreground hover:bg-muted"
          >
            <Shield size={18} />
            דשבורד שומר
          </NavLink>
        </nav>
        <div className="absolute bottom-0 w-64 p-2 border-t border-border">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-destructive hover:bg-red-50 w-full"
          >
            <LogOut size={18} />
            התנתק
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
