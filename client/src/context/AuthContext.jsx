import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import apiClient, { getExpectedUser, setExpectedUser, setSessionRefusedHandler, setSessionUser } from '../api/apiClient';
import socketService from '../services/socket';
import { isGuestUser } from '../features/guest/guestSession.js';

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
  const [pendingClaim, setPendingClaim] = useState(null);
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

  const reconnectAs = useCallback((previous, next) => {
    if (previous && userIdOf(previous) !== userIdOf(next)) socketService.disconnect();
    socketService.connect();
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/auth/me');
      if (res.success && res.data?.user) {
        adoptUser(res.data.user);
        setPendingClaim(res.data.pendingClaim || null);

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
        const previous = user;
        adoptUser(res.data.user);
        announce(res.data.user);

        reconnectAs(previous, res.data.user);
        setPendingClaim(res.data.pendingClaim || null);
        return { user: res.data.user, claimedBoardIds: res.data.claimedBoardIds || [], pendingClaim: res.data.pendingClaim || null };
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
        const previous = user;
        adoptUser(res.data.user);
        announce(res.data.user);

        reconnectAs(previous, res.data.user);
        setPendingClaim(res.data.pendingClaim || null);
        return { user: res.data.user, claimedBoardIds: res.data.claimedBoardIds || [], pendingClaim: res.data.pendingClaim || null };
      }
    } catch (err) {
      const errMsg = err.message || 'Registration failed. Please try again.';
      setError(errMsg);
      throw new Error(errMsg);
    }
  };

  const enterAsGuest = async (request) => {
    const previous = user;
    const res = await request();
    const next = res?.data?.user;
    if (!res?.success || !next) throw new Error(res?.message || 'Could not open the board.');
    adoptUser(next);
    announce(next);
    reconnectAs(previous, next);
    return res.data;
  };

  const startGuestBoard = () => enterAsGuest(() => apiClient.post('/auth/guest'));

  const joinWithShareLink = (boardId, secret) => enterAsGuest(() => apiClient.post(`/boards/${boardId}/join`, { secret }));

  const retryGuestClaim = async () => {
    try {
      const res = await apiClient.post('/auth/claim-guest-board');
      setPendingClaim(null);
      return res?.data?.claimedBoardIds || [];
    } catch (err) {
      if (err?.errors?.code === 'NOTHING_TO_CLAIM') setPendingClaim(null);
      else if (Number.isInteger(err?.errors?.hoursLeft)) setPendingClaim({ hoursLeft: err.errors.hoursLeft });
      throw err;
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
      setPendingClaim(null);
      announce(null);
      setError(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isGuest: isGuestUser(user),
        pendingClaim,
        retryGuestClaim,
        startGuestBoard,
        joinWithShareLink,
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
