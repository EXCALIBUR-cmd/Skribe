export const SETTINGS_CATEGORIES = [
  {
    id: 'general',
    label: 'General',
    icon: 'tune',
    description: 'Personalise your Skribe workspace and application experience.'
  },
  {
    id: 'canvas',
    label: 'Canvas',
    icon: 'grid_on',
    description: 'Configure how you interact with and navigate the infinite canvas.'
  },
  {
    id: 'tools',
    label: 'Tools & Keyboard Shortcuts',
    icon: 'keyboard',
    description: 'Manage tool behaviour and keyboard interactions.'
  },
  {
    id: 'voice-ai',
    label: 'Voice & AI',
    icon: 'mic',
    description: 'Configure voice dictation, voice commands and AI-assisted interactions.'
  },
  {
    id: 'collaboration',
    label: 'Collaboration',
    icon: 'group',
    description: 'Personalise your real-time collaboration experience.'
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    icon: 'accessibility_new',
    description: 'Adjust the interface and interactions to make Skribe more accessible.'
  }
];

export const DEFAULT_SETTINGS_CATEGORY_ID = 'general';

export const getSettingsCategory = (id) => SETTINGS_CATEGORIES.find((category) => category.id === id) ?? null;
