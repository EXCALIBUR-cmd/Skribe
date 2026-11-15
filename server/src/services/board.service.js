import boardRepository from '../repositories/board.repository.js';
import userRepository from '../repositories/user.repository.js';
import config from '../config/env.js';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { GUEST_BOARD_LIFETIME_MS, GUEST_CLEANUP_LIMIT, GUEST_ID_PATTERN, MAX_GUEST_BOARD_OBJECTS, hasImageContent, isGuestUser } from '../utils/guest.js';

const httpError = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, code });
const hashShareSecret = (secret) => crypto.createHash('sha256').update(secret).digest('hex');
const SHARE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const guestImagesError = () => httpError(403, 'Images cannot be added to guest boards. Sign up free to add images.', 'GUEST_IMAGES_DISABLED');

export const guestObjectLimitError = () => httpError(403, `Guest boards can hold up to ${MAX_GUEST_BOARD_OBJECTS} objects. Sign up free to keep adding more.`, 'GUEST_OBJECT_LIMIT');

const UPDATABLE_BOARD_FIELDS = Object.freeze(['title', 'canvasData', 'isArchived', 'thumbnail', 'canvasBackground']);

export class BoardService {
  _isExpired(board, now = Date.now()) {
    return Boolean(board?.isGuest && (!board.expiresAt || new Date(board.expiresAt).getTime() <= now));
  }

  _isOwner(board, userId) {
    if (!board || userId === undefined || userId === null || this._isExpired(board)) return false;
    if (board.isGuest) return typeof board.ownerGuestId === 'string' && board.ownerGuestId === String(userId);
    if (!board.owner) return false;
    const ownerId = board.owner._id ? board.owner._id.toString() : board.owner.toString();
    return ownerId === userId.toString();
  }

  _isMember(board, userId) {
    if (!board || userId === undefined || userId === null || this._isExpired(board)) return false;
    if (Array.isArray(board.guestMembers) && board.guestMembers.includes(String(userId))) return true;
    if (!Array.isArray(board.members)) return false;
    return board.members.some((m) => {
      const memberId = m._id ? m._id.toString() : m.toString();
      return memberId === userId.toString();
    });
  }

  _verifyAccess(board, userId) {
    if (!board || this._isExpired(board)) {
      const err = new Error('Board not found');
      err.statusCode = 404;
      throw err;
    }

    if (!this._isOwner(board, userId) && !this._isMember(board, userId)) {
      const err = new Error('You do not have permission to access or modify this board');
      err.statusCode = 403;
      throw err;
    }
  }

  _verifyOwner(board, userId) {
    if (!board) {
      const err = new Error('Board not found');
      err.statusCode = 404;
      throw err;
    }

    if (!this._isOwner(board, userId)) {
      const err = new Error('Only the board owner can perform this action');
      err.statusCode = 403;
      throw err;
    }
  }

  async createBoard(userId, { title, canvasData, thumbnail }) {
    const boardTitle =
      title && typeof title === 'string' && title.trim().length > 0
        ? title.trim()
        : 'Untitled Board';

    const defaultCanvas = {
      version: '6.5.1',
      objects: []
    };

    const newBoard = await boardRepository.createBoard({
      owner: userId,
      title: boardTitle,
      canvasData: canvasData && typeof canvasData === 'object' ? canvasData : defaultCanvas,
      thumbnail: thumbnail || ''
    });

    return newBoard.toJSON();
  }

  async startGuestBoard(guest) {
    const active = await boardRepository.findGuestBoard(guest.id);
    if (active) return this._isExpired(active) ? { expired: true } : { board: active.toJSON(), created: false };
    try {
      const board = await boardRepository.createBoard({
        isGuest: true,
        ownerGuestId: guest.id,
        expiresAt: new Date(Date.now() + GUEST_BOARD_LIFETIME_MS),
        title: 'Guest board'
      });
      console.log(JSON.stringify({ event: 'guest_board_created', guestId: guest.id, boardId: String(board._id), at: new Date().toISOString() }));
      return { board: board.toJSON(), created: true };
    } catch (err) {
      if (err?.code !== 11000) throw err;
      const winner = await boardRepository.findGuestBoard(guest.id);
      if (!winner || this._isExpired(winner)) return { expired: true };
      return { board: winner.toJSON(), created: false };
    }
  }

  async rotateShareLink(boardId, userId) {
    const board = await boardRepository.findBoardShareState(boardId);
    this._verifyAccess(board, userId);
    this._verifyOwner(board, userId);
    if (!board.isGuest && !board.shareLinkHash) throw httpError(403, 'Share links are available on guest boards only.', 'SHARE_LINKS_UNAVAILABLE');
    const secret = crypto.randomBytes(32).toString('base64url');
    await boardRepository.setShareLinkHash(boardId, hashShareSecret(secret));
    return { secret };
  }

  async verifyShareLink(boardId, secret) {
    const board = await boardRepository.findBoardShareState(boardId);
    if (!board || this._isExpired(board)) throw httpError(404, 'Board not found', 'BOARD_NOT_FOUND');
    const valid = typeof secret === 'string' && SHARE_SECRET_PATTERN.test(secret) && typeof board.shareLinkHash === 'string'
      && crypto.timingSafeEqual(Buffer.from(hashShareSecret(secret), 'hex'), Buffer.from(board.shareLinkHash, 'hex'));
    if (!valid) throw httpError(403, 'This share link is not valid. Ask the board owner for a new one.', 'INVALID_SHARE_LINK');
    return board;
  }

  async joinWithShareLink(board, user) {
    const boardId = String(board._id);
    const alreadyIn = this._isOwner(board, user.id) || this._isMember(board, user.id);
    const joined = alreadyIn
      ? await boardRepository.findBoardById(boardId)
      : await boardRepository.addLinkMember(boardId, isGuestUser(user) ? { guestMembers: user.id } : { members: user.id });
    if (!joined) throw httpError(404, 'Board not found', 'BOARD_NOT_FOUND');
    if (!alreadyIn && board.isGuest) {
      console.log(JSON.stringify({ event: 'guest_invited_someone', boardId, ownerGuestId: board.ownerGuestId, joinedAs: isGuestUser(user) ? 'guest' : 'account', at: new Date().toISOString() }));
    }
    return joined.toJSON();
  }

  async reserveGuestCleanup(user, boardId) {
    if (!boardId) {
      if (isGuestUser(user)) throw httpError(400, 'Mess Cleanup needs the board it is cleaning up.', 'BOARD_REQUIRED');
      return null;
    }
    if (typeof boardId !== 'string' || !mongoose.isValidObjectId(boardId)) throw httpError(400, 'A valid board is required', 'INVALID_BOARD');
    const board = await boardRepository.findBoardAccess(boardId);
    this._verifyAccess(board, user?.id);
    if (!board.isGuest) {
      if (isGuestUser(user)) throw httpError(403, 'Sign up free to use this feature.', 'GUEST_NOT_ALLOWED');
      return null;
    }
    const reserved = await boardRepository.reserveGuestCleanup(boardId, GUEST_CLEANUP_LIMIT);
    if (!reserved) throw httpError(403, 'Sign up free to keep using Mess Cleanup.', 'GUEST_CLEANUP_LIMIT');
    return { boardId, uses: reserved.cleanupUses };
  }

  async releaseGuestCleanup(reservation) {
    if (reservation) await boardRepository.releaseGuestCleanup(reservation.boardId);
  }

  async getUserBoards(userId, options = {}) {
    const boards = await boardRepository.findUserBoards(userId, options);
    return boards.map((b) => b.toJSON());
  }

  async getBoardById(boardId, userId) {
    const board = await boardRepository.findBoardById(boardId);
    this._verifyAccess(board, userId);

    const updatedBoard = await boardRepository.updateBoard(boardId, {
      lastOpenedAt: new Date()
    });
    if (!GUEST_ID_PATTERN.test(String(userId))) {
      await userRepository.updateUser(userId, { lastOpenedBoard: board._id }).catch((err) => {
        console.error('[BoardService] Failed to record last opened board:', err.message);
      });
    }

    const boardJson = (updatedBoard || board).toJSON();
    boardJson.viewportStates = (boardJson.viewportStates || []).filter(
      (state) => String(state.userId) === String(userId)
    );
    return boardJson;
  }

  async resolveLandingPath(user) {
    const boardsPath = '/boards';
    if (user?.preferences?.landingPage !== 'lastBoard' || !user.lastOpenedBoard) return boardsPath;
    const board = await boardRepository.findBoardAccess(user.lastOpenedBoard);
    if (!board || (!this._isOwner(board, user.id) && !this._isMember(board, user.id))) return boardsPath;
    return `/board/${board._id}`;
  }

  async saveViewport(boardId, userId, viewport) {
    const board = await boardRepository.findBoardById(boardId);
    this._verifyAccess(board, userId);

    const viewportStates = Array.isArray(board.viewportStates)
      ? board.viewportStates.filter((state) => String(state.userId) !== String(userId))
      : [];
    viewportStates.push({ userId, viewport });

    const updatedBoard = await boardRepository.updateBoard(boardId, { viewportStates });
    return updatedBoard.toJSON();
  }

  async updateBoard(boardId, userId, updatePayload) {
    const board = await boardRepository.findBoardAccess(boardId);
    this._verifyAccess(board, userId);

    const payload = updatePayload || {};
    const allowedUpdates = Object.fromEntries(
      UPDATABLE_BOARD_FIELDS.filter((field) => payload[field] !== undefined).map((field) => [field, payload[field]])
    );

    if (allowedUpdates.title && typeof allowedUpdates.title === 'string') {
      allowedUpdates.title = allowedUpdates.title.trim();
    }

    if (board.isGuest && Array.isArray(allowedUpdates.canvasData?.objects) && allowedUpdates.canvasData.objects.length > MAX_GUEST_BOARD_OBJECTS) {
      throw guestObjectLimitError();
    }
    if (board.isGuest && allowedUpdates.canvasData !== undefined && hasImageContent(allowedUpdates.canvasData)) {
      throw guestImagesError();
    }

    if (allowedUpdates.canvasData === undefined) {
      const updatedBoard = await boardRepository.updateBoard(boardId, allowedUpdates);
      if (!updatedBoard) {
        const err = new Error('Board not found');
        err.statusCode = 404;
        throw err;
      }
      return updatedBoard.toJSON();
    }

    const hasBaseRevision = payload.baseRevision !== undefined;
    if (hasBaseRevision && !config.collabOperationsEnabled) {
      const err = new Error('Revision-aware saves are not enabled on this server');
      err.statusCode = 400;
      err.code = 'REVISION_PROTOCOL_DISABLED';
      throw err;
    }
    const ifRevision = !config.collabOperationsEnabled && Number.isInteger(payload.ifRevision) ? payload.ifRevision : undefined;
    const opId = typeof payload.opId === 'string' ? payload.opId : undefined;
    const savedBoard = hasBaseRevision
      ? await boardRepository.saveCanvasAtRevision(boardId, payload.baseRevision, allowedUpdates, opId)
      : config.collabOperationsEnabled
        ? null
        : await boardRepository.saveLegacyCanvas(boardId, allowedUpdates, { requireLegacyBoard: false, ifRevision, opId });
    if (savedBoard) return savedBoard.toJSON();

    const latest = await boardRepository.findBoardRevision(boardId);
    if (!latest) {
      const err = new Error('Board not found');
      err.statusCode = 404;
      throw err;
    }
    const err = new Error(hasBaseRevision || ifRevision !== undefined
      ? 'The board changed since this version was loaded'
      : 'This board now requires revision-aware saves; reload it to continue');
    err.statusCode = 409;
    err.code = ifRevision !== undefined ? 'CANVAS_CHANGED' : hasBaseRevision ? 'STALE_REVISION' : 'REVISION_REQUIRED';
    err.currentRevision = latest.canvasRevision || 0;
    throw err;
  }

  async deleteBoard(boardId, userId) {
    const board = await boardRepository.findBoardById(boardId);
    this._verifyOwner(board, userId);

    const deletedBoard = await boardRepository.softDeleteBoard(boardId);
    return deletedBoard ? deletedBoard.toJSON() : null;
  }

  async addCollaborator(boardId, ownerUserId, email) {
    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      const err = new Error('Collaborator email is required');
      err.statusCode = 400;
      throw err;
    }

    const board = await boardRepository.findBoardById(boardId);
    this._verifyOwner(board, ownerUserId);

    const targetUser = await userRepository.findByEmail(email.trim());
    if (!targetUser) {
      const err = new Error('User with this email was not found');
      err.statusCode = 404;
      throw err;
    }

    if (targetUser.id.toString() === ownerUserId.toString()) {
      const err = new Error('Owner is already the owner of this board');
      err.statusCode = 400;
      throw err;
    }

    if (this._isMember(board, targetUser.id)) {
      const err = new Error('User is already a collaborator');
      err.statusCode = 400;
      throw err;
    }

    await boardRepository.addCollaborator(boardId, targetUser.id);
    return {
      id: targetUser.id,
      name: targetUser.name,
      email: targetUser.email,
      avatar: targetUser.avatar || null
    };
  }

  async removeCollaborator(boardId, ownerUserId, collaboratorUserId) {
    const board = await boardRepository.findBoardById(boardId);
    this._verifyOwner(board, ownerUserId);

    if (!this._isMember(board, collaboratorUserId)) {
      const err = new Error('User is not a collaborator on this board');
      err.statusCode = 400;
      throw err;
    }

    await boardRepository.removeCollaborator(boardId, collaboratorUserId);
    return true;
  }

  async getCollaborators(boardId, userId) {
    const board = await boardRepository.findBoardById(boardId);
    this._verifyAccess(board, userId);

    if (!Array.isArray(board.members)) return [];

    return board.members.map((m) => ({
      id: m._id ? m._id.toString() : m.toString(),
      name: m.name || '',
      email: m.email || '',
      avatar: m.avatar || null
    }));
  }
}

export const boardService = new BoardService();
export default boardService;
