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
    windowMs: 5 * 60 * 1000,
    maxAuth: 5,
    maxApi: 100,
  },
  lockout: {
    maxAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
    lockoutTime: parseInt(process.env.LOCKOUT_TIME) || 5 * 60 * 1000,
  }
};