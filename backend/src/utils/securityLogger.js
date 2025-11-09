const { pool } = require('../config/database');
const { logger } = require('../utils/logger');

/**
 * Log security events to security_events table
 * @param {string} eventType - Event type (e.g., 'encryption_failure', 'tampering_detected')
 * @param {string} severity - Severity level: 'low', 'medium', 'high', 'critical'
 * @param {string} userId - User ID (can be null)
 * @param {object} req - Express request object
 * @param {object} details - Additional details to log
 */
async function logSecurityEvent(eventType, severity, userId, req, details = {}) {
  try {
    await pool.query(
      `INSERT INTO security_events (event_type, severity, user_id, ip_address, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        eventType,
        severity,
        userId || null,
        req.ip || null,
        JSON.stringify(details)
      ]
    );
  } catch (error) {
    // Don't let logging failures break the app
    logger.error('Failed to log security event:', { 
      eventType,
      severity,
      userId, 
      error: error.message 
    });
  }
}

module.exports = { logSecurityEvent };