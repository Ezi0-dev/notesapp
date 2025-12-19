const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { jwt: jwtConfig } = require('../config/security');
const { logger } = require('../utils/logger');
const { logSecurityEvent } = require('../utils/securityLogger');
const { COOKIE_NAMES } = require('../utils/cookieConfig');

const authenticate = async (req, res, next) => {
  try {
    // Read token from httpOnly cookie instead of Authorization header
    const token = req.cookies[COOKIE_NAMES.ACCESS_TOKEN];

    if (!token) {
      return res.status(401).json({ error: { message: 'No token provided' } });
    }
    const decoded = jwt.verify(token, jwtConfig.accessSecret);
    
    // Verify user still exists
    const result = await pool.query(
      'SELECT id, username, email FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: { message: 'User no longer exists' } });
    }

    req.user = decoded;
    req.userInfo = result.rows[0];
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      // Log invalid/tampered token as security event
      await logSecurityEvent(
        'INVALID_TOKEN_DETECTED',
        'HIGH',
        null, // userId unknown since token is invalid
        req,
        {
          tokenError: err.message,
          endpoint: req.path
        }
      );
      return res.status(401).json({ error: { message: 'Invalid token' } });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: { message: 'Token expired' } });
    }
    logger.error('Authentication error:', err);
    return res.status(500).json({ error: { message: 'Authentication failed' } });
  }
};

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: { message: 'Authentication required' } });
  }

  if (req.user.role !== 'admin') {
    logger.warn(`Access denied for non-admin user: ${req.user.username} (role: ${req.user.role})`);
    return res.status(403).json({
      error: { message: 'Admin access required' }
    });
  }

  next();
};

module.exports = { authenticate, requireAdmin };