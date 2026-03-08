import { useState, useEffect, FormEvent } from 'react';
import { api } from '@/lib/api';
import { Plus, Pencil, Trash2, Upload, Search, X } from 'lucide-react';

interface Student {
  id: number;
  firstName: string;
  lastName: string;
  idNumber: string;
  parent1Name: string;
  parent1Phone: string;
  parent2Name?: string;
  parent2Phone?: string;
  className: string;
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [form, setForm] = useState({
    firstName: '', lastName: '', idNumber: '',
    parent1Name: '', parent1Phone: '', parent2Name: '', parent2Phone: '', className: '',
  });
  const [error, setError] = useState('');
  const [importResult, setImportResult] = useState<any>(null);

  useEffect(() => { loadStudents(); }, []);

  const loadStudents = async () => {
    try {
      const data = await api.get<Student[]>(`/students${search ? `?search=${search}` : ''}`);
      setStudents(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    const timer = setTimeout(loadStudents, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const openNew = () => {
    setEditing(null);
    setForm({ firstName: '', lastName: '', idNumber: '', parent1Name: '', parent1Phone: '', parent2Name: '', parent2Phone: '', className: '' });
    setShowForm(true);
    setError('');
  };

  const openEdit = (s: Student) => {
    setEditing(s);
    setForm({
      firstName: s.firstName, lastName: s.lastName, idNumber: s.idNumber,
      parent1Name: s.parent1Name, parent1Phone: s.parent1Phone,
      parent2Name: s.parent2Name || '', parent2Phone: s.parent2Phone || '',
      className: s.className,
    });
    setShowForm(true);
    setError('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        await api.put(`/students/${editing.id}`, form);
      } else {
        await api.post('/students', form);
      }
      setShowForm(false);
      loadStudents();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('למחוק את התלמיד?')) return;
    try {
      await api.delete(`/students/${id}`);
      loadStudents();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await api.upload('/students/import', file);
      setImportResult(result);
      loadStudents();
    } catch (err: any) {
      alert(err.message);
    }
    e.target.value = '';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">ניהול תלמידים</h2>
        <div className="flex gap-2">
          <label className="flex items-center gap-2 px-3 py-2 bg-white border border-border rounded-md cursor-pointer hover:bg-muted text-sm">
            <Upload size={16} />
            ייבוא
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="hidden" />
          </label>
          <button onClick={openNew} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm">
            <Plus size={16} /> הוסף תלמיד
          </button>
        </div>
      </div>

      {importResult && (
        <div className="bg-blue-50 text-blue-800 p-3 rounded-md mb-4 text-sm">
          יובאו {importResult.imported} תלמידים, דולגו {importResult.skipped}
          {importResult.errors?.length > 0 && (
            <div className="mt-1">{importResult.errors.slice(0, 3).join(', ')}</div>
          )}
          <button onClick={() => setImportResult(null)} className="mr-2 underline">סגור</button>
        </div>
      )}

      <div className="relative mb-4">
        <Search size={16} className="absolute right-3 top-3 text-muted-foreground" />
        <input
          type="text"
          placeholder="חיפוש תלמיד..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pr-10 pl-4 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{editing ? 'עריכת תלמיד' : 'הוספת תלמיד'}</h3>
              <button onClick={() => setShowForm(false)}><X size={20} /></button>
            </div>
            {error && <div className="bg-red-50 text-destructive text-sm p-2 rounded mb-3">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1">שם פרטי *</label>
                  <input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm" required />
                </div>
                <div>
                  <label className="block text-sm mb-1">שם משפחה *</label>
                  <input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1">ת.ז *</label>
                  <input value={form.idNumber} onChange={e => setForm({ ...form, idNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm" required />
                </div>
                <div>
                  <label className="block text-sm mb-1">כיתה *</label>
                  <input value={form.className} onChange={e => setForm({ ...form, className: e.target.value })}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1">שם הורה 1 *</label>
                  <input value={form.parent1Name} onChange={e => setForm({ ...form, parent1Name: e.target.value })}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm" required />
                </div>
                <div>
                  <label className="block text-sm mb-1">טלפון הורה 1 *</label>
                  <input value={form.parent1Phone} onChange={e => setForm({ ...form, parent1Phone: e.target.value })}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1">שם הורה 2</label>
                  <input value={form.parent2Name} onChange={e => setForm({ ...form, parent2Name: e.target.value })}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm" />
                </div>
                <div>
                  <label className="block text-sm mb-1">טלפון הורה 2</label>
                  <input value={form.parent2Phone} onChange={e => setForm({ ...form, parent2Phone: e.target.value })}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm" />
                </div>
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
              <th className="text-right p-3">ת.ז</th>
              <th className="text-right p-3">כיתה</th>
              <th className="text-right p-3">הורה 1</th>
              <th className="text-right p-3">טלפון 1</th>
              <th className="text-right p-3">הורה 2</th>
              <th className="text-right p-3">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {students.map(s => (
              <tr key={s.id} className="border-t border-border hover:bg-muted/50">
                <td className="p-3">{s.firstName} {s.lastName}</td>
                <td className="p-3">{s.idNumber}</td>
                <td className="p-3">{s.className}</td>
                <td className="p-3">{s.parent1Name}</td>
                <td className="p-3 ltr">{s.parent1Phone}</td>
                <td className="p-3">{s.parent2Name || '-'}</td>
                <td className="p-3">
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(s)} className="p-1 hover:bg-muted rounded"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(s.id)} className="p-1 hover:bg-red-50 rounded text-destructive"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">לא נמצאו תלמידים</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
