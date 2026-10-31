import React, { useCallback, useId, useState } from 'react';
import { usePreferences } from '../../context/PreferencesContext';
import { APPEARANCE_OPTIONS, LANDING_OPTIONS, LANGUAGE_OPTIONS } from './preferenceOptions';

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export const usePreferenceUpdate = () => {
  const { preferences, updatePreferences, t } = usePreferences();
  const [failed, setFailed] = useState(false);
  const update = useCallback(async (patch) => {
    setFailed(false);
    const result = await updatePreferences(patch);
    if (!result.ok) setFailed(true);
    return result;
  }, [updatePreferences]);
  const errorMessage = failed ? (
    <p role="alert" className="mt-2 text-xs font-semibold text-error">{t('preferences.saveFailed')}</p>
  ) : null;
  return { preferences, update, t, errorMessage };
};

export const AppearanceChoice = ({ compact = false }) => {
  const { preferences, update, t, errorMessage } = usePreferenceUpdate();
  const name = useId();
  return (
    <div>
      <div role="radiogroup" aria-label={t('preferences.theme')} className={compact ? 'grid grid-cols-3 gap-1 p-1 rounded-[14px] bg-surface-container' : 'grid grid-cols-3 gap-2 max-w-md'}>
        {APPEARANCE_OPTIONS.map((option) => (
          <label key={option.value} className="relative cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={preferences.appearance === option.value}
              onChange={() => update({ appearance: option.value })}
              className="peer sr-only"
            />
            <span
              title={t(option.labelKey)}
              className={`flex items-center justify-center rounded-[10px] transition-colors text-on-surface-variant hover:text-on-surface peer-checked:bg-surface-container-lowest peer-checked:text-primary peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary ${
                compact ? 'h-9' : 'flex-col gap-1.5 h-20 border border-outline-variant/70 bg-surface peer-checked:border-primary'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{option.icon}</span>
              <span className={compact ? 'sr-only' : 'font-label text-sm font-semibold'}>{t(option.labelKey)}</span>
            </span>
          </label>
        ))}
      </div>
      {errorMessage}
    </div>
  );
};

export const LanguageSelect = ({ id }) => {
  const { preferences, update, errorMessage } = usePreferenceUpdate();
  return (
    <div>
      <select
        id={id}
        value={preferences.language}
        onChange={(event) => update({ language: event.target.value })}
        className={`w-full max-w-md h-10 px-3 rounded-[12px] bg-surface-container-lowest border border-outline-variant text-on-surface font-body text-sm cursor-pointer ${focusRing}`}
      >
        {LANGUAGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value} lang={option.value}>{option.nativeName}</option>
        ))}
      </select>
      {errorMessage}
    </div>
  );
};

export const LandingChoice = () => {
  const { preferences, update, t, errorMessage } = usePreferenceUpdate();
  const name = useId();
  return (
    <div>
      <div role="radiogroup" aria-label={t('landing.title')} className="grid gap-2 max-w-md">
        {LANDING_OPTIONS.map((option) => (
          <label key={option.value} className="relative cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={preferences.landingPage === option.value}
              onChange={() => update({ landingPage: option.value })}
              className="peer sr-only"
            />
            <span className="flex items-start gap-3 p-3 rounded-[12px] border border-outline-variant/70 bg-surface transition-colors hover:bg-surface-container-low peer-checked:border-primary peer-checked:bg-surface-container-low peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary">
              <span className={`mt-0.5 w-4 h-4 shrink-0 rounded-full border-2 ${preferences.landingPage === option.value ? 'border-primary bg-primary shadow-[inset_0_0_0_3px_var(--color-surface)]' : 'border-outline'}`} aria-hidden="true" />
              <span>
                <span className="block font-label text-sm font-bold text-on-surface">{t(option.labelKey)}</span>
                <span className="block font-body text-xs text-on-surface-variant mt-0.5">{t(option.descriptionKey)}</span>
              </span>
            </span>
          </label>
        ))}
      </div>
      {errorMessage}
    </div>
  );
};

export const ReduceMotionSwitch = ({ labelledBy, describedBy }) => {
  const { preferences, update, errorMessage } = usePreferenceUpdate();
  const on = preferences.reduceMotion;
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onClick={() => update({ reduceMotion: !on })}
        className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${on ? 'bg-primary' : 'bg-surface-container-highest border border-outline-variant'} ${focusRing}`}
      >
        <span className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-transform ${on ? 'translate-x-6 bg-on-primary' : 'translate-x-1 bg-on-surface-variant'}`} />
      </button>
      {errorMessage}
    </div>
  );
};
