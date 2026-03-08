import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, logout, getUserRole } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { LogOut, RefreshCw, DoorOpen } from 'lucide-react';

interface ExitEntry {
  id: number;
  exitTime: string;
  student: {
    firstName: string;
    lastName: string;
    className: string;
  };
  teacher: {
    name: string;
  } | null;
}

export default function GuardDashboardPage() {
  const [exits, setExits] = useState<ExitEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadExits();
    const socket = getSocket();
    socket.on('exit:approved', () => loadExits());
    return () => { socket.off('exit:approved'); };
  }, []);

  const loadExits = async () => {
    setLoading(true);
    try {
      const data = await api.get<ExitEntry[]>('/exits/today');
      setExits(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-border shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DoorOpen className="text-primary" size={24} />
            <div>
              <h1 className="text-lg font-bold">יציאות מאושרות - היום</h1>
              <p className="text-xs text-muted-foreground">{new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadExits} className="p-2 hover:bg-muted rounded-md" title="רענן">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            {getUserRole() === 'ADMIN' && (
              <button onClick={() => navigate('/admin')} className="px-3 py-1 text-sm border border-border rounded-md hover:bg-muted">
                ניהול
              </button>
            )}
            <button onClick={handleLogout} className="p-2 hover:bg-red-50 rounded-md text-destructive" title="התנתק">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        <div className="mb-4 text-sm text-muted-foreground">
          סה"כ: {exits.length} יציאות מאושרות
        </div>

        <div className="space-y-3">
          {exits.map(exit => (
            <div key={exit.id} className="bg-white rounded-lg shadow-sm border border-border p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-lg">
                  {exit.student.firstName} {exit.student.lastName}
                </p>
                <p className="text-sm text-muted-foreground">
                  כיתה {exit.student.className} | אושר ע"י {exit.teacher?.name || '-'}
                </p>
              </div>
              <div className="text-left">
                <p className="text-2xl font-bold text-primary">{exit.exitTime}</p>
              </div>
            </div>
          ))}
          {!loading && exits.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <DoorOpen size={48} className="mx-auto mb-3 opacity-30" />
              <p>אין יציאות מאושרות להיום</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
