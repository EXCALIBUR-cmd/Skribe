import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const SignUpPage = () => {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
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

    if (!name.trim() || name.trim().length < 2) {
      setFormError('Please enter your full name (at least 2 characters).');
      return;
    }

    if (!email.trim() || !password) {
      setFormError('Please provide a valid email address and password.');
      return;
    }

    if (password.length < 6) {
      setFormError('Password must be at least 6 characters long.');
      return;
    }

    if (!terms) {
      setFormError('Please agree to the Terms of Service to continue.');
      return;
    }

    try {
      setIsSubmitting(true);
      await register(name.trim(), email.trim(), password);
      navigate('/boards', { replace: true });
    } catch (err) {
      setFormError(err.message || 'Registration failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignUp = () => {
    window.location.href = 'http://localhost:5000/api/v1/auth/google';
  };

  const handleWorkSignUp = () => {
    alert('Work Account SSO is coming soon. Please use Google Sign-In or Email authentication.');
  };

  return (
    <div className="bg-background min-h-screen flex items-center justify-center p-6 relative overflow-hidden font-body-md text-body-md text-on-surface">
      <div className="absolute top-[-10%] left-[-10%] w-[40vw] h-[40vw] rounded-full bg-secondary-container/20 blur-3xl z-0 pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-primary-container/10 blur-3xl z-0 pointer-events-none"></div>

      <div className="absolute top-20 right-32 w-24 h-24 bg-tertiary-fixed rounded-lg shadow-md -rotate-6 z-0 hidden md:flex items-center justify-center pointer-events-none">
        <span className="material-symbols-outlined text-on-tertiary-container opacity-50" style={{ fontSize: '32px' }}>edit</span>
      </div>

      <main className="relative z-10 w-full max-w-md bg-surface rounded-xl shadow-xl border-2 border-outline/20 p-8 md:p-12">
        <div className="text-center mb-8">
          <Link to="/" className="inline-block">
            <h1 className="font-display text-display text-primary italic tracking-tighter mb-2">Skribe</h1>
          </Link>
          <h2 className="font-headline-md text-headline-md text-on-surface">Start your creative journey</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-2">Join us and start making a mess.</p>
        </div>

        {formError && (
          <div className="mb-6 p-3 bg-error-container text-on-error-container rounded-lg text-xs font-bold flex items-center gap-2 animate-shake">
            <span className="material-symbols-outlined text-base text-error">error</span>
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="relative">
              <label className="sr-only" htmlFor="name">Name</label>
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-on-surface-variant">person</span>
              </div>
              <input
                className="w-full pl-12 pr-4 py-3 bg-surface-container-low border-2 border-outline-variant rounded-full font-body-md text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:border-primary focus:ring-0 transition-colors"
                id="name"
                name="name"
                placeholder="Full Name"
                required
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="relative">
              <label className="sr-only" htmlFor="email">Email address</label>
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-on-surface-variant">mail</span>
              </div>
              <input
                className="w-full pl-12 pr-4 py-3 bg-surface-container-low border-2 border-outline-variant rounded-full font-body-md text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:border-primary focus:ring-0 transition-colors"
                id="email"
                name="email"
                placeholder="Email Address"
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="relative">
              <label className="sr-only" htmlFor="password">Password</label>
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-on-surface-variant">lock</span>
              </div>
              <input
                className="w-full pl-12 pr-4 py-3 bg-surface-container-low border-2 border-outline-variant rounded-full font-body-md text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:border-primary focus:ring-0 transition-colors"
                id="password"
                name="password"
                placeholder="Password"
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center">
            <input
              className="h-5 w-5 text-primary bg-surface-container-low border-outline-variant rounded focus:ring-primary focus:ring-2 focus:ring-offset-1 focus:ring-offset-surface cursor-pointer"
              id="terms"
              name="terms"
              required
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
            />
            <label className="ml-3 block font-body-md text-body-md text-on-surface-variant cursor-pointer" htmlFor="terms">
              I agree to the <a className="text-primary hover:underline font-bold" href="#" onClick={(e) => e.preventDefault()}>Terms of Service</a>
            </label>
          </div>

          <button
            className="w-full py-4 bg-primary text-on-primary rounded-full font-label-lg text-label-lg shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 active:translate-y-0.5 active:translate-x-0.5 active:shadow-none transition-all flex justify-center items-center gap-2 cursor-pointer disabled:opacity-50"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <>
                <span>Continue</span>
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>arrow_forward</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-8 relative flex items-center justify-center">
          <div aria-hidden="true" className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-outline-variant/50"></div>
          </div>
          <div className="relative bg-surface px-4">
            <span className="font-body-md text-body-md text-on-surface-variant text-sm">Or continue with</span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <button
            onClick={handleWorkSignUp}
            className="flex justify-center items-center py-3 border-2 border-outline-variant rounded-full bg-surface-container-lowest hover:bg-surface-container-low transition-colors text-on-surface font-label-md text-label-md cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined mr-2">work</span>
            Work Account
          </button>
          <button
            onClick={handleGoogleSignUp}
            className="flex justify-center items-center py-3 border-2 border-outline-variant rounded-full bg-surface-container-lowest hover:bg-surface-container-low transition-colors text-on-surface font-label-md text-label-md hover:border-primary cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined mr-2 text-primary">public</span>
            Google
          </button>
        </div>

        <p className="mt-8 text-center font-body-md text-body-md text-on-surface-variant">
          Already have an account?{' '}
          <Link className="text-secondary font-bold hover:underline" to="/signin">
            Log in here
          </Link>
        </p>
      </main>
    </div>
  );
};

export default SignUpPage;
