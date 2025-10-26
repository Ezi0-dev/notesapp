const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { validationResult } = require('express-validator');
const { bcrypt: bcryptConfig, jwt: jwtConfig, lockout } = require('../config/security');
const { logger } = require('../utils/logger');
const { auditLog } = require('../middleware/security');

const generateTokens = (userId, username) => {
  const accessToken = jwt.sign(
    { userId, username },
    jwtConfig.accessSecret,
    { expiresIn: jwtConfig.accessTokenExpiry }
  );

  const refreshToken = jwt.sign(
    { userId, username },
    jwtConfig.refreshSecret,
    { expiresIn: jwtConfig.refreshTokenExpiry }
  );

  return { accessToken, refreshToken };
};

exports.register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      await auditLog(null, 'REGISTER_FAILED', false, req, { email, reason: 'User exists' });
      return res.status(400).json({ 
        error: { message: 'Username or email already exists' } 
      });
    }

    const passwordHash = await bcrypt.hash(password, bcryptConfig.saltRounds);

    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username, email, passwordHash]
    );

    const user = result.rows[0];

    await pool.query(
    'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND revoked = false',
    [user.id]
    );

    const { accessToken, refreshToken } = generateTokens(user.id, user.username);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    );

    await auditLog(user.id, 'REGISTER_SUCCESS', true, req, { username, email });
    logger.info(`New user registered: ${username}`);

    res.status(201).json({
      message: 'User registered successfully',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.created_at
      }
    });
  } catch (err) {
    logger.error('Registration error:', err);
    res.status(500).json({ error: { message: 'Registration failed' } });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body; // Changed from email

    // Validation
    if (!username || !password) {
      return res.status(400).json({ 
        error: { message: 'Username and password are required' } 
      });
    }

    // Find user by username (changed from email)
    const result = await pool.query(
      'SELECT id, username, email, password_hash, failed_login_attempts, account_locked_until FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      await auditLog(null, 'LOGIN_FAILED', false, req, { username, reason: 'User not found' });
      return res.status(401).json({ 
        error: { message: 'Invalid username or password' } 
      });
    }

    const user = result.rows[0];

    // Check if account is locked
    if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
      await auditLog(user.id, 'LOGIN_FAILED', false, req, { reason: 'Account locked' });
      return res.status(403).json({ 
        error: { message: 'Account is locked. Please try again later.' } 
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      // Increment failed login attempts
      const newFailedAttempts = (user.failed_login_attempts || 0) + 1;
      let accountLockedUntil = null;

      if (newFailedAttempts >= 5) {
        accountLockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      }

      await pool.query(
        'UPDATE users SET failed_login_attempts = $1, account_locked_until = $2 WHERE id = $3',
        [newFailedAttempts, accountLockedUntil, user.id]
      );

      await auditLog(user.id, 'LOGIN_FAILED', false, req, { reason: 'Invalid password' });

      return res.status(401).json({ 
        error: { message: 'Invalid username or password' } 
      });
    }

    // Reset failed login attempts on successful login
    await pool.query(
      'UPDATE users SET failed_login_attempts = 0, account_locked_until = NULL, last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Remove previous refresh tokens from DB
    await pool.query(
    'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND revoked = false',
    [user.id]
    );

    const { accessToken, refreshToken } = generateTokens(user.id, user.username);

    // Store refresh token
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
    );

    await auditLog(user.id, 'LOGIN_SUCCESS', true, req);
    logger.info(`User ${username} logged in successfully`);

    res.json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: { message: 'Login failed' } });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: { message: 'Refresh token required' } });
    }

    const decoded = jwt.verify(refreshToken, jwtConfig.refreshSecret);

    const result = await pool.query(
      'SELECT user_id, expires_at, revoked FROM refresh_tokens WHERE token = $1',
      [refreshToken]
    );

    if (result.rows.length === 0 || result.rows[0].revoked) {
      return res.status(401).json({ error: { message: 'Invalid refresh token' } });
    }

    const tokenData = result.rows[0];

    if (new Date(tokenData.expires_at) < new Date()) {
      return res.status(401).json({ error: { message: 'Refresh token expired' } });
    }

    const { accessToken } = generateTokens(decoded.userId, decoded.username);
    await auditLog(decoded.userId, 'TOKEN_REFRESHED', true, req);

    res.json({
      message: 'Token refreshed',
      accessToken
    });
  } catch (err) {
    logger.error('Token refresh error:', err);
    res.status(401).json({ error: { message: 'Invalid refresh token' } });
  }
};

exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      await pool.query(
        'UPDATE refresh_tokens SET revoked = true WHERE token = $1',
        [refreshToken]
      );
    }

    await auditLog(req.user.userId, 'LOGOUT', true, req);
    logger.info(`User logged out: ${req.user.username}`);

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    logger.error('Logout error:', err);
    res.status(500).json({ error: { message: 'Logout failed' } });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, created_at, last_login FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    logger.error('Get profile error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch profile' } });
  }
};