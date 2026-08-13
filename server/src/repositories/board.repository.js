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
    return await Board.findOne(query).exec();
  }

  async findBoardsByOwner(ownerId, options = {}) {
    const query = { owner: ownerId, isDeleted: false };
    const sort = { updatedAt: -1 };

    let findQuery = Board.find(query).sort(sort);

    if (options.limit && options.limit > 0) {
      const page = options.page && options.page > 0 ? options.page : 1;
      const skip = (page - 1) * options.limit;
      findQuery = findQuery.skip(skip).limit(options.limit);
    }

    return await findQuery.exec();
  }

  async updateBoard(id, updateData) {
    return await Board.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { $set: updateData },
      { new: true, runValidators: true }
    ).exec();
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
