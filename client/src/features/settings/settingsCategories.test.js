import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_CATEGORIES,
  DEFAULT_SETTINGS_CATEGORY_ID,
  getSettingsCategory
} from './settingsCategories.js';

test('settings exposes the six planned categories in order', () => {
  assert.deepEqual(
    SETTINGS_CATEGORIES.map((category) => category.label),
    ['General', 'Canvas', 'Tools & Keyboard Shortcuts', 'Voice & AI', 'Collaboration', 'Accessibility']
  );
});

test('every category has a unique url-safe id, an icon and a description', () => {
  const ids = SETTINGS_CATEGORIES.map((category) => category.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const category of SETTINGS_CATEGORIES) {
    assert.match(category.id, /^[a-z]+(-[a-z]+)*$/);
    assert.ok(category.icon);
    assert.ok(category.description.endsWith('.'));
  }
});

test('getSettingsCategory resolves known ids and rejects unknown ones', () => {
  assert.equal(getSettingsCategory('voice-ai').label, 'Voice & AI');
  assert.equal(getSettingsCategory(DEFAULT_SETTINGS_CATEGORY_ID).label, 'General');
  assert.equal(getSettingsCategory('missing'), null);
  assert.equal(getSettingsCategory(undefined), null);
});
