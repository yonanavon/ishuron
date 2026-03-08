import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';

interface Log {
  id: number;
  direction: 'IN' | 'OUT';
  phone: string;
  content: string;
  messageType: string;
  relatedTo?: string;
  createdAt: string;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => { loadLogs(); }, [page, direction]);

  const loadLogs = async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (direction) params.set('direction', direction);
      if (phone) params.set('phone', phone);
      const data = await api.get<{ logs: Log[]; total: number }>(`/logs?${params}`);
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSearch = () => {
    setPage(1);
    loadLogs();
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">לוגים</h2>

      <div className="flex gap-3 mb-4 items-end">
        <div>
          <label className="block text-sm mb-1">כיוון</label>
          <select value={direction} onChange={e => setDirection(e.target.value)}
            className="px-3 py-2 border border-input rounded-md text-sm">
            <option value="">הכל</option>
            <option value="IN">נכנס</option>
            <option value="OUT">יוצא</option>
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">טלפון</label>
          <input value={phone} onChange={e => setPhone(e.target.value)}
            className="px-3 py-2 border border-input rounded-md text-sm" placeholder="972..." />
        </div>
        <button onClick={handleSearch} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">סנן</button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-right p-3 w-10"></th>
              <th className="text-right p-3">טלפון</th>
              <th className="text-right p-3">תוכן</th>
              <th className="text-right p-3">קשור ל</th>
              <th className="text-right p-3">זמן</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id} className="border-t border-border hover:bg-muted/50">
                <td className="p-3">
                  {log.direction === 'IN' ? (
                    <ArrowDownLeft size={14} className="text-blue-600" />
                  ) : (
                    <ArrowUpRight size={14} className="text-green-600" />
                  )}
                </td>
                <td className="p-3 ltr font-mono text-xs">{log.phone}</td>
                <td className="p-3 max-w-xs truncate">{log.content}</td>
                <td className="p-3 text-xs text-muted-foreground">{log.relatedTo || '-'}</td>
                <td className="p-3 text-xs">{new Date(log.createdAt).toLocaleString('he-IL')}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">אין לוגים</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {total > 50 && (
        <div className="flex justify-center gap-2 mt-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 border border-border rounded text-sm disabled:opacity-50"
          >
            הקודם
          </button>
          <span className="px-3 py-1 text-sm">עמוד {page}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page * 50 >= total}
            className="px-3 py-1 border border-border rounded text-sm disabled:opacity-50"
          >
            הבא
          </button>
        </div>
      )}
    </div>
  );
}
