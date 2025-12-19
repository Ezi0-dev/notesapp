const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { executeAsSystem } = require('../middleware/rlsContext');
const { validationResult } = require('express-validator');
const { jwt: jwtConfig, lockout } = require('../config/security');
const { logger } = require('../utils/logger');
const { auditLog } = require('../middleware/security');
const { logSecurityEvent } = require('../utils/securityLogger');
const { COOKIE_NAMES, getCookieOptions, clearAuthCookies } = require('../utils/cookieConfig');

const generateTokens = (userId, username, role) => {
  const accessToken = jwt.sign(
    { userId, username, role },
    jwtConfig.accessSecret,
    { expiresIn: jwtConfig.accessTokenExpiry }
  );

  const refreshToken = jwt.sign(
    { userId, username, role },
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

    const passwordHash = await argon2.hash(password);

    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, role, created_at',
      [username, email, passwordHash]
    );

    const user = result.rows[0];

    // Validate user.id before using it
    if (!user.id || user.id === '') {
      logger.error('Registration failed: Invalid user ID returned from database');
      return res.status(500).json({ error: { message: 'Registration failed' } });
    }

    // Revoke existing refresh tokens (system operation)
    await executeAsSystem(
      'UPDATE refresh_tokens SET revoked = true, revoked_at = NOW(), revoked_reason = $2 WHERE user_id = $1 AND revoked = false',
      [user.id, 'new_registration']
    );

    const { accessToken, refreshToken } = generateTokens(user.id, user.username, user.role);

    // Insert new refresh token (system operation)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await executeAsSystem(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    );

    await auditLog(user.id, 'REGISTER_SUCCESS', true, req, { username, email });
    logger.info(`New user registered: ${username}`);

    // Set tokens as httpOnly cookies instead of returning in JSON
    res.cookie(COOKIE_NAMES.ACCESS_TOKEN, accessToken, getCookieOptions(3 * 60 * 60 * 1000)); // 3 hours
    res.cookie(COOKIE_NAMES.REFRESH_TOKEN, refreshToken, getCookieOptions(7 * 24 * 60 * 60 * 1000)); // 7 days

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
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

    // Find user by username
    const result = await pool.query(
      'SELECT id, username, email, password_hash, role, failed_login_attempts, account_locked_until FROM users WHERE username = $1',
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
    const validPassword = await argon2.verify(user.password_hash, password);
    
    if (!validPassword) {
      // Increment failed login attempts
      const newFailedAttempts = (user.failed_login_attempts || 0) + 1;
      let accountLockedUntil = null;

      if (newFailedAttempts >= lockout.maxAttempts) {
        accountLockedUntil = new Date(Date.now() + lockout.lockoutTime); // Fixed for easier configuring

        // Log account lockout as a security event
        await logSecurityEvent(
          'ACCOUNT_LOCKOUT',
          'MEDIUM',
          user.id,
          req,
          {
            reason: 'excessive_failed_logins',
            attemptCount: newFailedAttempts,
            lockedUntil: accountLockedUntil
          }
        );
      }

      await pool.query(
        'UPDATE users SET failed_login_attempts = $1, account_locked_until = $2 WHERE id = $3',
        [newFailedAttempts, accountLockedUntil, user.id]
      );

      await auditLog(user.id, 'LOGIN_FAILED', false, req, { reason: 'Invalid password', attempts : newFailedAttempts });

      return res.status(401).json({ 
        error: { message: 'Invalid username or password' } 
      });
    }

    // Validate user.id before using it
    logger.debug('Login validation check:', { userId: user.id, type: typeof user.id, length: user.id?.length });
    if (!user.id || user.id === '') {
      logger.error('Login failed: Invalid user ID from database');
      return res.status(500).json({ error: { message: 'Login failed' } });
    }

    // Reset failed login attempts on successful login
    logger.debug('About to reset failed attempts for user:', { userId: user.id });
    await pool.query(
      'UPDATE users SET failed_login_attempts = 0, account_locked_until = NULL, last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );
    logger.debug('After pool.query, user.id is:', { userId: user.id, type: typeof user.id });

    // Remove previous refresh tokens (system operation)
    logger.debug('About to executeAsSystem for refresh tokens:', { userId: user.id, type: typeof user.id });
    await executeAsSystem(
      'UPDATE refresh_tokens SET revoked = true, revoked_at = NOW(), revoked_reason = $2 WHERE user_id = $1 AND revoked = false',
      [user.id, 'new_login']
    );

    const { accessToken, refreshToken } = generateTokens(user.id, user.username, user.role);

    // Store refresh token (system operation)
    await executeAsSystem(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
    );

    await auditLog(user.id, 'LOGIN_SUCCESS', true, req);
    logger.info(`User ${username} logged in successfully`);

    // Set tokens as httpOnly cookies instead of returning in JSON
    res.cookie(COOKIE_NAMES.ACCESS_TOKEN, accessToken, getCookieOptions(3 * 60 * 60 * 1000)); // 3 hours
    res.cookie(COOKIE_NAMES.REFRESH_TOKEN, refreshToken, getCookieOptions(7 * 24 * 60 * 60 * 1000)); // 7 days

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: { message: 'Login failed' } });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    // Read refresh token from httpOnly cookie instead of request body
    const refreshToken = req.cookies[COOKIE_NAMES.REFRESH_TOKEN];

    if (!refreshToken) {
      return res.status(401).json({ error: { message: 'Refresh token required' } });
    }

    const decoded = jwt.verify(refreshToken, jwtConfig.refreshSecret);

    // Check refresh token (system operation)
    const result = await executeAsSystem(
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

    const { accessToken } = generateTokens(decoded.userId, decoded.username, decoded.role);
    await auditLog(decoded.userId, 'TOKEN_REFRESHED', true, req);

    // Set new access token as cookie
    res.cookie(COOKIE_NAMES.ACCESS_TOKEN, accessToken, getCookieOptions(3 * 60 * 60 * 1000));

    res.json({
      message: 'Token refreshed successfully'
    });
  } catch (err) {
    logger.error('Token refresh error:', err);
    res.status(401).json({ error: { message: 'Invalid refresh token' } });
  }
};

exports.logout = async (req, res) => {
  try {
    // Read refresh token from httpOnly cookie instead of request body
    const refreshToken = req.cookies[COOKIE_NAMES.REFRESH_TOKEN];

    if (refreshToken) {
      // Revoke refresh token (system operation)
      await executeAsSystem(
        'UPDATE refresh_tokens SET revoked = true, revoked_at = NOW(), revoked_reason = $2 WHERE token = $1',
        [refreshToken, 'user_logout']
      );
    }

    await auditLog(req.user.userId, 'LOGOUT', true, req);
    logger.info(`User logged out: ${req.user.username}`);

    // Clear authentication cookies
    clearAuthCookies(res);

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    logger.error('Logout error:', err);
    res.status(500).json({ error: { message: 'Logout failed' } });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, role, created_at, last_login, profile_picture FROM users WHERE id = $1',
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

// Check if user is authenticated (used by frontend to verify cookie-based auth)
exports.checkAuth = async (req, res) => {
  // authenticate middleware already verified the token from cookie
  res.json({
    authenticated: true,
    user: {
      id: req.userInfo.id,
      username: req.userInfo.username,
      email: req.userInfo.email
    }
  });
};