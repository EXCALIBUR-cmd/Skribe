import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export const TryBoardButton = ({ className = '', label = 'Try a board, no sign-up' }) => {
  const { startGuestBoard } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const { board } = await startGuestBoard();
      navigate(`/board/${board.id}`);
    } catch (err) {
      if (err?.errors?.code === 'ALREADY_SIGNED_IN') {
        navigate('/start');
        return;
      }
      setMessage(err?.message || 'Could not open a guest board. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={start} disabled={busy} aria-busy={busy} className={className}>
        {busy ? (
          <span className="inline-block h-5 w-5 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />
        ) : (
          <span className="material-symbols-outlined" aria-hidden="true">draw</span>
        )}
        <span>{busy ? 'Opening your board…' : label}</span>
      </button>
      {message && (
        <p role="alert" className="m-0 text-sm font-bold text-error">{message}</p>
      )}
    </div>
  );
};

export default TryBoardButton;
