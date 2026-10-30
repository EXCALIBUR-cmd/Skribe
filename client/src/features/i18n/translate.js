import en from './en.js';
import hi from './hi.js';

const DICTIONARIES = { en, hi };

export const translate = (language, key, vars) => {
  const template = DICTIONARIES[language]?.[key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])));
};

export const missingKeys = (language) => Object.keys(en).filter((key) => !(key in (DICTIONARIES[language] || {})));
