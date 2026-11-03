import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../context/PreferencesContext';

export const MobileCanvasPage = () => {
  const navigate = useNavigate();
  const t = useT();

  return (
    <div className="w-full flex flex-col items-center justify-center px-4 pt-8 pb-32 min-h-[calc(100vh-64px)]">
      <section className="w-full max-w-xl flex flex-col items-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-outline-variant bg-surface-container">
          <span className="material-symbols-outlined text-primary" style={{ fontSize: 40 }} aria-hidden="true">smartphone</span>
        </div>

        <p className="mt-6 rounded-full border border-outline-variant bg-surface px-3 py-1 font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant">
          {t('mobile.status')}
        </p>

        <h1 className="mt-4 font-headline text-3xl sm:text-4xl font-bold text-on-surface text-balance">
          {t('mobile.title')}
        </h1>

        <p className="mt-4 font-body text-base sm:text-lg leading-relaxed text-on-surface-variant">
          {t('mobile.description')}
        </p>

        <p className="mt-4 font-body text-base font-semibold text-on-surface">
          {t('mobile.desktopNote')}
        </p>

        <button
          type="button"
          onClick={() => navigate('/boards')}
          className="mt-8 min-h-11 rounded-[10px] bg-primary px-5 py-2 font-label text-sm font-bold text-on-primary cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('mobile.goToBoards')}
        </button>
      </section>
    </div>
  );
};

export default MobileCanvasPage;
