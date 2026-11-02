import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AIPanelWrapper from '../components/ui/AIPanelWrapper';
import apiClient from '../api/apiClient';
import { useT } from '../context/PreferencesContext';

export const AIAssistPage = () => {
  const [sketchToShape, setSketchToShape] = useState(true);
  const [boards, setBoards] = useState(null);
  const navigate = useNavigate();
  const t = useT();

  useEffect(() => {
    let active = true;
    apiClient.get('/boards')
      .then((res) => { if (active) setBoards(Array.isArray(res?.data?.boards) ? res.data.boards : []); })
      .catch(() => { if (active) setBoards([]); });
    return () => { active = false; };
  }, []);

  return (
    <div className="relative w-full h-[calc(100vh-64px)] overflow-hidden bg-surface-bright flex">
      <div
        className="absolute inset-0 w-full h-full p-10 flex justify-center items-center z-0"
        style={{
          backgroundImage: 'radial-gradient(circle, #dce3f0 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
      >
        <div className="relative w-3/4 h-3/4 max-w-4xl border-2 border-dashed border-tertiary-container rounded-xl p-8 bg-surface/50 backdrop-blur-sm opacity-80">
          <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-secondary-container rounded-lg rotate-3 shadow-lg border-2 border-secondary flex items-center justify-center">
            <span className="font-label text-sm font-bold text-on-secondary-container">User Flow</span>
          </div>
          <svg className="absolute top-[35%] left-[45%] w-32 h-16" viewBox="0 0 100 50">
            <path d="M 0 25 Q 50 0 100 25" fill="none" stroke="#ae2f34" strokeDasharray="5,5" strokeWidth="3" />
            <polygon fill="#ae2f34" points="95,20 100,25 95,30" />
          </svg>
          <div className="absolute top-1/2 right-1/4 w-40 h-40 bg-tertiary-container rounded-full -rotate-6 shadow-lg border-2 border-tertiary flex flex-col items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-on-tertiary-container mb-2">database</span>
            <span className="font-label text-sm font-bold text-on-tertiary-container">Data Model</span>
          </div>
        </div>
      </div>

      <aside className="hidden md:flex flex-col gap-4 absolute left-6 top-1/2 -translate-y-1/2 z-10 bg-surface rounded-full p-2 border-2 border-outline-variant sticker-shadow">
        {[
          { icon: 'mouse', label: 'Select' },
          { icon: 'edit', label: 'Draw' },
          { icon: 'category', label: 'Shapes' },
          { icon: 'sticky_note_2', label: 'Sticky' }
        ].map((item, idx) => (
          <button
            key={idx}
            className="p-3 rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors group relative cursor-pointer"
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className="absolute left-full ml-4 px-2 py-1 bg-inverse-surface text-inverse-on-surface text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity">
              {item.label}
            </span>
          </button>
        ))}
      </aside>

      <div className="absolute right-6 top-6 bottom-6 w-[360px] z-20">
        <AIPanelWrapper title="AI Sidekick" icon="auto_awesome" className="h-full">
          <div className="stagger-item bg-secondary-container/30 rounded-lg p-4 border-l-4 border-secondary">
            <p className="font-body text-base text-on-surface font-semibold">What are we creating today?</p>
            <p className="font-body text-xs text-on-surface-variant mt-1">I can help sketch, organize, or suggest ideas.</p>
          </div>

          <div className="stagger-item flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary">gesture</span>
                <span className="font-label text-sm font-bold text-on-surface">Sketch to Shape</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={sketchToShape}
                  onChange={(e) => setSketchToShape(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-secondary" />
              </label>
            </div>
            <p className="font-body text-xs text-on-surface-variant">
              Automatically refine rough drawings into perfect geometric shapes as you draw.
            </p>
          </div>

          <hr className="stagger-item border-t-2 border-surface-container" />

          <div className="stagger-item flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-tertiary" aria-hidden="true">dashboard</span>
              <h2 className="font-label text-sm font-bold text-on-surface">{t('sidekick.launcherTitle')}</h2>
            </div>
            <p className="font-body text-xs text-on-surface-variant">{t('sidekick.launcherBody')}</p>
            {boards === null && <p role="status" className="font-body text-xs text-on-surface-variant">{t('sidekick.launcherLoading')}</p>}
            {boards?.length === 0 && (
              <div className="flex flex-col items-start gap-2">
                <p className="font-body text-xs text-on-surface-variant">{t('sidekick.launcherEmpty')}</p>
                <button type="button" onClick={() => navigate('/boards')} className="rounded-[10px] bg-primary px-3 py-2 font-label text-xs font-bold text-on-primary cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  {t('sidekick.launcherNew')}
                </button>
              </div>
            )}
            {boards?.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {boards.slice(0, 8).map((board) => (
                  <li key={board.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/board/${board.id}?sidekick=1`)}
                      aria-label={t('sidekick.launcherOpen', { title: board.title || 'Untitled Board' })}
                      className="flex w-full items-center gap-2 rounded-[10px] bg-surface-container px-3 py-2 text-left hover:bg-secondary-container/40 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <span className="material-symbols-outlined text-[18px] text-secondary" aria-hidden="true">auto_awesome</span>
                      <span className="min-w-0 flex-1 truncate font-label text-xs font-bold text-on-surface">{board.title || 'Untitled Board'}</span>
                      <span className="material-symbols-outlined text-[18px] text-on-surface-variant" aria-hidden="true">arrow_forward</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </AIPanelWrapper>
      </div>
    </div>
  );
};

export default AIAssistPage;
