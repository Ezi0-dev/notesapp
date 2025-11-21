module.exports = {
  jwt: {
    accessTokenExpiry: '3h',
    refreshTokenExpiry: '7d',
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
  },
  rateLimit: {
    windowMs: 5 * 60 * 1000,
    maxAuth: 20,
    maxApi: 100,
  },
  lockout: {
    maxAttempts: 10,
    lockoutTime: 5 * 60 * 1000  // Milliseconds so 5 minutes
  }
};