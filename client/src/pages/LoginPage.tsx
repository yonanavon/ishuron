import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, login } from '@/lib/api';
import { useSchool } from '@/contexts/SchoolContext';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { school } = useSchool();

  useEffect(() => {
    if (window.location.hash.startsWith('#token=')) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const token = params.get('token');
      const role = params.get('role') || 'ADMIN';
      const uname = params.get('username') || 'superadmin';
      if (token) {
        login(token, role, uname);
        window.history.replaceState(null, '', window.location.pathname);
        navigate(role === 'GUARD' ? '/guard' : '/admin');
      }
    }
  }, [navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api.post<{ token: string; role: string; username: string }>('/auth/login', { username, password });
      login(data.token, data.role, data.username);
      navigate(data.role === 'GUARD' ? '/guard' : '/admin');
    } catch (err: any) {
      setError(err.message || 'שגיאה בהתחברות');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-md p-6">
        <div className="text-center mb-6">
          {school?.logoUrl && (
            <img src={school.logoUrl} alt="" className="w-16 h-16 rounded object-contain mx-auto mb-2" />
          )}
          <h1 className="text-2xl font-bold text-primary">{school?.name || 'Ishuron'}</h1>
          <p className="text-muted-foreground text-sm mt-1">מערכת אישורי יציאת תלמידים</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-destructive text-sm p-3 rounded-md">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">שם משתמש</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">סיסמה</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 font-medium"
          >
            {loading ? 'מתחבר...' : 'התחבר'}
          </button>
        </form>
      </div>
    </div>
  );
}
