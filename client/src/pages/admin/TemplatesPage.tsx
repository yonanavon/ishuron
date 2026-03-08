import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Save } from 'lucide-react';

interface Template {
  id: number;
  key: string;
  name: string;
  body: string;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadTemplates(); }, []);

  const loadTemplates = async () => {
    try {
      setTemplates(await api.get<Template[]>('/templates'));
    } catch (err) {
      console.error(err);
    }
  };

  const startEdit = (t: Template) => {
    setEditingId(t.id);
    setEditBody(t.body);
  };

  const handleSave = async (id: number) => {
    setSaving(true);
    try {
      await api.put(`/templates/${id}`, { body: editBody });
      setEditingId(null);
      loadTemplates();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">תבניות הודעות</h2>
      <p className="text-sm text-muted-foreground mb-4">
        ניתן לערוך את תוכן ההודעות. משתנים בסוגריים כפולים {'{{'}variable{'}}'}  יוחלפו אוטומטית.
      </p>

      <div className="space-y-4">
        {templates.map(t => (
          <div key={t.id} className="bg-white rounded-lg shadow-sm border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="font-semibold">{t.name}</h3>
                <span className="text-xs text-muted-foreground font-mono">{t.key}</span>
              </div>
              {editingId === t.id ? (
                <button
                  onClick={() => handleSave(t.id)}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
                >
                  <Save size={14} /> שמור
                </button>
              ) : (
                <button
                  onClick={() => startEdit(t)}
                  className="px-3 py-1 border border-border rounded-md text-sm hover:bg-muted"
                >
                  ערוך
                </button>
              )}
            </div>
            {editingId === t.id ? (
              <textarea
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-md text-sm min-h-[100px] font-mono"
                dir="rtl"
              />
            ) : (
              <pre className="text-sm whitespace-pre-wrap bg-muted p-3 rounded-md" dir="rtl">
                {t.body}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
