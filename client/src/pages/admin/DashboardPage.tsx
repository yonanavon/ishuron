import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Users, GraduationCap, ClipboardList, MessageSquare } from 'lucide-react';

interface Stats {
  students: number;
  teachers: number;
  todayExits: number;
  pendingExits: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ students: 0, teachers: 0, todayExits: 0, pendingExits: 0 });
  const [recentExits, setRecentExits] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [students, teachers, exits] = await Promise.all([
        api.get<any[]>('/students'),
        api.get<any[]>('/teachers'),
        api.get<{ exits: any[]; total: number }>('/exits?limit=10'),
      ]);
      setStats({
        students: students.length,
        teachers: teachers.length,
        todayExits: exits.exits.filter((e: any) => {
          const d = new Date(e.exitDate);
          const today = new Date();
          return d.toDateString() === today.toDateString() && e.status === 'APPROVED';
        }).length,
        pendingExits: exits.exits.filter((e: any) => e.status === 'PENDING').length,
      });
      setRecentExits(exits.exits.slice(0, 5));
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    }
  };

  const statCards = [
    { icon: Users, label: 'תלמידים', value: stats.students, color: 'text-blue-600 bg-blue-50' },
    { icon: GraduationCap, label: 'מורים', value: stats.teachers, color: 'text-green-600 bg-green-50' },
    { icon: ClipboardList, label: 'יציאות היום', value: stats.todayExits, color: 'text-purple-600 bg-purple-50' },
    { icon: MessageSquare, label: 'ממתינות', value: stats.pendingExits, color: 'text-orange-600 bg-orange-50' },
  ];

  const statusLabel: Record<string, string> = {
    PENDING: 'ממתין',
    APPROVED: 'אושר',
    REJECTED: 'נדחה',
    ESCALATED: 'הוסלם',
  };

  const statusColor: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800',
    APPROVED: 'bg-green-100 text-green-800',
    REJECTED: 'bg-red-100 text-red-800',
    ESCALATED: 'bg-blue-100 text-blue-800',
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">דשבורד</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-white rounded-lg shadow-sm border border-border p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${color}`}>
                <Icon size={20} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold">{value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-border">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">בקשות אחרונות</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-right p-3">תלמיד</th>
                <th className="text-right p-3">כיתה</th>
                <th className="text-right p-3">תאריך</th>
                <th className="text-right p-3">שעה</th>
                <th className="text-right p-3">סטטוס</th>
                <th className="text-right p-3">מורה</th>
              </tr>
            </thead>
            <tbody>
              {recentExits.map((exit) => (
                <tr key={exit.id} className="border-t border-border">
                  <td className="p-3">{exit.student?.firstName} {exit.student?.lastName}</td>
                  <td className="p-3">{exit.student?.className}</td>
                  <td className="p-3">{new Date(exit.exitDate).toLocaleDateString('he-IL')}</td>
                  <td className="p-3">{exit.exitTime}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded-full text-xs ${statusColor[exit.status] || ''}`}>
                      {statusLabel[exit.status] || exit.status}
                    </span>
                  </td>
                  <td className="p-3">{exit.teacher?.name || '-'}</td>
                </tr>
              ))}
              {recentExits.length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">אין בקשות</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
