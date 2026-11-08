import { useEffect, useState } from 'react';
import apiClient from './apiClient.js';
import { endpoints } from '../config/endpoints.js';

export const GOOGLE_SIGN_IN_URL = `${endpoints.apiBaseUrl}/auth/google`;

const OAUTH_ERROR_MESSAGES = Object.freeze({
  oauth_cancelled: 'Google sign-in was cancelled. You can try again or use your email and password.',
  oauth_state: 'That Google sign-in link has expired or was already used. Please start Google sign-in again from this page.',
  oauth_email_unverified: 'Google has not verified the email address on that account, so it cannot be used to sign in here.',
  oauth_failed: 'Google sign-in did not complete. Please try again.',
  google_auth_failed: 'Google sign-in did not complete. Please try again.'
});

export const oauthErrorMessage = (code) => (Object.hasOwn(OAUTH_ERROR_MESSAGES, code) ? OAUTH_ERROR_MESSAGES[code] : null);

let cachedProviders = null;

export const fetchAuthProviders = async (client = apiClient) => {
  try {
    const response = await client.get('/auth/providers');
    return { google: response?.data?.google === true };
  } catch {
    return { google: false };
  }
};

export const useAuthProviders = () => {
  const [providers, setProviders] = useState(cachedProviders || { google: false });
  useEffect(() => {
    if (cachedProviders) return undefined;
    let active = true;
    fetchAuthProviders().then((result) => {
      cachedProviders = result;
      if (active) setProviders(result);
    });
    return () => {
      active = false;
    };
  }, []);
  return providers;
};
