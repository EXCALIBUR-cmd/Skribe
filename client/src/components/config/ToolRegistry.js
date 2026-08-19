
export const TOOL_REGISTRY = {
  sticky: {
    categoryLabel: 'Sticky Notes & Cards',
    items: [
      { id: 'sticky_yellow', label: 'Classic Yellow Note', colorDot: '#fff3a0', toolType: 'sticky' },
      { id: 'sticky_pink', label: 'Coral Pink Note', colorDot: '#fce7f3', toolType: 'sticky' },
      { id: 'sticky_blue', label: 'Sky Blue Note', colorDot: '#e0f2fe', toolType: 'sticky' },
      { id: 'sticky_green', label: 'Mint Green Note', colorDot: '#dcfce7', toolType: 'sticky' },
      { id: 'sticky_callout', label: 'Callout Note', icon: 'chat_bubble', toolType: 'callout' }
    ]
  },

  shapes: {
    categoryLabel: 'Shapes',
    items: [
      { id: 'rect', label: 'Rectangle', icon: 'rectangle', toolType: 'rect' },
      { id: 'rounded_rect', label: 'Rounded Rectangle', icon: 'square', toolType: 'rounded_rect' },
      { id: 'circle', label: 'Circle', icon: 'circle', toolType: 'circle' },
      { id: 'triangle', label: 'Triangle', icon: 'change_history', toolType: 'triangle' },
      { id: 'diamond', label: 'Diamond', icon: 'diamond', toolType: 'diamond' },
      { id: 'hexagon', label: 'Hexagon', icon: 'hexagon', toolType: 'hexagon' }
    ]
  },

  image: {
    categoryLabel: 'Image / Assets',
    items: [
      { id: 'upload_image', label: 'Upload Image', icon: 'upload_file', actionType: 'upload' },
      { id: 'icons_gallery', label: 'Icons Gallery', icon: 'grid_view', actionType: 'gallery' },
      { id: 'stickers', label: 'Stickers Pack', icon: 'sentiment_satisfied', actionType: 'stickers' },
      { id: 'templates', label: 'Templates', icon: 'dashboard', actionType: 'templates' }
    ]
  },

  connectors: {
    categoryLabel: 'Smart Connectors',
    items: [
      { id: 'arrow_straight', label: 'Straight Connector', icon: 'east', toolType: 'arrow', connectorType: 'straight' },
      { id: 'connector_elbow', label: 'Elbow Connector', icon: 'call_split', toolType: 'arrow', connectorType: 'elbow' },
      { id: 'connector_curved', label: 'Curved Connector', icon: 'timeline', toolType: 'arrow', connectorType: 'curved' },
      { id: 'line', label: 'Straight Line', icon: 'horizontal_rule', toolType: 'line' }
    ]
  },

  text: {
    categoryLabel: 'Text',
    items: [
      { id: 'text_heading', label: 'Heading', icon: 'format_size', toolType: 'text' },
      { id: 'text_body', label: 'Body Text', icon: 'notes', toolType: 'text' },
      { id: 'text_code', label: 'Code Block', icon: 'code', toolType: 'text' },
      { id: 'text_label', label: 'Small Label', icon: 'label', toolType: 'text' }
    ]
  }
};

export const getMenuItemsForCategory = (categoryKey) => {
  if (!categoryKey) {
    console.log('[ToolRegistry] Requested category: null -> Returned items: 0');
    return [];
  }
  const entry = TOOL_REGISTRY[categoryKey];
  const items = entry ? entry.items : [];
  console.log(`[ToolRegistry] Requested category: ${categoryKey} -> Returned items: ${items.length}`);
  return items;
};

export const getCategoryLabel = (categoryKey) => {
  const entry = TOOL_REGISTRY[categoryKey];
  return entry ? entry.categoryLabel : 'Tools';
};
