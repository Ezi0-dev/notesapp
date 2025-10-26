module.exports = {
  jwt: {
    accessTokenExpiry: '3h',
    refreshTokenExpiry: '7d',
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
  },
  bcrypt: {
    saltRounds: 12,
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    maxAuth: 5,
    maxApi: 100,
  },
  lockout: {
    maxAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
    lockoutTime: parseInt(process.env.LOCKOUT_TIME) || 15 * 60 * 1000,
  },
  encryption: {
    algorithm: 'aes-256-cbc',
    key: Buffer.from(process.env.ENCRYPTION_KEY || '0'.repeat(64), 'hex'),
  },
};