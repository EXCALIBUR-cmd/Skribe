export const APPEARANCES = Object.freeze(['light', 'dark', 'system']);
export const LANGUAGES = Object.freeze(['en', 'hi']);
export const LANDING_PAGES = Object.freeze(['boards', 'lastBoard']);
export const CANVAS_BACKGROUNDS = Object.freeze([
  'default',
  'paper',
  'mist',
  'stone',
  'sand',
  'linen',
  'graphite',
  'slate',
  'midnight',
  'espresso'
]);

export const QUICK_DICTATION_INTERVALS = Object.freeze([200, 300, 400, 500]);

export const DEFAULT_PREFERENCES = Object.freeze({
  appearance: 'system',
  language: 'en',
  landingPage: 'boards',
  reduceMotion: false,
  quickDictation: true,
  quickDictationInterval: 300
});

export const PREFERENCE_RULES = Object.freeze({
  appearance: (value) => APPEARANCES.includes(value),
  language: (value) => LANGUAGES.includes(value),
  landingPage: (value) => LANDING_PAGES.includes(value),
  reduceMotion: (value) => typeof value === 'boolean',
  quickDictation: (value) => typeof value === 'boolean',
  quickDictationInterval: (value) => QUICK_DICTATION_INTERVALS.includes(value)
});
