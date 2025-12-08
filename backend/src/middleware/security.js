const { pool } = require('../config/database');
const { executeAsSystem } = require('./rlsContext');

const auditLog = async (userId, action, success, req, details = {}) => {
  try {
    // Audit logs are system operations - bypass RLS
    await executeAsSystem(
      `INSERT INTO audit_logs (user_id, action, ip_address, user_agent, success, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        action,
        req.ip,
        req.get('user-agent'),
        success,
        JSON.stringify(details)
      ]
    );
  } catch (err) {
    console.error('Audit log failed:', err);
  }
};

const securityMiddleware = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.removeHeader('X-Powered-By');
  next();
};

module.exports = {
  securityMiddleware,
  auditLog
};