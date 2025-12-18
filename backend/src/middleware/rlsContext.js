/**
 * Row-Level Security (RLS) Context Middleware
 *
 * Sets the PostgreSQL RLS context (app.user_id) for authenticated requests.
 * This enables Row-Level Security policies to enforce user-level access control.
 *
 * IMPORTANT: This middleware must be used AFTER authentication middleware.
 */

const { pool } = require('../config/database');
const { logger } = require('../utils/logger');

/**
 * Set RLS context for authenticated requests
 * Gets a dedicated client, sets app.user_id, and attaches it to the request
 */
const setRLSContext = async (req, res, next) => {
  // Skip if not authenticated or no user ID
  if (!req.user || !req.user.userId) {
    return next();
  }

  let client;

  try {
    // Get a dedicated client for this request
    client = await pool.connect();

    // Start a transaction
    await client.query('BEGIN');

    // Validate UUID format to prevent SQL injection (SET doesn't support parameterized queries)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(req.user.userId)) {
      throw new Error('Invalid UUID format for userId');
    }

    // Set RLS context - this persists for the entire transaction
    // Note: SET command doesn't support parameterized queries, but we've validated UUID format
    await client.query(`SET LOCAL app.user_id = '${req.user.userId}'`);

    // Verify the setting was applied
    const verifyResult = await client.query(`SELECT current_setting('app.user_id', true) as user_id`);
    logger.debug(`RLS context verified for user ${req.user.userId}`, {
      userId: req.user.userId,
      setUserId: verifyResult.rows[0].user_id,
      path: req.path
    });

    // Attach client to request so controllers can use it
    req.dbClient = client;
    req.rlsEnabled = true;

    // Store original methods
    const originalSend = res.send;
    const originalJson = res.json;
    let responseSent = false;

    // Helper to commit and cleanup
    const commitAndCleanup = async () => {
      if (responseSent) {
        logger.warn(`commitAndCleanup called but response already sent for user ${req.user.userId}`);
        return;
      }
      responseSent = true;

      try {
        logger.debug(`Attempting to COMMIT transaction for user ${req.user.userId} on ${req.method} ${req.path}`);
        await client.query('COMMIT');
        logger.info(`RLS transaction COMMITTED successfully for user ${req.user.userId} on ${req.method} ${req.path}`);
      } catch (err) {
        logger.error('Failed to commit RLS transaction:', {
          error: err.message,
          stack: err.stack,
          userId: req.user.userId,
          method: req.method,
          path: req.path
        });
        try {
          await client.query('ROLLBACK');
          logger.warn(`RLS transaction ROLLED BACK for user ${req.user.userId}`);
        } catch (rollbackErr) {
          logger.error('Failed to rollback after commit error:', rollbackErr);
        }
        throw err; // Re-throw to be caught by response handlers
      } finally {
        client.release();
        logger.debug(`RLS client released for user ${req.user.userId}`);
      }
    };

    // Override res.send to ensure commit before response
    res.send = function(data) {
      const self = this;
      commitAndCleanup()
        .then(() => {
          originalSend.call(self, data);
        })
        .catch(err => {
          logger.error('Commit failed, sending error response:', err);
          if (!res.headersSent) {
            // If commit failed, send error response instead of success
            self.status(500);
            originalJson.call(self, { error: { message: 'Failed to save changes' } });
          }
        });
    };

    // Override res.json to ensure commit before response
    res.json = function(data) {
      const self = this;
      commitAndCleanup()
        .then(() => {
          originalJson.call(self, data);
        })
        .catch(err => {
          logger.error('Commit failed, sending error response:', err);
          if (!res.headersSent) {
            // If commit failed, send error response instead of success
            self.status(500);
            originalJson.call(self, { error: { message: 'Failed to save changes' } });
          }
        });
    };

    // Handle errors - rollback and release client
    const errorHandler = async (err) => {
      if (responseSent) return;
      responseSent = true;

      logger.error('Request error, rolling back RLS transaction:', err);
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('Failed to rollback RLS transaction:', rollbackErr);
      } finally {
        client.release();
      }
    };

    // Attach error handler
    res.on('error', errorHandler);
    res.on('close', () => {
      // If response closed without sending (e.g., client disconnect), cleanup
      if (!responseSent) {
        logger.warn('Response closed before sending, cleaning up RLS context');
        errorHandler(new Error('Response closed prematurely'));
      }
    });

    next();
  } catch (error) {
    logger.error('Failed to set RLS context:', {
      error: error.message,
      userId: req.user?.userId,
      stack: error.stack
    });

    // Rollback and release on error
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('Failed to rollback after RLS error:', rollbackErr);
      } finally {
        client.release();
      }
    }

    return res.status(500).json({
      error: { message: 'Database initialization error' }
    });
  }
};

/**
 * Execute a query with system-level privileges
 *
 * SECURITY: This function uses a special system UUID (00000000-0000-0000-0000-000000000000)
 * that RLS policies explicitly allow for specific operations.
 *
 * Allowed operations:
 * - refresh_tokens: SELECT, INSERT, UPDATE, DELETE (managing user sessions)
 * - audit_logs: SELECT, INSERT (security logging)
 * - notifications: INSERT (cross-user notifications)
 *
 * IMPORTANT: Do NOT use pool.query() directly for these operations - it will FAIL.
 * Always use executeAsSystem() to ensure proper security context.
 *
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
const executeAsSystem = async (query, params = []) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Debug: Log what we're about to execute
    logger.debug('executeAsSystem called with:', {
      query: query.substring(0, 100),
      params: params,
      paramTypes: params.map(p => typeof p),
      paramLengths: params.map(p => p?.length || 'N/A')
    });

    // Set system UUID for operations that need to bypass user-level RLS
    // This is a security-hardened approach: RLS policies explicitly allow this UUID
    // for specific operations (creating tokens, audit logs, notifications).
    // If app.user_id is not set, queries will FAIL instead of silently bypassing security.
    const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';
    await client.query(`SET LOCAL app.user_id = '${SYSTEM_UUID}'`);

    // Execute the query with system privileges
    const result = await client.query(query, params);

    await client.query('COMMIT');

    logger.debug('System query executed successfully', {
      query: query.substring(0, 100),
      rowCount: result.rowCount
    });

    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('System query failed:', {
      error: error.message,
      query: query.substring(0, 100),
      code: error.code,
      detail: error.detail
    });
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  setRLSContext,
  executeAsSystem
};
