import User from '../models/User.js';
import userRepository from '../repositories/user.repository.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { generateAccessToken } from '../utils/jwt.js';

export class AuthService {

  async registerUser({ name, email, password }) {
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await userRepository.findByEmail(normalizedEmail);
    if (existingUser) {
      const err = new Error('Email is already registered');
      err.statusCode = 409;
      throw err;
    }

    const hashedPassword = await hashPassword(password);

    const newUser = await userRepository.createUser({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      provider: 'local'
    });

    const token = generateAccessToken({ id: newUser.id, email: newUser.email });

    return {
      user: newUser.toJSON(),
      token
    };
  }

  async loginUser({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await userRepository.findByEmail(normalizedEmail, true);
    if (!user) {
      const err = new Error('Invalid email or password');
      err.statusCode = 401;
      throw err;
    }

    if (!user.password && user.provider === 'google') {
      const err = new Error('This account was created with Google Sign-In. Please sign in with Google.');
      err.statusCode = 400;
      throw err;
    }

    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      const err = new Error('Invalid email or password');
      err.statusCode = 401;
      throw err;
    }

    const token = generateAccessToken({ id: user.id, email: user.email });

    return {
      user: user.toJSON(),
      token
    };
  }

  async handleGoogleOAuthUser({ googleId, email, name, avatar }) {
    const normalizedEmail = email.toLowerCase().trim();

    let user = await User.findOne({ googleId });

    if (user) {

      if (!user.avatar && avatar) {
        user.avatar = avatar;
        await user.save();
      }
    } else {

      user = await userRepository.findByEmail(normalizedEmail);

      if (user) {

        user.googleId = googleId;
        if (!user.avatar && avatar) user.avatar = avatar;
        if (user.provider !== 'google') user.provider = user.provider;
        await user.save();
      } else {

        user = await userRepository.createUser({
          name: name ? name.trim() : 'Skribe Creator',
          email: normalizedEmail,
          googleId,
          provider: 'google',
          avatar: avatar || ''
        });
      }
    }

    const token = generateAccessToken({ id: user.id, email: user.email });

    return {
      user: user.toJSON(),
      token
    };
  }

  async getCurrentUser(userId) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const err = new Error('User account not found');
      err.statusCode = 404;
      throw err;
    }

    return {
      user: user.toJSON()
    };
  }
}

export const authService = new AuthService();
export default authService;
