let activeCanvas = null;

export const registerDictationCanvas = (handle) => {
  activeCanvas = handle;
  return () => {
    if (activeCanvas === handle) activeCanvas = null;
  };
};

export const getDictationCanvas = () => activeCanvas;
