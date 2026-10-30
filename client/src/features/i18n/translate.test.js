import assert from 'node:assert/strict';
import test from 'node:test';
import { translate, missingKeys } from './translate.js';
import en from './en.js';
import hi from './hi.js';
import { SETTINGS_CATEGORIES } from '../settings/settingsCategories.js';
import { APPEARANCE_OPTIONS, CANVAS_BACKGROUNDS, LANDING_OPTIONS } from '../settings/preferenceOptions.js';

test('Hindi covers every English key, so the selector never offers a half-empty language', () => {
  assert.deepEqual(missingKeys('hi'), []);
  assert.deepEqual(Object.keys(hi).filter((key) => !(key in en)), []);
});

test('translations interpolate variables and fall back to English, then to the key', () => {
  assert.equal(translate('hi', 'boards.activeCount', { count: 3 }), '3 सक्रिय बोर्ड');
  assert.equal(translate('en', 'settings.empty', { category: 'Canvas' }), 'No Canvas preferences are available yet.');
  assert.equal(translate('fr', 'nav.boards'), 'Boards');
  assert.equal(translate('hi', 'missing.key'), 'missing.key');
  assert.equal(translate('en', 'settings.empty'), 'No {category} preferences are available yet.');
});

test('every option label referenced by the UI exists in the dictionaries', () => {
  const keys = [
    ...SETTINGS_CATEGORIES.flatMap((category) => [`settings.category.${category.id}.label`, `settings.category.${category.id}.description`]),
    ...APPEARANCE_OPTIONS.map((option) => option.labelKey),
    ...LANDING_OPTIONS.flatMap((option) => [option.labelKey, option.descriptionKey]),
    ...CANVAS_BACKGROUNDS.map((background) => background.labelKey)
  ];
  for (const key of keys) {
    assert.ok(key in en, `en missing ${key}`);
    assert.ok(key in hi, `hi missing ${key}`);
  }
  for (const category of SETTINGS_CATEGORIES) {
    assert.equal(en[`settings.category.${category.id}.label`], category.label);
    assert.equal(en[`settings.category.${category.id}.description`], category.description);
  }
});
