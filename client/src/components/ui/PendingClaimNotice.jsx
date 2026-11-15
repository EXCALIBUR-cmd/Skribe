import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { pendingClaimMessage } from '../../features/guest/guestSession.js';

export const PendingClaimNotice = () => {
  const { user, isGuest, pendingClaim, retryGuestClaim } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  if (!user || isGuest || !pendingClaim) return null;

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    setFailed('');
    try {
      const claimedBoardIds = await retryGuestClaim();
      navigate(claimedBoardIds.length > 0 ? `/board/${claimedBoardIds[0]}` : '/boards');
    } catch (err) {
      setFailed(err?.message || 'We still couldn\'t move your board. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" aria-live="polite" className="fixed bottom-28 left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-3xl border-2 border-secondary/40 bg-surface px-4 py-3 text-on-surface shadow-lg">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center text-sm">
        <span className="material-symbols-outlined text-lg text-secondary" aria-hidden="true">cloud_sync</span>
        <span className="font-bold">{pendingClaimMessage(pendingClaim.hoursLeft)}</span>
        <button
          type="button"
          onClick={retry}
          disabled={busy}
          className="rounded-full bg-primary px-4 py-1.5 font-label text-sm font-bold text-on-primary transition-transform active:scale-95 disabled:opacity-60 cursor-pointer"
        >
          {busy ? 'Moving your board…' : 'Try again'}
        </button>
        {failed && <span role="alert" className="w-full text-center font-bold text-error">{failed}</span>}
      </div>
    </div>
  );
};

export default PendingClaimNotice;
