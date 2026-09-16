import { useEffect, useState } from 'react';

const STORAGE_KEY = 'sidebar-collapsed';

const readStoredValue = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const useSidebarCollapse = () => {
  const [collapsed, setCollapsed] = useState<boolean>(readStoredValue);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // localStorage unavailable (e.g. private mode) — ignore
    }
  }, [collapsed]);

  const toggleCollapsed = () => setCollapsed((prev) => !prev);

  return { collapsed, toggleCollapsed };
};
