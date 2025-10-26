const { pool } = require('../config/database');
const { logger } = require('./logger');

async function cleanupOldTokens() {
  try {
    const result = await pool.query(
      `DELETE FROM refresh_tokens 
       WHERE expires_at < NOW() 
       OR (revoked = true AND created_at < NOW() - INTERVAL '7 days')`
    );
    
    if (result.rowCount > 0) {
      logger.info(`Cleaned up ${result.rowCount} old/expired tokens`);
    }
  } catch (err) {
    logger.error('Token cleanup failed:', err);
  }
}

// Run every 24 hours
setInterval(cleanupOldTokens, 24 * 60 * 60 * 1000);

// Run on startup
cleanupOldTokens();

module.exports = { cleanupOldTokens };