const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const scheduler = require('../jobs/scheduler');
const DatabaseMaintenance = require('../utils/maintenance');
const { pool } = require('../config/database');

/**
 * Admin Routes for Testing & Maintenance
 * These endpoints require admin role access
 */

// Get scheduler status
router.get('/scheduler/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const status = scheduler.getStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Run a specific job manually
router.post('/scheduler/run/:jobName', authenticate, requireAdmin, async (req, res) => {
  try {
    const { jobName } = req.params;
    const result = await scheduler.runJobManually(jobName);

    res.json({
      success: result.success !== false,
      job: jobName,
      result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Run full maintenance suite
router.post('/maintenance/full', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await DatabaseMaintenance.runFullMaintenance();

    res.json({
      success: result.success,
      result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get health metrics
router.get('/health/metrics', authenticate, requireAdmin, async (req, res) => {
  try {
    const metrics = await DatabaseMaintenance.getHealthMetrics();

    res.json({
      success: metrics.success,
      metrics: metrics.metrics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Check table bloat
router.get('/health/bloat', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await DatabaseMaintenance.checkTableBloat();

    res.json({
      success: result.success,
      bloatedTables: result.bloatedTables,
      recommendation: result.recommendation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get security events with filtering
router.get('/security-events', authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      severity,
      resolved,
      limit = 50,
      offset = 0,
      startDate,
      endDate
    } = req.query;

    // Build WHERE clause dynamically
    const conditions = [];
    const params = [];
    let paramCounter = 1;

    // Filter by severity
    if (severity) {
      conditions.push(`severity = $${paramCounter}`);
      params.push(severity.toUpperCase());
      paramCounter++;
    }

    // Filter by resolved status
    if (resolved !== undefined) {
      conditions.push(`resolved = $${paramCounter}`);
      params.push(resolved === 'true');
      paramCounter++;
    }

    // Filter by date range
    if (startDate) {
      conditions.push(`created_at >= $${paramCounter}`);
      params.push(new Date(startDate));
      paramCounter++;
    }

    if (endDate) {
      conditions.push(`created_at <= $${paramCounter}`);
      params.push(new Date(endDate));
      paramCounter++;
    }

    // Construct WHERE clause
    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Validate and cap limit
    const safeLimit = Math.min(parseInt(limit) || 50, 100);
    const safeOffset = parseInt(offset) || 0;

    // Query with count using window function (efficient single query)
    const query = `
      SELECT
        id,
        event_type,
        severity,
        user_id,
        ip_address,
        details,
        resolved,
        created_at,
        COUNT(*) OVER() as total_count
      FROM security_events
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCounter} OFFSET $${paramCounter + 1}
    `;

    params.push(safeLimit, safeOffset);

    const result = await pool.query(query, params);

    const events = result.rows.map(row => ({
      id: row.id,
      eventType: row.event_type,
      severity: row.severity,
      userId: row.user_id,
      ipAddress: row.ip_address,
      details: row.details,
      resolved: row.resolved,
      createdAt: row.created_at
    }));

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

    res.json({
      success: true,
      events,
      total,
      pagination: {
        limit: safeLimit,
        offset: safeOffset,
        hasMore: safeOffset + events.length < total
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
