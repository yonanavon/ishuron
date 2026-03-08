import { useState, useEffect, FormEvent } from 'react';
import { api } from '@/lib/api';
import { Save, Clock } from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await api.get<Record<string, string>>('/settings');
      setSettings(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await api.put('/settings', settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-center p-8">טוען...</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">הגדרות</h2>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-border p-6 max-w-lg">
        <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Clock size={18} />
          תזכורות ואסקלציה למורה
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              שליחת תזכורת למורה לאחר (דקות)
            </label>
            <input
              type="number"
              min="1"
              max="120"
              value={settings.teacher_reminder_minutes || '15'}
              onChange={e => setSettings({ ...settings, teacher_reminder_minutes: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-md text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              אם המורה לא מגיב, תישלח תזכורת לאחר מספר הדקות שהוגדר
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              הסלמה אוטומטית לאחר (דקות)
            </label>
            <input
              type="number"
              min="1"
              max="240"
              value={settings.teacher_auto_escalate_minutes || '30'}
              onChange={e => setSettings({ ...settings, teacher_auto_escalate_minutes: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-md text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              אם המורה לא מגיב גם אחרי התזכורת, הבקשה תועבר אוטומטית למזכירות/מנהל
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? 'שומר...' : 'שמור'}
          </button>
          {saved && (
            <span className="text-sm text-green-600">ההגדרות נשמרו בהצלחה</span>
          )}
        </div>
      </form>
    </div>
  );
}
