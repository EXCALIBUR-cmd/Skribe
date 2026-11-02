import mongoose from 'mongoose';
import { error, success } from '../utils/apiResponse.js';
import boardRepository from '../repositories/board.repository.js';
import boardService from '../services/board.service.js';
import { askSidekick, SIDEKICK_LIMITS } from '../services/sidekickService.js';
import { buildSidekickContext, SIDEKICK_CONTEXT_LIMITS } from '../services/sidekickContext.js';

const MAX_REQUESTS_PER_USER_PER_MINUTE = 20;

const loadAuthorisedBoard = async (boardId, userId) => {
  const board = await boardRepository.findBoardById(boardId);
  boardService._verifyAccess(board, userId);
  return board;
};

export const createChatHandler = ({ ask = askSidekick, loadBoard = loadAuthorisedBoard } = {}) => {
  const requestsByUser = new Map();
  let windowStart = Date.now();

  return async (req, res, next) => {
    const clientAbortController = new AbortController();
    const handleClientClose = () => {
      if (!res.writableEnded) clientAbortController.abort();
    };
    if (typeof res.on === 'function') res.on('close', handleClientClose);

    try {
      const { boardId, message, selectedObjectIds = [], history = [] } = req.body || {};
      if (typeof boardId !== 'string' || !mongoose.Types.ObjectId.isValid(boardId)) {
        return error(res, 'A valid board is required.', 400, { code: 'SIDEKICK_INVALID_BOARD' });
      }
      if (typeof message !== 'string' || !message.trim()) {
        return error(res, 'Type a message for AI Sidekick.', 400, { code: 'SIDEKICK_INVALID_MESSAGE' });
      }
      if (message.length > SIDEKICK_LIMITS.message) {
        return error(res, `Messages are limited to ${SIDEKICK_LIMITS.message} characters.`, 400, { code: 'SIDEKICK_INVALID_MESSAGE' });
      }
      if (!Array.isArray(selectedObjectIds) || selectedObjectIds.length > SIDEKICK_CONTEXT_LIMITS.selectedIds || selectedObjectIds.some((id) => typeof id !== 'string' || id.length > 120)) {
        return error(res, 'The selection could not be read.', 400, { code: 'SIDEKICK_INVALID_SELECTION' });
      }
      if (!Array.isArray(history)) {
        return error(res, 'The conversation history could not be read.', 400, { code: 'SIDEKICK_INVALID_HISTORY' });
      }

      if (Date.now() - windowStart >= 60000) {
        requestsByUser.clear();
        windowStart = Date.now();
      }
      const userKey = String(req.user?.id ?? req.ip ?? '');
      const used = requestsByUser.get(userKey) || 0;
      if (used >= MAX_REQUESTS_PER_USER_PER_MINUTE) {
        return error(res, 'You have sent a lot of requests. Wait a minute and try again.', 429, { code: 'SIDEKICK_USER_RATE_LIMITED' });
      }

      let board;
      try {
        board = await loadBoard(boardId, req.user.id);
      } catch (accessErr) {
        const status = accessErr.statusCode === 403 ? 403 : 404;
        return error(res, status === 403 ? 'You do not have access to this board.' : 'Board not found.', status, { code: status === 403 ? 'SIDEKICK_FORBIDDEN' : 'SIDEKICK_BOARD_NOT_FOUND' });
      }

      requestsByUser.set(userKey, used + 1);
      const context = buildSidekickContext(board.canvasData?.objects, { selectedIds: selectedObjectIds, title: board.title });

      let output;
      try {
        output = await ask({ message: message.trim(), history, context }, { signal: clientAbortController.signal });
      } catch (serviceErr) {
        if (res.writableEnded || clientAbortController.signal.aborted) return;
        console.error('[Sidekick] Request failed:', { code: serviceErr.code, statusCode: serviceErr.statusCode });
        return error(res, serviceErr.message || 'AI Sidekick failed. Nothing was changed.', serviceErr.statusCode || 502, { code: serviceErr.code || 'SIDEKICK_FAILED' });
      }
      if (res.writableEnded || clientAbortController.signal.aborted) return;

      console.log(`[Sidekick] ${output.response.type} with ${output.response.actions.length} action(s), scope ${context.scope}, ${context.includedCount}/${context.objectCount} objects`);
      return success(res, {
        response: output.response,
        context: {
          boardId,
          revision: board.canvasRevision ?? 0,
          scope: context.scope,
          objectCount: context.objectCount,
          includedCount: context.includedCount,
          truncated: context.truncated,
          objectIds: context.objects.map((object) => object.id)
        },
        model: output.model
      }, 'AI Sidekick replied', 200);
    } catch (err) {
      if (res.writableEnded || clientAbortController.signal.aborted) return;
      return next(err);
    } finally {
      if (typeof res.removeListener === 'function') res.removeListener('close', handleClientClose);
    }
  };
};

export const chat = createChatHandler();

export default { chat, createChatHandler };
