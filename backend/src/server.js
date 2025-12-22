require('dotenv').config();

// Default to development if NODE_ENV not set
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const morgan = require('morgan');
const { logger, stream } = require('./utils/logger');
const { securityMiddleware } = require('./middleware/security');
const authRoutes = require('./routes/auth');
const notesRoutes = require('./routes/notes');
const friendsRoutes = require('./routes/friends');
const sharingRoutes = require('./routes/sharing');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const { pool } = require('./config/database');
const scheduler = require('./jobs/scheduler');
const { setRLSContext } = require('./middleware/rlsContext');
const { initializeSocketServer } = require('./sockets/socketServer');
const { setSocketInstance } = require('./sockets/notificationSocket');

const app = express();
const httpServer = http.createServer(app);  // Wrap Express in HTTP server
const PORT = process.env.PORT || 5000;

// Trust proxy (for rate limiting behind nginx)
app.set('trust proxy', 1);

// Security middleware - MUST be first
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "https://cdn.socket.io"],  // Allow Socket.io CDN
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", "ws://localhost:5000", "wss://localhost:5000"],  // Allow WebSocket
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// HTTP request logging
app.use(morgan('combined', { stream }));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:8080',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing with size limits
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// Sanitize data
app.use(mongoSanitize());
app.use(xss());
app.use(hpp());

// Custom security middleware
app.use(securityMiddleware);

// RLS Context Middleware - MUST be after security middleware
// This sets the app.user_id context for Row-Level Security policies
app.use(setRLSContext);

// Static file serving for uploaded avatars with CORS headers
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:8080');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static('uploads'));

// Initialize Socket.io (after all middleware, before routes)
const io = initializeSocketServer(httpServer);
setSocketInstance(io);  // Make available to controllers

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/notifications', notificationRoutes);

// Freind sharing stuff
app.use('/api/friends', friendsRoutes);
app.use('/api/sharing', sharingRoutes);

// Admin/testing routes
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    security: 'enabled'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  res.status(err.status || 500).json({
    error: {
      message: process.env.NODE_ENV === 'production' 
        ? 'An error occurred' 
        : err.message
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: { message: 'Route not found' } });
});

// Server instance for graceful shutdown
let server;

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing server gracefully');
  if (server) {
    server.close(() => {
      scheduler.stop();
      pool.end();
      logger.info('✓ Server shutdown complete');
      process.exit(0);
    });
  }
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, closing server gracefully');
  if (server) {
    server.close(() => {
      scheduler.stop();
      pool.end();
      logger.info('✓ Server shutdown complete');
      process.exit(0);
    });
  }
});

// Only start server if this file is run directly (not imported as a module)
if (require.main === module) {
  server = httpServer.listen(PORT, '0.0.0.0', async () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`🔒 Security features enabled`);

    try {
      await pool.query('SELECT NOW()');
      logger.info('✅ Database connected successfully');

      // Start automated maintenance jobs
      scheduler.start();
      logger.info('✅ Scheduled maintenance jobs started');
    } catch (err) {
      logger.error('❌ Database connection failed:', err.message);
      logger.error('⚠️  Scheduled jobs not started');
    }
  });
}

// Export app for use in other modules
module.exports = app;