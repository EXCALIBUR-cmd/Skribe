import React from 'react';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const PendingRecoveryNotice = ({ kept = 0, held = 0, heldOrder = 0, busy = false, onUseMine, onDiscard }) => {
  if (kept === 0 && held === 0 && heldOrder === 0) return null;
  return (
    <div
      data-recovery-notice
      role="status"
      className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md rounded-xl border-2 border-primary bg-surface text-on-surface p-4 shadow-lg pointer-events-auto"
    >
      {kept > 0 && (
        <p className="text-sm">
          {plural(kept, 'unsynced change')} from your last visit {kept === 1 ? 'is' : 'are'} saved only in this browser, not on the server yet. Skribe will send {kept === 1 ? 'it' : 'them'} when the connection returns.
        </p>
      )}
      {held > 0 && (
        <p className="text-sm">
          {plural(held, 'item')} from your last visit {held === 1 ? 'was' : 'were'} not applied because a collaborator changed {held === 1 ? 'it' : 'them'} first. Your version is saved only in this browser.
        </p>
      )}
      {heldOrder > 0 && (
        <p className="text-sm">
          Your layer order from your last visit was not applied because a collaborator also changed the layer order. Your order is saved only in this browser.
        </p>
      )}
      {(held > 0 || heldOrder > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={onUseMine} className="min-h-11 rounded-lg border-2 border-primary bg-primary text-on-primary px-3 text-sm font-medium disabled:opacity-50">
            Use my version
          </button>
          <button type="button" disabled={busy} onClick={onDiscard} className="min-h-11 rounded-lg border-2 border-outline bg-surface text-on-surface px-3 text-sm font-medium disabled:opacity-50">
            Discard my version
          </button>
        </div>
      )}
    </div>
  );
};

export default PendingRecoveryNotice;
