import { useState, useEffect, FormEvent } from 'react';
import { api } from '@/lib/api';
import { Plus, Pencil, Trash2, X, Upload, Download } from 'lucide-react';

const CLASS_OPTIONS = [
  'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י', 'יא', 'יב',
];

interface Teacher {
  id: number;
  name: string;
  phone: string;
  role: string;
  className?: string;
}

const ROLE_LABELS: Record<string, string> = {
  CLASS_TEACHER: 'מחנך/ת',
  SECRETARY: 'מזכירות',
  PROFESSIONAL: 'מורה מקצועי',
  GUARD: 'שומר',
  PRINCIPAL: 'מנהל/ת',
};

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', role: 'CLASS_TEACHER', className: '' });
  const [error, setError] = useState('');
  const [importResult, setImportResult] = useState<any>(null);

  useEffect(() => { loadTeachers(); }, []);

  const loadTeachers = async () => {
    try {
      setTeachers(await api.get<Teacher[]>('/teachers'));
    } catch (err) {
      console.error(err);
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', phone: '', role: 'CLASS_TEACHER', className: '' });
    setShowForm(true);
    setError('');
  };

  const openEdit = (t: Teacher) => {
    setEditing(t);
    setForm({ name: t.name, phone: t.phone, role: t.role, className: t.className || '' });
    setShowForm(true);
    setError('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        await api.put(`/teachers/${editing.id}`, form);
      } else {
        await api.post('/teachers', form);
      }
      setShowForm(false);
      loadTeachers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('למחוק את המורה?')) return;
    try {
      await api.delete(`/teachers/${id}`);
      loadTeachers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await api.upload('/teachers/import', file);
      setImportResult(result);
      loadTeachers();
    } catch (err: any) {
      alert(err.message);
    }
    e.target.value = '';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">ניהול מורים</h2>
        <div className="flex gap-2">
          <a href="/api/teachers/import-template" className="flex items-center gap-2 px-3 py-2 bg-white border border-border rounded-md hover:bg-muted text-sm">
            <Download size={16} />
            טמפלייט
          </a>
          <label className="flex items-center gap-2 px-3 py-2 bg-white border border-border rounded-md cursor-pointer hover:bg-muted text-sm">
            <Upload size={16} />
            ייבוא
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="hidden" />
          </label>
          <button onClick={openNew} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm">
            <Plus size={16} /> הוסף מורה
          </button>
        </div>
      </div>

      {importResult && (
        <div className="bg-blue-50 text-blue-800 p-3 rounded-md mb-4 text-sm">
          יובאו {importResult.imported} מורים, דולגו {importResult.skipped}
          {importResult.errors?.length > 0 && (
            <div className="mt-1">{importResult.errors.slice(0, 3).join(', ')}</div>
          )}
          <button onClick={() => setImportResult(null)} className="mr-2 underline">סגור</button>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{editing ? 'עריכת מורה' : 'הוספת מורה'}</h3>
              <button onClick={() => setShowForm(false)}><X size={20} /></button>
            </div>
            {error && <div className="bg-red-50 text-destructive text-sm p-2 rounded mb-3">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm mb-1">שם *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-md text-sm" required />
              </div>
              <div>
                <label className="block text-sm mb-1">טלפון *</label>
                <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-md text-sm" required />
              </div>
              <div>
                <label className="block text-sm mb-1">תפקיד *</label>
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-md text-sm">
                  {Object.entries(ROLE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">כיתה (למחנך)</label>
                <select value={form.className} onChange={e => setForm({ ...form, className: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-md text-sm">
                  <option value="">ללא</option>
                  {CLASS_OPTIONS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="w-full bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 text-sm font-medium">
                {editing ? 'עדכן' : 'הוסף'}
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-right p-3">שם</th>
              <th className="text-right p-3">טלפון</th>
              <th className="text-right p-3">תפקיד</th>
              <th className="text-right p-3">כיתה</th>
              <th className="text-right p-3">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map(t => (
              <tr key={t.id} className="border-t border-border hover:bg-muted/50">
                <td className="p-3">{t.name}</td>
                <td className="p-3 ltr">{t.phone}</td>
                <td className="p-3">{ROLE_LABELS[t.role] || t.role}</td>
                <td className="p-3">{t.className || '-'}</td>
                <td className="p-3">
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(t)} className="p-1 hover:bg-muted rounded"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(t.id)} className="p-1 hover:bg-red-50 rounded text-destructive"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {teachers.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">לא נמצאו מורים</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
