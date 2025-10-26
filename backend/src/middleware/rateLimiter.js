const rateLimit = require('express-rate-limit');
const { rateLimit: rateLimitConfig } = require('../config/security');
const { logger } = require('../utils/logger');

const createRateLimiter = (max, windowMs = rateLimitConfig.windowMs) => {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        url: req.url,
        userAgent: req.get('user-agent')
      });
      res.status(429).json({
        error: { 
          message: 'Too many requests, please try again later',
          retryAfter: Math.ceil(windowMs / 1000)
        }
      });
    },
    skip: (req) => {
      return req.url === '/health';
    }
  });
};

const authLimiter = createRateLimiter(rateLimitConfig.maxAuth);
const apiLimiter = createRateLimiter(rateLimitConfig.maxApi);
const strictLimiter = createRateLimiter(3, 60 * 60 * 1000);

module.exports = { authLimiter, apiLimiter, strictLimiter };