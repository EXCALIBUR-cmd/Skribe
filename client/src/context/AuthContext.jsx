import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import apiClient, { getExpectedUser, setExpectedUser, setSessionRefusedHandler, setSessionUser } from '../api/apiClient';
import socketService from '../services/socket';

const AuthContext = createContext(null);

const AUTH_CHANNEL = 'skribe-auth';

const userIdOf = (value) => (value?._id || value?.id ? String(value._id || value.id) : null);

const announce = (next) => {
  try {
    const channel = new BroadcastChannel(AUTH_CHANNEL);
    channel.postMessage({ userId: userIdOf(next) });
    channel.close();
  } catch {
    return;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sessionUserId, setSessionUserIdState] = useState(null);
  const socketPausedRef = useRef(false);

  const setSessionUserId = useCallback((id) => {
    setSessionUser(id);
    setSessionUserIdState(id);
  }, []);

  const adoptUser = useCallback((next) => {
    const id = userIdOf(next);
    setExpectedUser(id);
    setUser(next);
    setSessionUserId(id);
  }, [setSessionUserId]);

  const recheckSession = useCallback(async () => {
    if (!getExpectedUser()) return undefined;
    try {
      const res = await apiClient.get('/auth/me');
      const id = userIdOf(res?.data?.user);
      setSessionUserId(id);
      return id;
    } catch (err) {
      if (err?.errors?.code !== 'UNAUTHENTICATED') return undefined;
      setSessionUserId(null);
      return null;
    }
  }, [setSessionUserId]);

  useEffect(() => {
    let channel = null;
    try {
      channel = new BroadcastChannel(AUTH_CHANNEL);
      channel.onmessage = (event) => setSessionUserId(event.data?.userId ?? null);
    } catch {
      channel = null;
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheckSession();
    };
    window.addEventListener('focus', recheckSession);
    document.addEventListener('visibilitychange', onVisible);
    setSessionRefusedHandler(recheckSession);
    return () => {
      setSessionRefusedHandler(null);
      channel?.close();
      window.removeEventListener('focus', recheckSession);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [recheckSession, setSessionUserId]);

  useEffect(() => {
    const ownId = userIdOf(user);
    if (!ownId) return;
    if (sessionUserId !== ownId) {
      socketPausedRef.current = true;
      socketService.pause();
    } else if (socketPausedRef.current) {
      socketPausedRef.current = false;
      socketService.connect();
    }
  }, [user, sessionUserId]);

  const checkAuth = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/auth/me');
      if (res.success && res.data?.user) {
        adoptUser(res.data.user);

        socketService.connect();
      } else {
        adoptUser(null);
      }
    } catch (err) {
      adoptUser(null);
    } finally {
      setLoading(false);
    }
  }, [adoptUser]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    try {
      setError(null);
      const res = await apiClient.post('/auth/login', { email, password });
      if (res.success && res.data?.user) {
        adoptUser(res.data.user);
        announce(res.data.user);

        socketService.connect();
        return res.data.user;
      }
    } catch (err) {
      const errMsg = err.message || 'Login failed. Please check your credentials.';
      setError(errMsg);
      throw new Error(errMsg);
    }
  };

  const register = async (name, email, password) => {
    try {
      setError(null);
      const res = await apiClient.post('/auth/register', { name, email, password });
      if (res.success && res.data?.user) {
        adoptUser(res.data.user);
        announce(res.data.user);

        socketService.connect();
        return res.data.user;
      }
    } catch (err) {
      const errMsg = err.message || 'Registration failed. Please try again.';
      setError(errMsg);
      throw new Error(errMsg);
    }
  };

  const logout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch (err) {
      console.error('[AuthContext] Logout request error:', err.message);
    } finally {

      socketService.disconnect();
      adoptUser(null);
      announce(null);
      setError(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        login,
        register,
        logout,
        checkAuth,
        sessionUserId,
        recheckSession
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
