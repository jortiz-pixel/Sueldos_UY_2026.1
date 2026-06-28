import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { membershipApi, MyMembership } from '../services/api';
import { useAuth } from './useAuth';

interface CompanyContextType {
  companies: MyMembership[];
  activeCompanyId: string;
  setActiveCompanyId: (id: string) => void;
  loading: boolean;
}

const CompanyContext = createContext<CompanyContextType | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['my-companies'],
    queryFn: () => membershipApi.my(),
    enabled: !!user,
  });

  const [activeCompanyId, setActiveCompanyIdState] = useState<string>(
    () => localStorage.getItem('activeCompanyId') || '',
  );

  // Si la empresa activa no es válida (o no hay), elegir la primera disponible.
  useEffect(() => {
    if (!companies.length) return;
    const valid = companies.some((c) => c.companyId === activeCompanyId);
    if (!valid) {
      const first = companies[0].companyId;
      setActiveCompanyIdState(first);
      localStorage.setItem('activeCompanyId', first);
    }
  }, [companies, activeCompanyId]);

  const setActiveCompanyId = (id: string) => {
    setActiveCompanyIdState(id);
    localStorage.setItem('activeCompanyId', id);
  };

  return (
    <CompanyContext.Provider value={{ companies, activeCompanyId, setActiveCompanyId, loading: isLoading }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within CompanyProvider');
  return ctx;
}
