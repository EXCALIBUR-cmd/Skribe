import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../api/apiClient';
import { useAuth } from './AuthContext';
import { normalizePreferences, resolveAppearance } from '../features/settings/preferenceOptions';
import { translate } from '../features/i18n/translate';

const STORAGE_KEY = 'skribe.preferences';
const PreferencesContext = createContext(null);

const readCache = () => {
  try {
    return normalizePreferences(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return normalizePreferences(null);
  }
};

const writeCache = (preferences) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
};

const darkQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

export const PreferencesProvider = ({ children }) => {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState(readCache);
  const [systemDark, setSystemDark] = useState(() => Boolean(darkQuery()?.matches));
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;

  useEffect(() => {
    if (user?.preferences) setPreferences(normalizePreferences(user.preferences));
  }, [user]);

  useEffect(() => {
    const query = darkQuery();
    if (!query) return undefined;
    const handleChange = (event) => setSystemDark(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  const resolvedTheme = resolveAppearance(preferences.appearance, systemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.reduceMotion = String(preferences.reduceMotion);
    root.lang = preferences.language;
    writeCache(preferences);
  }, [preferences, resolvedTheme]);

  const updatePreferences = useCallback(async (patch) => {
    const keys = Object.keys(patch);
    const previous = preferencesRef.current;
    setPreferences((current) => normalizePreferences({ ...current, ...patch }));
    if (!user) return { ok: true };
    try {
      const res = await apiClient.patch('/auth/me/preferences', patch);
      if (!res?.success) throw new Error(res?.message || 'Preferences were not saved');
      return { ok: true };
    } catch (err) {
      setPreferences((current) => normalizePreferences({ ...current, ...Object.fromEntries(keys.map((key) => [key, previous[key]])) }));
      return { ok: false, message: err?.message };
    }
  }, [user]);

  const t = useCallback((key, vars) => translate(preferences.language, key, vars), [preferences.language]);

  const value = useMemo(
    () => ({ preferences, resolvedTheme, updatePreferences, t }),
    [preferences, resolvedTheme, updatePreferences, t]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
};

export const usePreferences = () => {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences must be used inside PreferencesProvider');
  return context;
};

export const useT = () => usePreferences().t;
