import React, { useEffect, useState } from 'react';
import { guestHoursLeft } from '../../features/guest/guestSession.js';

export const GuestBoardBanner = ({ expiresAt, canKeep, onKeep, keeping = false }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = guestHoursLeft(expiresAt, now);
  if (hours === null) return null;

  return (
    <div
      role="status"
      className="absolute left-1/2 top-[7.5rem] z-30 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-3 rounded-full border-2 border-secondary/40 bg-surface/95 py-1.5 pl-4 pr-1.5 font-body text-sm text-on-surface shadow-sm backdrop-blur-sm sm:w-auto xl:top-[4.25rem]"
    >
      <span className="material-symbols-outlined shrink-0 text-lg text-secondary" aria-hidden="true">schedule</span>
      <p className="m-0 min-w-0 flex-1 leading-snug">
        <span className="font-bold">Guest board</span>
        <span aria-hidden="true"> · </span>
        <span>deleted in {hours}h</span>
        {canKeep && (
          <>
            <span aria-hidden="true"> · </span>
            <span>Sign up free to keep it</span>
          </>
        )}
      </p>
      {canKeep && (
        <button
          type="button"
          onClick={onKeep}
          disabled={keeping}
          className="shrink-0 rounded-full bg-primary px-4 py-2 font-label text-sm font-bold text-on-primary transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-60 cursor-pointer"
        >
          {keeping ? 'Saving…' : 'Keep this board'}
        </button>
      )}
    </div>
  );
};

export default GuestBoardBanner;
