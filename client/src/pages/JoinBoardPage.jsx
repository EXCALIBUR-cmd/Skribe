import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { readShareSecret } from '../features/guest/guestSession.js';

const messageFor = (err) => {
  const code = err?.errors?.code;
  if (code === 'INVALID_SHARE_LINK') return 'This share link is no longer valid. Ask the board owner for a new one.';
  if (code === 'BOARD_NOT_FOUND') return 'This board no longer exists. Guest boards are deleted after 24 hours.';
  if (code === 'RATE_LIMITED') return 'Too many attempts to join from this network. Please wait a few minutes and try again.';
  return err?.message || 'Could not open this board. Please try again.';
};

export const JoinBoardPage = () => {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { joinWithShareLink } = useAuth();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const secret = readShareSecret(location.hash);
    if (!secret || !/^[a-f0-9]{24}$/.test(String(id))) {
      setError('This share link is incomplete. Ask the board owner to send it again.');
      return;
    }
    joinWithShareLink(id, secret)
      .then(() => navigate(`/board/${id}`, { replace: true }))
      .catch((err) => setError(messageFor(err)));
  }, [id, location.hash, joinWithShareLink, navigate]);

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6 font-body text-on-surface">
      {error ? (
        <div className="w-full max-w-md rounded-xl border-2 border-surface-container-high bg-surface-container-lowest p-8 text-center shadow-[0_20px_50px_rgba(0,0,0,0.05)]" role="alert">
          <span className="material-symbols-outlined text-4xl text-error" aria-hidden="true">link_off</span>
          <h1 className="mt-3 mb-2 font-headline text-2xl font-bold">Can't open this board</h1>
          <p className="m-0 text-on-surface-variant">{error}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link to="/" className="rounded-lg border-2 border-surface-container-high px-4 py-2 font-bold hover:border-primary">Go to Skribe</Link>
            <Link to="/signin" className="rounded-lg bg-primary px-4 py-2 font-bold text-on-primary">Sign in</Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
          <div className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent animate-spin" aria-hidden="true" />
          <span className="text-sm font-bold text-on-surface-variant">Joining the board…</span>
        </div>
      )}
    </main>
  );
};

export default JoinBoardPage;
