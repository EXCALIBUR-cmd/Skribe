import Board from '../models/Board.js';

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
