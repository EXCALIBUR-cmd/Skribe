import React, { useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { buildShareLink, recallShareSecret, rememberShareSecret } from '../../features/guest/guestSession.js';

export const ShareLinkSection = ({ board, addToast }) => {
  const [secret, setSecret] = useState(() => recallShareSecret(board.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSecret(recallShareSecret(board.id));
    setCopied(false);
    setError('');
  }, [board.id]);

  const link = secret ? buildShareLink(window.location.origin, board.id, secret) : '';

  const rotate = async (revoking) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.post(`/boards/${board.id}/share-link`);
      const next = res?.data?.secret;
      if (!next) throw new Error('The share link could not be created.');
      rememberShareSecret(board.id, next);
      setSecret(next);
      setCopied(false);
      if (revoking) addToast?.('Link revoked', 'The old link no longer lets new people join. People already on the board keep access.', 'link_off', 'success');
    } catch (err) {
      setError(err?.message || 'The share link could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError('Copy failed. Select the link and copy it manually.');
    }
  };

  return (
    <section className="space-y-2" aria-labelledby="share-link-heading">
      <h3 id="share-link-heading" className="m-0 text-xs font-label font-bold text-on-surface uppercase tracking-wider">
        Share link
      </h3>
      {link ? (
        <>
          <div className="flex gap-2">
            <input
              readOnly
              value={link}
              aria-label="Share link"
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 bg-surface-container-low border-2 border-outline-variant rounded-xl px-3.5 py-2 text-xs text-on-surface font-body outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={copy}
              className="bg-primary text-on-primary font-label text-xs font-bold px-4 py-2 rounded-xl border-2 border-on-primary-fixed flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">{copied ? 'check' : 'content_copy'}</span>
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-[11px] text-on-surface-variant">Anyone with this link can join and draw.</p>
            <button
              type="button"
              onClick={() => rotate(true)}
              disabled={busy}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-error-container/30 text-error hover:bg-error-container text-xs font-label font-bold border border-error/20 cursor-pointer disabled:opacity-50"
            >
              Revoke link
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <p className="m-0 text-xs text-on-surface-variant">
            {board.hasShareLink
              ? 'A link was created on another device. A new link replaces it; people who already joined keep access.'
              : 'Create a link so anyone can join this board and draw with you, no account needed.'}
          </p>
          <button
            type="button"
            onClick={() => rotate(false)}
            disabled={busy}
            className="bg-primary text-on-primary font-label text-xs font-bold px-4 py-2 rounded-xl border-2 border-on-primary-fixed flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">link</span>
            <span>{board.hasShareLink ? 'Create a new link' : 'Create share link'}</span>
          </button>
        </div>
      )}
      {error && <p role="alert" className="m-0 text-xs font-bold text-error">{error}</p>}
    </section>
  );
};

export default ShareLinkSection;
