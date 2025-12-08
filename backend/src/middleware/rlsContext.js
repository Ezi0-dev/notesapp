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
 * Execute a query without RLS restrictions
 *
 * IMPORTANT: This function bypasses RLS by using a connection without app.user_id set.
 * It should ONLY be used for:
 * - Cross-user operations (friendships involving two users)
 * - System notifications (creating notifications for other users)
 * - Audit logging
 * - Cleanup operations
 *
 * The RLS policies on friendships and notifications tables have been modified to:
 * - friendships: Allow INSERT where user_id = current_setting('app.user_id')
 * - notifications: Allow INSERT for any user (WITH CHECK true)
 *
 * However, when pool.query() is called without app.user_id set, current_setting() returns NULL,
 * and the policies will fail. We need to set app.user_id even for system operations.
 *
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
const executeAsSystem = async (query, params = []) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Don't set app.user_id - this allows the query to run without RLS context
    // But RLS policies are still enforced. The policies need to be written to allow
    // operations without app.user_id for system operations.
    // For now, we'll set it to a special system UUID to bypass the policies
    // Note: This is a workaround. Better solution is to have BYPASSRLS privilege
    // or use SECURITY DEFINER functions in PostgreSQL.

    // Execute the query directly without RLS context
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
