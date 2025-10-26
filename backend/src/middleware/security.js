const { pool } = require('../config/database');

const auditLog = async (userId, action, success, req, details = {}) => {
  try {
    await pool.query(
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

const checkAccountLock = async (req, res, next) => {
  const { email } = req.body;
  
  try {
    const result = await pool.query(
      'SELECT account_locked_until FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length > 0 && result.rows[0].account_locked_until) {
      const lockedUntil = new Date(result.rows[0].account_locked_until);
      if (lockedUntil > new Date()) {
        const minutesLeft = Math.ceil((lockedUntil - new Date()) / 60000);
        return res.status(423).json({
          error: { 
            message: `Account is locked. Try again in ${minutesLeft} minutes.`,
            lockedUntil: lockedUntil.toISOString()
          }
        });
      }
    }
    next();
  } catch (err) {
    console.error('Account lock check failed:', err);
    next();
  }
};

module.exports = { 
  securityMiddleware, 
  auditLog, 
  checkAccountLock 
};