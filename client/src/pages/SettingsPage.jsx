import React, { useEffect, useRef } from 'react';
import { Navigate, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  SETTINGS_CATEGORIES,
  DEFAULT_SETTINGS_CATEGORY_ID,
  getSettingsCategory
} from '../features/settings/settingsCategories';
import { getBoardReturnPath } from '../features/settings/boardSettingsNavigation';
import { useT } from '../context/PreferencesContext';
import { AppearanceChoice, LandingChoice, LanguageSelect, PreferenceChoice, PreferenceSwitch, QuickDictationIntervalSelect, ReduceMotionSwitch } from '../features/settings/PreferenceControls';
import { BOARD_OPEN_VIEW_OPTIONS, ZOOM_FOCUS_OPTIONS } from '../features/settings/preferenceOptions';
import { MicrophoneStatus } from '../features/voice/QuickDictation.jsx';

const SHORTCUTS = [
  { labelKey: 'shortcuts.quickDictation', keysKey: 'shortcuts.quickDictationKeys' },
  { labelKey: 'shortcuts.pan', keysKey: 'shortcuts.panKeys' }
];

const SettingRow = ({ id, title, description, labelFor, heading: Heading = 'h3', children }) => (
  <div className="py-6 first:pt-0 border-b border-outline-variant/60 last:border-b-0">
    <Heading id={`${id}-title`} className="font-label text-base font-bold text-on-surface">
      {labelFor ? <label htmlFor={labelFor}>{title}</label> : title}
    </Heading>
    <p id={`${id}-description`} className="font-body text-sm text-on-surface-variant mt-1 mb-4">{description}</p>
    {children}
  </div>
);

const SettingSection = ({ id, title, children }) => (
  <section aria-labelledby={id} className="mb-8 last:mb-0">
    <h3 id={id} className="font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant">{title}</h3>
    {children}
  </section>
);

const CategoryContent = ({ categoryId, label }) => {
  const t = useT();
  if (categoryId === 'general') {
    return (
      <>
        <SettingRow id="setting-appearance" title={t('appearance.title')} description={t('appearance.description')}>
          <AppearanceChoice />
        </SettingRow>
        <SettingRow id="setting-language-row" labelFor="setting-language" title={t('preferences.language')} description={t('preferences.languageHint')}>
          <LanguageSelect id="setting-language" />
        </SettingRow>
        <SettingRow id="setting-landing" title={t('landing.title')} description={t('landing.description')}>
          <LandingChoice />
        </SettingRow>
      </>
    );
  }
  if (categoryId === 'canvas') {
    return (
      <>
        <SettingSection id="setting-section-grid" title={t('canvasPrefs.gridSection')}>
          <SettingRow id="setting-show-grid" heading="h4" title={t('canvasPrefs.showGrid')} description={t('canvasPrefs.showGridDescription')}>
            <PreferenceSwitch name="showGrid" labelledBy="setting-show-grid-title" describedBy="setting-show-grid-description" />
          </SettingRow>
          <SettingRow id="setting-snap-grid" heading="h4" title={t('canvasPrefs.snapToGrid')} description={t('canvasPrefs.snapToGridDescription')}>
            <PreferenceSwitch name="snapToGrid" labelledBy="setting-snap-grid-title" describedBy="setting-snap-grid-description" />
          </SettingRow>
        </SettingSection>
        <SettingSection id="setting-section-navigation" title={t('canvasPrefs.navigationSection')}>
          <SettingRow id="setting-zoom-focus" heading="h4" title={t('canvasPrefs.zoomFocus')} description={t('canvasPrefs.zoomFocusDescription')}>
            <PreferenceChoice name="zoomFocus" options={ZOOM_FOCUS_OPTIONS} labelKey="canvasPrefs.zoomFocus" />
          </SettingRow>
          <SettingRow id="setting-board-open-view" heading="h4" title={t('canvasPrefs.boardOpenView')} description={t('canvasPrefs.boardOpenViewDescription')}>
            <PreferenceChoice name="boardOpenView" options={BOARD_OPEN_VIEW_OPTIONS} labelKey="canvasPrefs.boardOpenView" />
          </SettingRow>
        </SettingSection>
      </>
    );
  }
  if (categoryId === 'collaboration') {
    return (
      <>
        <SettingSection id="setting-section-presence" title={t('collabPrefs.presenceSection')}>
          <SettingRow id="setting-collab-cursors" heading="h4" title={t('collabPrefs.cursors')} description={t('collabPrefs.cursorsDescription')}>
            <PreferenceSwitch name="showCollaboratorCursors" labelledBy="setting-collab-cursors-title" describedBy="setting-collab-cursors-description" />
          </SettingRow>
          <SettingRow id="setting-collab-names" heading="h4" title={t('collabPrefs.names')} description={t('collabPrefs.namesDescription')}>
            <PreferenceSwitch name="showCollaboratorNames" labelledBy="setting-collab-names-title" describedBy="setting-collab-names-description" />
          </SettingRow>
          <SettingRow id="setting-collab-online" heading="h4" title={t('collabPrefs.online')} description={t('collabPrefs.onlineDescription')}>
            <PreferenceSwitch name="showOnlineCollaborators" labelledBy="setting-collab-online-title" describedBy="setting-collab-online-description" />
          </SettingRow>
        </SettingSection>
        <SettingSection id="setting-section-collab-notifications" title={t('collabPrefs.notificationsSection')}>
          <SettingRow id="setting-collab-notices" heading="h4" title={t('collabPrefs.notices')} description={t('collabPrefs.noticesDescription')}>
            <PreferenceSwitch name="collaboratorNotifications" labelledBy="setting-collab-notices-title" describedBy="setting-collab-notices-description" />
          </SettingRow>
        </SettingSection>
      </>
    );
  }
  if (categoryId === 'accessibility') {
    return (
      <SettingRow id="setting-motion" title={t('motion.title')} description={t('motion.description')}>
        <ReduceMotionSwitch labelledBy="setting-motion-title" describedBy="setting-motion-description" />
      </SettingRow>
    );
  }
  if (categoryId === 'voice-ai') {
    return (
      <>
        <SettingRow id="setting-quick-dictation" title={t('quickDictation.title')} description={t('quickDictation.description')}>
          <PreferenceSwitch name="quickDictation" labelledBy="setting-quick-dictation-title" describedBy="setting-quick-dictation-description" />
        </SettingRow>
        <SettingRow id="setting-quick-dictation-interval" labelFor="setting-quick-dictation-interval-select" title={t('quickDictation.intervalTitle')} description={t('quickDictation.intervalDescription')}>
          <QuickDictationIntervalSelect id="setting-quick-dictation-interval-select" />
        </SettingRow>
        <SettingRow id="setting-microphone" title={t('quickDictation.micTitle')} description={t('quickDictation.micDescription')}>
          <MicrophoneStatus />
        </SettingRow>
      </>
    );
  }
  if (categoryId === 'tools') {
    return (
      <SettingRow id="setting-shortcuts" title={t('shortcuts.title')} description={t('shortcuts.description')}>
        <dl className="flex flex-col gap-2">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.labelKey} className="flex items-center justify-between gap-4 rounded-[12px] bg-surface-container-low px-4 py-3">
              <dt className="font-body text-sm text-on-surface">{t(shortcut.labelKey)}</dt>
              <dd className="font-label text-xs font-bold text-on-surface-variant">{t(shortcut.keysKey)}</dd>
            </div>
          ))}
        </dl>
      </SettingRow>
    );
  }
  return <p className="font-body text-sm text-on-surface-variant">{t('settings.empty', { category: label })}</p>;
};

export const SettingsPage = () => {
  const { categoryId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const returnPath = getBoardReturnPath(location.state);
  const category = getSettingsCategory(categoryId);
  const activeLinkRef = useRef(null);

  useEffect(() => {
    activeLinkRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [categoryId]);

  if (!category) {
    return <Navigate to={`/settings/${DEFAULT_SETTINGS_CATEGORY_ID}`} state={location.state} replace />;
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
      {returnPath && (
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 -ml-2 h-8 px-2 rounded-[12px] flex items-center gap-1 font-label text-sm font-semibold text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
          <span>{t('settings.backToBoard')}</span>
        </button>
      )}
      <header className="mb-6 md:mb-8">
        <h1 className="font-headline text-3xl font-bold text-on-surface">{t('settings.title')}</h1>
        <p className="font-body text-sm text-on-surface-variant mt-1">
          {t('settings.subtitle')}
        </p>
      </header>

      <div className="flex flex-col md:flex-row gap-6 md:gap-10">
        <nav aria-label={t('settings.categoriesLabel')} className="md:w-60 shrink-0">
          <ul className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0 md:sticky md:top-24 [scrollbar-width:none]">
            {SETTINGS_CATEGORIES.map((item) => (
              <li key={item.id} className="shrink-0">
                <NavLink
                  to={`/settings/${item.id}`}
                  state={location.state}
                  replace
                  ref={item.id === category.id ? activeLinkRef : undefined}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 h-10 px-3 rounded-[12px] font-label text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                      isActive
                        ? 'bg-secondary-container text-on-secondary-container font-bold'
                        : 'font-semibold text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                    }`
                  }
                >
                  <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span>{t(`settings.category.${item.id}.label`)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <section aria-labelledby="settings-category-title" className="flex-1 min-w-0">
          <h2 id="settings-category-title" className="font-headline text-xl font-bold text-on-surface">
            {t(`settings.category.${category.id}.label`)}
          </h2>
          <p className="font-body text-sm text-on-surface-variant mt-1">{t(`settings.category.${category.id}.description`)}</p>
          <div className="mt-6 pt-6 border-t border-outline-variant/60">
            <CategoryContent categoryId={category.id} label={t(`settings.category.${category.id}.label`)} />
          </div>
        </section>
      </div>
    </div>
  );
};

export default SettingsPage;
