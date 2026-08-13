import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const SignInPage = () => {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const oauthError = searchParams.get('error');
    if (oauthError === 'oauth_failed' || oauthError === 'google_auth_failed') {
      setFormError('Google authentication was cancelled or failed. Please try again.');
    }
  }, [location.search]);

  useEffect(() => {
    if (user) {
      navigate('/boards', { replace: true });
    }
  }, [user, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!email || !password) {
      setFormError('Please enter your email and password.');
      return;
    }

    try {
      setIsSubmitting(true);
      await login(email, password);
      navigate('/boards', { replace: true });
    } catch (err) {
      setFormError(err.message || 'Invalid email or password. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = () => {
    window.location.href = 'http://localhost:5000/api/v1/auth/google';
  };

  const handleAppleSignIn = () => {
    alert('Apple Sign-In is coming soon. Please use Google Sign-In or Email authentication.');
  };

  return (
    <div className="bg-background min-h-screen flex items-center justify-center relative overflow-hidden font-body-md text-body-md text-on-surface">
      <div className="absolute top-0 left-0 w-64 h-64 bg-tertiary-fixed rounded-full mix-blend-multiply filter blur-3xl opacity-30 -translate-x-1/2 -translate-y-1/2"></div>
      <div className="absolute bottom-0 right-0 w-80 h-80 bg-secondary-fixed-dim rounded-full mix-blend-multiply filter blur-3xl opacity-30 translate-x-1/3 translate-y-1/3"></div>

      <div className="absolute top-[10%] right-[15%] hidden md:block opacity-20 transform rotate-12 pointer-events-none">
        <svg fill="none" height="120" viewBox="0 0 120 120" width="120" xmlns="http://www.w3.org/2000/svg">
          <rect height="100" rx="30" stroke="#ae2f34" strokeDasharray="10 10" strokeWidth="4" width="100" x="10" y="10"></rect>
        </svg>
      </div>

      <div className="absolute bottom-[20%] left-[10%] hidden md:block opacity-20 transform -rotate-12 pointer-events-none">
        <svg fill="none" height="80" viewBox="0 0 80 80" width="80" xmlns="http://www.w3.org/2000/svg">
          <circle cx="40" cy="40" r="35" stroke="#006a65" strokeWidth="4"></circle>
          <circle cx="40" cy="40" fill="#fbe36a" r="15"></circle>
        </svg>
      </div>

      <div className="relative z-10 w-full max-w-md mx-auto p-8 bg-surface-container-lowest/90 backdrop-blur-xl rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.05)] border-2 border-surface-container-high m-4">
        <div className="text-center mb-8">
          <Link to="/" className="inline-block">
            <h1 className="font-display text-headline-lg-mobile md:text-headline-lg text-primary italic tracking-tighter mb-2">Skribe</h1>
          </Link>
          <p className="font-body-lg text-body-lg text-on-surface-variant">Welcome back to your workspace</p>
        </div>

        {formError && (
          <div className="mb-6 p-3 bg-error-container text-on-error-container rounded-lg text-xs font-bold flex items-center gap-2 animate-shake">
            <span className="material-symbols-outlined text-base text-error">error</span>
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="font-label-lg text-label-lg text-on-surface block" htmlFor="email">Email</label>
            <div className="relative group">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors">mail</span>
              <input
                className="w-full bg-surface-container-low border-2 border-surface-variant rounded-lg py-3 pl-12 pr-4 text-on-surface placeholder-on-surface-variant/50 focus:border-primary focus:ring-0 transition-colors font-body-md text-body-md"
                id="email"
                placeholder="name@example.com"
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="font-label-lg text-label-lg text-on-surface block" htmlFor="password">Password</label>
              <a className="font-label-md text-label-md text-secondary hover:text-primary transition-colors" href="#" onClick={(e) => e.preventDefault()}>Forgot Password?</a>
            </div>
            <div className="relative group">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors">lock</span>
              <input
                className="w-full bg-surface-container-low border-2 border-surface-variant rounded-lg py-3 pl-12 pr-4 text-on-surface placeholder-on-surface-variant/50 focus:border-primary focus:ring-0 transition-colors font-body-md text-body-md"
                id="password"
                placeholder="••••••••"
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center">
            <input
              className="w-5 h-5 rounded border-2 border-surface-variant text-primary focus:ring-primary focus:ring-2 bg-surface-container-low cursor-pointer"
              id="remember"
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <label className="ml-3 font-body-md text-body-md text-on-surface-variant cursor-pointer" htmlFor="remember">Remember me for 30 days</label>
          </div>

          <button
            className="w-full py-4 bg-primary text-on-primary rounded-lg font-label-lg text-label-lg shadow-[0_8px_16px_-4px_rgba(174,47,52,0.3)] hover:shadow-[0_4px_8px_-4px_rgba(174,47,52,0.4)] active:shadow-none active:translate-y-[2px] active:translate-x-[2px] transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div className="mt-8 mb-6 relative flex items-center">
          <div className="flex-grow border-t-2 border-surface-container-high"></div>
          <span className="flex-shrink-0 mx-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Or continue with</span>
          <div className="flex-grow border-t-2 border-surface-container-high"></div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={handleGoogleSignIn}
            className="flex items-center justify-center py-3 bg-surface border-2 border-surface-container-high rounded-lg hover:border-primary hover:bg-surface-container transition-all group shadow-sm active:translate-y-[1px] active:shadow-none cursor-pointer"
            type="button"
          >
            <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"></path>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"></path>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"></path>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"></path>
            </svg>
            <span className="font-label-md text-label-md text-on-surface group-hover:text-primary transition-colors">Google</span>
          </button>
          <button
            onClick={handleAppleSignIn}
            className="flex items-center justify-center py-3 bg-surface border-2 border-surface-container-high rounded-lg hover:border-outline-variant hover:bg-surface-container transition-all group shadow-sm active:translate-y-[1px] active:shadow-none cursor-pointer"
            type="button"
          >
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M16.365 7.143c-.495 2.106-2.428 3.593-4.484 3.491-.351-2.215 1.488-4.229 3.551-4.708.204 1.042.593 1.543.933 1.217zM11.758 11.233c-1.39.043-2.673-.837-3.415-.837-.768 0-1.84.82-2.98.796-1.503-.027-2.89.873-3.665 2.225-1.564 2.716-.4 6.744 1.135 8.966.75 1.085 1.637 2.292 2.808 2.25 1.121-.044 1.554-.725 2.912-.725 1.35 0 1.745.725 2.913.702 1.213-.024 1.97-.11 2.766-1.25.922-1.344 1.3-2.651 1.32-2.719-.028-.013-2.545-.976-2.571-3.905-.022-2.454 2.002-3.626 2.096-3.676-1.151-1.68-2.928-1.9-3.565-1.921-1.492-.167-3.045.86-3.793.86-1.304 0-2.31-.692-2.31-.692z"></path>
            </svg>
            <span className="font-label-md text-label-md text-on-surface group-hover:text-primary transition-colors">Apple</span>
          </button>
        </div>

        <div className="mt-8 text-center">
          <p className="font-body-md text-body-md text-on-surface-variant">
            Don't have an account?{' '}
            <Link className="font-label-lg text-label-lg text-primary hover:text-secondary transition-colors underline decoration-2 underline-offset-4 decoration-primary/30 hover:decoration-secondary font-bold" to="/signup">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;
