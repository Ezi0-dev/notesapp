const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const scheduler = require('../jobs/scheduler');
const DatabaseMaintenance = require('../utils/maintenance');

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

module.exports = router;
