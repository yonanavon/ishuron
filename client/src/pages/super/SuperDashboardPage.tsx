import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, logout } from '@/lib/api';
import { Plus, Edit, Power, LogOut, UserCheck } from 'lucide-react';

interface SchoolRow {
  id: number;
  slug: string;
  name: string;
  logoUrl: string | null;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  counts: { students: number; teachers: number; exitRequests: number; adminUsers: number };
  whatsappStatus: string | null;
}

export default function SuperDashboardPage() {
  const navigate = useNavigate();
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get<SchoolRow[]>('/super/schools');
      setSchools(data);
    } catch (err: any) {
      setError(err.message || 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleActive = async (s: SchoolRow) => {
    try {
      await api.put<any>(`/super/schools/${s.id}`, { isActive: !s.isActive });
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const impersonate = async (s: SchoolRow) => {
    if (!confirm(`להתחבר כאדמין של ${s.name}?`)) return;
    try {
      const data = await api.post<{ token: string; school: { slug: string; name: string } }>(
        `/super/schools/${s.id}/impersonate`,
      );
      // The impersonation token is for the school's subdomain — we navigate there.
      const proto = window.location.protocol;
      const host = window.location.host;
      const rootDomain = host.split('.').slice(1).join('.') || 'localhost';
      // Stash token so the target subdomain can pick it up (same-origin localStorage won't cross subdomains).
      // Safest: redirect via URL fragment; target page reads and stores.
      window.location.href = `${proto}//${s.slug}.${rootDomain}/login#token=${encodeURIComponent(data.token)}&role=ADMIN&username=superadmin`;
    } catch (err: any) {
      alert(err.message);
    }
  };

  const doLogout = () => {
    logout();
    navigate('/super/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gray-900 text-white px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold">Super Admin — ניהול בתי ספר</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded text-sm"
          >
            <Plus size={16} /> בית ספר חדש
          </button>
          <button
            onClick={doLogout}
            className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-sm"
          >
            <LogOut size={16} /> יציאה
          </button>
        </div>
      </header>
      <main className="p-6">
        {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{error}</div>}
        {loading ? (
          <div>טוען...</div>
        ) : schools.length === 0 ? (
          <div className="text-gray-500">אין בתי ספר עדיין.</div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-right">
                <tr>
                  <th className="px-4 py-2">שם</th>
                  <th className="px-4 py-2">slug</th>
                  <th className="px-4 py-2">סטטוס</th>
                  <th className="px-4 py-2">WhatsApp</th>
                  <th className="px-4 py-2">תלמידים</th>
                  <th className="px-4 py-2">מורים</th>
                  <th className="px-4 py-2">יציאות</th>
                  <th className="px-4 py-2">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {schools.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="px-4 py-2 font-medium">{s.name}</td>
                    <td className="px-4 py-2 text-gray-600">{s.slug}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${s.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                        {s.isActive ? 'פעיל' : 'מושבת'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{s.whatsappStatus || '—'}</td>
                    <td className="px-4 py-2">{s.counts.students}</td>
                    <td className="px-4 py-2">{s.counts.teachers}</td>
                    <td className="px-4 py-2">{s.counts.exitRequests}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => impersonate(s)}
                          title="התחזה לאדמין של בית הספר"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <UserCheck size={16} />
                        </button>
                        <button
                          onClick={() => toggleActive(s)}
                          title={s.isActive ? 'השבת' : 'הפעל'}
                          className="text-gray-600 hover:text-gray-800"
                        >
                          <Power size={16} />
                        </button>
                        <EditSchoolButton school={s} onSaved={load} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      {showCreate && <CreateSchoolDialog onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  );
}

function EditSchoolButton({ school, onSaved }: { school: SchoolRow; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="ערוך" className="text-gray-600 hover:text-gray-800">
        <Edit size={16} />
      </button>
      {open && (
        <EditSchoolDialog
          school={school}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onSaved();
          }}
        />
      )}
    </>
  );
}

function CreateSchoolDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ slug: '', name: '', logoUrl: '', timezone: 'Asia/Jerusalem', adminUsername: 'admin', adminPassword: '' });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      await api.post('/super/schools', form);
      onCreated();
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="bg-white rounded-lg p-6 w-full max-w-md space-y-3">
        <h2 className="text-lg font-bold">בית ספר חדש</h2>
        {err && <div className="bg-red-50 text-red-700 text-sm p-2 rounded">{err}</div>}
        <Field label="שם" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
        <Field label="slug (subdomain)" value={form.slug} onChange={(v) => setForm({ ...form, slug: v.toLowerCase() })} required placeholder="dogma" />
        <Field label="Logo URL" value={form.logoUrl} onChange={(v) => setForm({ ...form, logoUrl: v })} />
        <Field label="אזור זמן" value={form.timezone} onChange={(v) => setForm({ ...form, timezone: v })} />
        <Field label="שם משתמש אדמין" value={form.adminUsername} onChange={(v) => setForm({ ...form, adminUsername: v })} required />
        <Field label="סיסמת אדמין" value={form.adminPassword} onChange={(v) => setForm({ ...form, adminPassword: v })} type="password" required />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded">ביטול</button>
          <button type="submit" disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-50">
            {saving ? 'יוצר...' : 'צור'}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditSchoolDialog({ school, onClose, onSaved }: { school: SchoolRow; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: school.name, logoUrl: school.logoUrl || '', timezone: school.timezone, isActive: school.isActive });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      await api.put(`/super/schools/${school.id}`, form);
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="bg-white rounded-lg p-6 w-full max-w-md space-y-3">
        <h2 className="text-lg font-bold">עריכת {school.slug}</h2>
        {err && <div className="bg-red-50 text-red-700 text-sm p-2 rounded">{err}</div>}
        <Field label="שם" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
        <Field label="Logo URL" value={form.logoUrl} onChange={(v) => setForm({ ...form, logoUrl: v })} />
        <Field label="אזור זמן" value={form.timezone} onChange={(v) => setForm({ ...form, timezone: v })} />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          פעיל
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded">ביטול</button>
          <button type="submit" disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-50">
            {saving ? 'שומר...' : 'שמור'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}
