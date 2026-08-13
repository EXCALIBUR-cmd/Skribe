
export const PROPERTY_SECTIONS = {
  APPEARANCE: 'appearance',
  TYPOGRAPHY: 'typography',
  STROKE: 'stroke',
  LAYOUT: 'layout',
  EFFECTS: 'effects',
  ACTIONS: 'actions'
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
      hasTextColor: true,
      hasFontFamily: true,
      hasFontSize: true,
      hasFontWeight: true,
      hasTextAlign: true
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
