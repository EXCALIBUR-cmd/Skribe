export const DEFAULT_PREFERENCES = Object.freeze({
  appearance: 'system',
  language: 'en',
  landingPage: 'boards',
  reduceMotion: false
});

export const APPEARANCE_OPTIONS = Object.freeze([
  { value: 'light', icon: 'light_mode', labelKey: 'appearance.light' },
  { value: 'dark', icon: 'dark_mode', labelKey: 'appearance.dark' },
  { value: 'system', icon: 'desktop_windows', labelKey: 'appearance.system' }
]);

export const LANGUAGE_OPTIONS = Object.freeze([
  { value: 'en', nativeName: 'English' },
  { value: 'hi', nativeName: 'हिन्दी' }
]);

export const LANDING_OPTIONS = Object.freeze([
  { value: 'boards', labelKey: 'landing.boards', descriptionKey: 'landing.boardsDescription' },
  { value: 'lastBoard', labelKey: 'landing.lastBoard', descriptionKey: 'landing.lastBoardDescription' }
]);

export const CANVAS_BACKGROUNDS = Object.freeze([
  { key: 'default', labelKey: 'background.default', light: '#F8F9FF', dark: '#121418' },
  { key: 'paper', labelKey: 'background.paper', light: '#FFFFFF', dark: '#FFFFFF' },
  { key: 'mist', labelKey: 'background.mist', light: '#EEF1F6', dark: '#EEF1F6' },
  { key: 'stone', labelKey: 'background.stone', light: '#DADDE3', dark: '#DADDE3' },
  { key: 'sand', labelKey: 'background.sand', light: '#F5EFE3', dark: '#F5EFE3' },
  { key: 'linen', labelKey: 'background.linen', light: '#E9DFCF', dark: '#E9DFCF' },
  { key: 'graphite', labelKey: 'background.graphite', light: '#232428', dark: '#232428' },
  { key: 'slate', labelKey: 'background.slate', light: '#1C2331', dark: '#1C2331' },
  { key: 'midnight', labelKey: 'background.midnight', light: '#0F1117', dark: '#0F1117' },
  { key: 'espresso', labelKey: 'background.espresso', light: '#241E1A', dark: '#241E1A' }
]);

export const resolveAppearance = (appearance, systemPrefersDark) => {
  if (appearance === 'dark' || appearance === 'light') return appearance;
  return systemPrefersDark ? 'dark' : 'light';
};

export const resolveCanvasBackground = (key, resolvedTheme) => {
  const entry = CANVAS_BACKGROUNDS.find((background) => background.key === key) || CANVAS_BACKGROUNDS[0];
  return resolvedTheme === 'dark' ? entry.dark : entry.light;
};

export const normalizePreferences = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  return {
    appearance: APPEARANCE_OPTIONS.some((option) => option.value === source.appearance) ? source.appearance : DEFAULT_PREFERENCES.appearance,
    language: LANGUAGE_OPTIONS.some((option) => option.value === source.language) ? source.language : DEFAULT_PREFERENCES.language,
    landingPage: LANDING_OPTIONS.some((option) => option.value === source.landingPage) ? source.landingPage : DEFAULT_PREFERENCES.landingPage,
    reduceMotion: typeof source.reduceMotion === 'boolean' ? source.reduceMotion : DEFAULT_PREFERENCES.reduceMotion
  };
};
