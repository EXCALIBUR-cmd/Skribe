import User from '../models/User.js';

export class UserRepository {

  async createUser(userData) {
    const user = new User(userData);
    return await user.save();
  }

  async findByEmail(email, includePassword = false) {
    const query = User.findOne({ email: email.toLowerCase().trim() });
    if (includePassword) {
      query.select('+password');
    }
    return await query.exec();
  }

  async findById(id, includePassword = false) {
    const query = User.findById(id);
    if (includePassword) {
      query.select('+password');
    }
    return await query.exec();
  }

  async updateUser(id, updateData) {
    return await User.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).exec();
  }
}

export const userRepository = new UserRepository();
export default userRepository;
