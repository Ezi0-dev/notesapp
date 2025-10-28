const { logger } = require('../utils/logger');
const { pool } = require('../config/database');
const { rateLimit: rateLimitConfig } = require('../config/security');

const createRateLimiter = (max, windowMs = rateLimitConfig.windowMs, action = 'api') => {
  return async (req, res, next) => {
    const identifier = req.ip;
    
    try {
      const now = new Date();
      
      // Check if blocked
      const blockCheck = await pool.query(
        'SELECT blocked_until FROM rate_limits WHERE identifier = $1 AND action = $2',
        [identifier, action]
      );
      
      if (blockCheck.rows[0]?.blocked_until && new Date(blockCheck.rows[0].blocked_until) > now) {
        const retryAfter = Math.ceil((new Date(blockCheck.rows[0].blocked_until) - now) / 1000);
        return res.status(429).json({
          error: { message: 'Too many requests, please try again later', retryAfter }
        });
      }
      
      // Upsert rate limit record
      const result = await pool.query(`
        INSERT INTO rate_limits (identifier, action, attempt_count, window_start)
        VALUES ($1, $2, 1, $3)
        ON CONFLICT (identifier, action) 
        DO UPDATE SET 
          attempt_count = CASE 
            WHEN rate_limits.window_start < $3 - INTERVAL '${windowMs} milliseconds' 
            THEN 1 
            ELSE rate_limits.attempt_count + 1 
          END,
          window_start = CASE 
            WHEN rate_limits.window_start < $3 - INTERVAL '${windowMs} milliseconds' 
            THEN $3 
            ELSE rate_limits.window_start 
          END,
          blocked_until = CASE 
            WHEN rate_limits.attempt_count + 1 > $4 
            THEN $3 + INTERVAL '${windowMs} milliseconds'
            ELSE NULL 
          END
        RETURNING attempt_count, blocked_until
      `, [identifier, action, now, max]);
      
      const { attempt_count, blocked_until } = result.rows[0];
      
      if (attempt_count > max || (blocked_until && new Date(blocked_until) > now)) {
        logger.warn('Rate limit exceeded', { ip: req.ip, url: req.url, action });
        return res.status(429).json({
          error: { message: 'Too many requests, please try again later', retryAfter: Math.ceil(windowMs / 1000) }
        });
      }
      
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - attempt_count));
      next();
      
    } catch (error) {
      logger.error('Rate limiter error', { error: error.message });
      next(); // Fail open for availability
    }
  };
};

const authLimiter = createRateLimiter(rateLimitConfig.maxAuth, rateLimitConfig.windowMs, 'auth');
const apiLimiter = createRateLimiter(rateLimitConfig.maxApi, rateLimitConfig.windowMs, 'api');
const strictLimiter = createRateLimiter(3, 60 * 60 * 1000, 'strict');

module.exports = { authLimiter, apiLimiter, strictLimiter };