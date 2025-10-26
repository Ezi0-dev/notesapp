const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { jwt: jwtConfig } = require('../config/security');
const { logger } = require('../utils/logger');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: 'No token provided' } });
    }

    const token = authHeader.substring(7);
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
      return res.status(401).json({ error: { message: 'Invalid token' } });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: { message: 'Token expired' } });
    }
    logger.error('Authentication error:', err);
    return res.status(500).json({ error: { message: 'Authentication failed' } });
  }
};

module.exports = { authenticate };