// Cookie configuration for JWT tokens
// Centralizes cookie settings to ensure consistency across auth endpoints

const COOKIE_NAMES = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken'
};

/**
 * Generate cookie options with security flags
 * @param {number} maxAge - Cookie lifetime in milliseconds
 * @returns {object} Cookie configuration object
 */
const getCookieOptions = (maxAge) => {
  return {
    httpOnly: true, // Can't be accessed by JavaScript (XSS protection)
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict', // CSRF protection
    path: '/', // Available for all routes
    maxAge: maxAge // Lifetime in milliseconds
  };
};

/**
 * Clear all authentication cookies
 * @param {object} res - Express response object
 */
const clearAuthCookies = (res) => {
  res.clearCookie(COOKIE_NAMES.ACCESS_TOKEN, { path: '/' });
  res.clearCookie(COOKIE_NAMES.REFRESH_TOKEN, { path: '/' });
};

module.exports = { COOKIE_NAMES, getCookieOptions, clearAuthCookies };
