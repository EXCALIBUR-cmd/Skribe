import React, { useEffect, useId, useRef } from 'react';
import { usePreferences } from '../../context/PreferencesContext';
import { AppearanceChoice, LanguageSelect } from '../../features/settings/PreferenceControls';
import { CANVAS_BACKGROUNDS } from '../../features/settings/preferenceOptions';
import { isDarkSurface } from '../../features/settings/canvasTheme';

const sectionLabel = 'block mb-2 font-label text-[11px] font-bold uppercase tracking-[0.08em] text-on-surface-variant';

export const BoardPreferencesPanel = ({ open, onClose, canvasBackground, onCanvasBackgroundChange, onOpenSettings }) => {
  const { t } = usePreferences();
  const panelRef = useRef(null);
  const titleId = useId();
  const languageId = useId();
  const swatchName = useId();

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.querySelector('input:checked, button, select')?.focus({ preventScroll: true });
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const handlePointerDown = (event) => {
      if (panelRef.current?.contains(event.target) || event.target.closest?.('[data-preferences-toggle]')) return;
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      className="fixed z-50 left-2 right-2 sm:left-auto sm:right-6 md:right-8 top-[180px] xl:top-[132px] sm:w-[304px] max-h-[calc(100dvh-196px)] xl:max-h-[calc(100dvh-148px)] overflow-y-auto rounded-2xl border border-outline-variant/70 bg-surface-container-lowest text-on-surface shadow-xl pointer-events-auto"
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-3 border-b border-outline-variant/60">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-primary" aria-hidden="true">settings</span>
          <h2 id={titleId} className="font-headline text-[15px] font-bold">{t('preferences.title')}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('preferences.close')}
          title={t('preferences.close')}
          className="w-8 h-8 rounded-[10px] flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
        </button>
      </div>

      <div className="px-4 py-4 space-y-5">
        <section>
          <span className={sectionLabel}>{t('preferences.theme')}</span>
          <AppearanceChoice compact />
        </section>

        <section>
          <label htmlFor={languageId} className={sectionLabel}>{t('preferences.language')}</label>
          <LanguageSelect id={languageId} />
        </section>

        <section>
          <span className={sectionLabel}>{t('preferences.background')}</span>
          <div role="radiogroup" aria-label={t('preferences.background')} className="grid grid-cols-5 gap-2">
            {CANVAS_BACKGROUNDS.map((background) => {
              const label = t(background.labelKey);
              const selected = canvasBackground === background.key;
              const swatch = background.key === 'default'
                ? `linear-gradient(135deg, ${background.light} 0 50%, ${background.dark} 50% 100%)`
                : background.light;
              return (
                <label key={background.key} className="relative cursor-pointer" title={label}>
                  <input
                    type="radio"
                    name={swatchName}
                    value={background.key}
                    checked={selected}
                    onChange={() => onCanvasBackgroundChange(background.key)}
                    aria-label={label}
                    className="peer sr-only"
                  />
                  <span
                    className="flex items-center justify-center aspect-square rounded-[10px] border border-outline-variant transition-shadow peer-checked:ring-2 peer-checked:ring-primary peer-checked:ring-offset-2 peer-checked:ring-offset-surface-container-lowest peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-primary"
                    style={{ background: swatch }}
                  >
                    {selected && (
                      <span
                        className={`material-symbols-outlined text-[16px] ${isDarkSurface(background.light) ? 'text-white' : 'text-slate-800'}`}
                        aria-hidden="true"
                      >
                        check
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <p className="mt-2 font-body text-xs text-on-surface-variant">{t('preferences.backgroundHint')}</p>
        </section>
      </div>

      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-full h-10 px-3 rounded-[12px] flex items-center justify-between font-label text-sm font-semibold text-on-surface bg-surface-container hover:bg-surface-container-high transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span>{t('preferences.allSettings')}</span>
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
        </button>
      </div>
    </div>
  );
};

export default BoardPreferencesPanel;
