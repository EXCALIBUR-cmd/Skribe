import Board from '../models/Board.js';

export const RECENT_OPERATION_LIMIT = 200;

export const revisionMatch = (revision) => (revision === 0 ? { $in: [0, null] } : revision);

export class BoardRepository {
  async createBoard(boardData) {
    const board = new Board(boardData);
    return await board.save();
  }

  async findBoardById(id, includeDeleted = false) {
    const query = { _id: id };
    if (!includeDeleted) {
      query.isDeleted = false;
    }
    return await Board.findOne(query)
      .populate('owner', 'name email avatar')
      .populate('members', 'name email avatar')
      .exec();
  }

  async findBoardAccess(id) {
    return await Board.findOne({ _id: id, isDeleted: false }, { owner: 1, members: 1 }).lean();
  }

  async findUserBoards(userId, options = {}) {
    const query = {
      isDeleted: false,
      $or: [{ owner: userId }, { members: userId }]
    };
    const sort = { updatedAt: -1 };

    let findQuery = Board.find(query)
      .populate('owner', 'name email avatar')
      .populate('members', 'name email avatar')
      .sort(sort);

    if (options.limit && options.limit > 0) {
      const page = options.page && options.page > 0 ? options.page : 1;
      const skip = (page - 1) * options.limit;
      findQuery = findQuery.skip(skip).limit(options.limit);
    }

    return await findQuery.exec();
  }

  async findBoardsByOwner(ownerId, options = {}) {
    return this.findUserBoards(ownerId, options);
  }

  async updateBoard(id, updateData) {
    return await Board.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .populate('owner', 'name email avatar')
      .populate('members', 'name email avatar')
      .exec();
  }

  async addCollaborator(boardId, memberUserId) {
    return await Board.findOneAndUpdate(
      { _id: boardId, isDeleted: false },
      { $addToSet: { members: memberUserId } },
      { new: true }
    )
      .populate('owner', 'name email avatar')
      .populate('members', 'name email avatar')
      .exec();
  }

  async removeCollaborator(boardId, memberUserId) {
    return await Board.findOneAndUpdate(
      { _id: boardId, isDeleted: false },
      { $pull: { members: memberUserId } },
      { new: true }
    )
      .populate('owner', 'name email avatar')
      .populate('members', 'name email avatar')
      .exec();
  }

  async findBoardRevisionState(id) {
    return await Board.findOne(
      { _id: id, isDeleted: false },
      { owner: 1, members: 1, canvasData: 1, canvasRevision: 1, lastOperationRevision: 1, recentOperations: 1 }
    ).lean();
  }

  async findBoardRevision(id) {
    return await Board.findOne({ _id: id, isDeleted: false }, { canvasRevision: 1 }).lean();
  }

  async commitCanvasOperation(id, { baseRevision, opId, canvasData }) {
    const revision = baseRevision + 1;
    return await Board.findOneAndUpdate(
      { _id: id, isDeleted: false, canvasRevision: revisionMatch(baseRevision), 'recentOperations.opId': { $ne: opId } },
      {
        $set: { canvasData, lastOperationRevision: revision },
        $inc: { canvasRevision: 1 },
        $push: { recentOperations: { $each: [{ opId, revision }], $slice: -RECENT_OPERATION_LIMIT } }
      },
      { new: true, projection: { canvasRevision: 1 } }
    ).lean();
  }

  async saveCanvasAtRevision(id, baseRevision, updateData) {
    return await Board.findOneAndUpdate(
      { _id: id, isDeleted: false, canvasRevision: revisionMatch(baseRevision) },
      { $set: { ...updateData, lastOperationRevision: baseRevision + 1 }, $inc: { canvasRevision: 1 } },
      { new: true, runValidators: true }
    )
      .populate('owner', 'name email avatar')
      .populate('members', 'name email avatar')
      .exec();
  }

  async saveLegacyCanvas(id, updateData, { requireLegacyBoard = true } = {}) {
    return await Board.findOneAndUpdate(
      requireLegacyBoard ? { _id: id, isDeleted: false, lastOperationRevision: { $in: [0, null] } } : { _id: id, isDeleted: false },
      { $set: updateData, $inc: { canvasRevision: 1 } },
      { new: true, runValidators: true }
    )
      .populate('owner', 'name email avatar')
      .populate('members', 'name email avatar')
      .exec();
  }

  async softDeleteBoard(id) {
    return await Board.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { $set: { isDeleted: true } },
      { new: true }
    ).exec();
  }
}

export const boardRepository = new BoardRepository();
export default boardRepository;
