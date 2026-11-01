
export const PROPERTY_SECTIONS = {
  APPEARANCE: 'appearance',
  TYPOGRAPHY: 'typography',
  STROKE: 'stroke',
  LAYOUT: 'layout',
  EFFECTS: 'effects',
  ACTIONS: 'actions'
};

const LEGACY_TYPOGRAPHY = {
  hasTextColor: true,
  hasFontFamily: true,
  hasFontSize: true,
  hasFontWeight: true,
  hasBold: true,
  hasTextAlign: true
};

const WEIGHTS = [['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold']];

const TEXT_KIND_TYPOGRAPHY = {
  heading: {
    hasTextColor: true,
    hasFontFamily: true,
    hasFontSize: true,
    fontSizes: [28, 32, 40, 48, 56, 64, 72],
    hasFontWeight: true,
    fontWeights: WEIGHTS,
    hasTextAlign: true
  },
  body: {
    hasTextColor: true,
    hasFontFamily: true,
    hasFontSize: true,
    fontSizes: [14, 16, 18, 20, 24],
    hasLineHeight: true,
    lineHeights: [1.3, 1.5, 1.7, 2],
    hasTextAlign: true
  },
  code: {
    hasTextColor: true,
    hasBackground: true,
    hasFontSize: true,
    fontSizes: [12, 13, 14, 16, 18]
  },
  label: {
    hasTextColor: true,
    hasBackground: true,
    hasFontWeight: true,
    fontWeights: WEIGHTS,
    hasTextAlign: true
  }
};

export const getRegisteredSectionsForObject = (selectedProps) => {
  if (!selectedProps || !selectedProps.hasSelection) return [];

  const {
    type,
    isStickyNote,
    isChecklistNote,
    isCalloutNote,
    isConnector,
    isStraightLine,
    hasText
  } = selectedProps;

  const sections = [];

  if (isStickyNote || isChecklistNote || isCalloutNote || ['rect', 'circle', 'triangle', 'polygon', 'path', 'ellipse'].includes(type)) {
    sections.push({
      id: PROPERTY_SECTIONS.APPEARANCE,
      title: 'Appearance',
      icon: 'palette',
      hasFill: true,
      hasBorder: true
    });
  } else if (isStraightLine || isConnector) {
    sections.push({
      id: PROPERTY_SECTIONS.APPEARANCE,
      title: 'Appearance',
      icon: 'palette',
      hasFill: false,
      hasBorder: true
    });
  }

  if (isStraightLine || isConnector || ['rect', 'circle', 'triangle', 'polygon', 'path', 'line'].includes(type) || isStickyNote || isChecklistNote || isCalloutNote) {
    sections.push({
      id: PROPERTY_SECTIONS.STROKE,
      title: isStraightLine || isConnector ? 'Stroke & Line' : 'Border Style',
      icon: 'timeline',
      hasStrokeWidth: true,
      hasStrokeStyle: true,
      hasArrowheads: !!(isConnector || isStraightLine)
    });
  }

  if (hasText || type === 'textbox' || type === 'i-text' || type === 'text') {
    sections.push({
      id: PROPERTY_SECTIONS.TYPOGRAPHY,
      title: 'Typography',
      icon: 'match_case',
      ...(TEXT_KIND_TYPOGRAPHY[selectedProps.textKind] || LEGACY_TYPOGRAPHY)
    });
  }

  sections.push({
    id: PROPERTY_SECTIONS.LAYOUT,
    title: 'Transform & Opacity',
    icon: 'transform',
    hasOpacity: true,
    hasRotation: true
  });

  sections.push({
    id: PROPERTY_SECTIONS.ACTIONS,
    title: 'Actions',
    icon: 'more_horiz',
    hasDuplicate: true,
    hasLayering: true,
    hasDelete: true
  });

  return sections;
};

export default {
  PROPERTY_SECTIONS,
  getRegisteredSectionsForObject
};
