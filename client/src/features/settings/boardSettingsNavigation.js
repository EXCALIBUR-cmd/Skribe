const BOARD_PATH = /^\/board\/[A-Za-z0-9_-]+$/;

export const getBoardReturnPath = (state) => {
  const from = state?.from;
  return typeof from === 'string' && (BOARD_PATH.test(from) || from === '/canvas') ? from : null;
};

export const flushCanvasBeforeNavigate = async ({ controller, canvasData, hasUnsavedLegacyChanges, flushViewport }) => {
  try {
    await flushViewport?.();
    if (!controller) return { ok: false, code: 'NO_SYNC_CONTROLLER' };
    if (controller.isEnabled()) {
      await controller.drain();
      if (!controller.hasUnsavedWork()) return { ok: true };
      const result = await controller.persist(null);
      return result?.ok && !controller.hasUnsavedWork() ? { ok: true } : { ok: false, code: result?.code || 'UNSAVED_WORK' };
    }
    if (!hasUnsavedLegacyChanges) return { ok: true };
    const result = await controller.persist(canvasData);
    return result?.ok ? { ok: true, saved: true } : { ok: false, code: result?.code || 'SAVE_FAILED' };
  } catch (err) {
    return { ok: false, code: err?.code || 'SAVE_FAILED' };
  }
};

export const openSettingsFromBoard = async ({ flush, navigate, from, onFailure }) => {
  const result = await flush();
  if (result?.ok) {
    navigate('/settings', { state: { from } });
  } else {
    onFailure?.(result);
  }
  return result;
};
