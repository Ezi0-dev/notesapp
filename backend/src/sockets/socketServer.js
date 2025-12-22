const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { jwt: jwtConfig } = require('../config/security');
const { logger } = require('../utils/logger');
const { logSecurityEvent } = require('../utils/securityLogger');
const { COOKIE_NAMES } = require('../utils/cookieConfig');
const cookieParser = require('cookie');

// Track connections per user for rate limiting
const userConnections = new Map();
const MAX_CONNECTIONS_PER_USER = 5;

// Authentication middleware for Socket.io
// Uses JWT from httpOnly cookie (same as REST API)
async function authenticateSocket(socket, next) {
  try {
    // Parse cookies from handshake
    const cookies = cookieParser.parse(socket.handshake.headers.cookie || '');
    const token = cookies[COOKIE_NAMES.ACCESS_TOKEN];

    if (!token) {
      logger.warn('WebSocket auth failed: No token provided', {
        socketId: socket.id,
        ip: socket.handshake.address
      });
      return next(new Error('Authentication required'));
    }

    // Verify JWT token (same logic as REST API)
    const decoded = jwt.verify(token, jwtConfig.accessSecret);

    // Check connection limit per user
    const userId = decoded.userId;
    const existingConnections = userConnections.get(userId) || 0;
    if (existingConnections >= MAX_CONNECTIONS_PER_USER) {
      logger.warn('WebSocket connection limit exceeded', {
        userId,
        existingConnections
      });
      return next(new Error('Connection limit exceeded'));
    }

    // Track connection
    userConnections.set(userId, existingConnections + 1);

    // Attach user info to socket
    socket.userId = decoded.userId;
    socket.username = decoded.username;

    logger.info('WebSocket authenticated', {
      userId: decoded.userId,
      socketId: socket.id
    });

    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      await logSecurityEvent(
        'INVALID_TOKEN_DETECTED',
        'MEDIUM',
        null,
        { ip: socket.handshake.address, headers: socket.handshake.headers },
        { context: 'websocket_auth', error: err.message }
      );
      logger.warn('WebSocket auth failed: Invalid token', {
        socketId: socket.id,
        error: err.message
      });
      return next(new Error('Invalid or expired token'));
    }

    logger.error('WebSocket auth error:', err);
    next(new Error('Authentication failed'));
  }
}

function initializeSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:8080',
      credentials: true,
      methods: ['GET', 'POST']
    },
    // Connection settings
    pingTimeout: 60000,  // 1 minute
    pingInterval: 25000, // 25 seconds
    // Rate limiting
    maxHttpBufferSize: 1e6, // 1 MB max message size
    transports: ['websocket', 'polling'] // WebSocket preferred, polling fallback
  });

  // Apply authentication middleware
  io.use(authenticateSocket);

  // Connection handler
  io.on('connection', (socket) => {
    const userId = socket.userId;

    logger.info('WebSocket client connected', {
      userId,
      socketId: socket.id,
      transport: socket.conn.transport.name
    });

    // Join user-specific room for targeted notifications
    // Room name format: "user:{userId}"
    socket.join(`user:${userId}`);

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      // Clean up connection count
      const count = userConnections.get(userId) || 1;
      if (count <= 1) {
        userConnections.delete(userId);
      } else {
        userConnections.set(userId, count - 1);
      }

      logger.info('WebSocket client disconnected', {
        userId,
        socketId: socket.id,
        reason
      });
    });

    // Handle connection errors
    socket.on('error', (error) => {
      logger.error('WebSocket error', {
        userId,
        socketId: socket.id,
        error: error.message
      });
    });

    // Optional: Handle client ping for connection health monitoring
    socket.on('ping', () => {
      socket.emit('pong');
    });
  });

  logger.info('Socket.io server initialized');
  return io;
}

module.exports = { initializeSocketServer };
