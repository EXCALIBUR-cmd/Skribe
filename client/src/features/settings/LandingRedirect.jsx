import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api/apiClient';
import { resolveLandingTarget } from './landing';

export const LandingRedirect = () => {
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    apiClient
      .get('/auth/me/landing')
      .then((res) => res?.data?.path)
      .catch(() => null)
      .then((path) => {
        if (active) navigate(resolveLandingTarget(path), { replace: true });
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label="Opening Skribe">
      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
};

export default LandingRedirect;
