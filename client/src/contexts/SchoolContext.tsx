import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '@/lib/api';

export interface SchoolMeta {
  slug: string;
  name: string;
  logoUrl: string | null;
  timezone: string;
}

interface SchoolContextValue {
  school: SchoolMeta | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const SchoolContext = createContext<SchoolContextValue>({
  school: null,
  loading: true,
  error: null,
  reload: () => {},
});

export function SchoolProvider({ children }: { children: ReactNode }) {
  const [school, setSchool] = useState<SchoolMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<SchoolMeta>('/auth/school')
      .then((data) => {
        if (!cancelled) {
          setSchool(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSchool(null);
          setError(err.message || 'school lookup failed');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return (
    <SchoolContext.Provider value={{ school, loading, error, reload: () => setTick((t) => t + 1) }}>
      {children}
    </SchoolContext.Provider>
  );
}

export function useSchool(): SchoolContextValue {
  return useContext(SchoolContext);
}
