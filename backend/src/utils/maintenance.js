const { pool } = require('../config/database');
const { logger } = require('./logger');

/**
 * Database Maintenance Utility
 * Provides automated cleanup and health monitoring functions
 */

class DatabaseMaintenance {
  /**
   * Cleanup expired refresh tokens
   * Runs: Daily at 2:00 AM
   */
  static async cleanupExpiredTokens() {
    const startTime = Date.now();

    try {
      logger.info('Starting expired token cleanup...');

      const result = await pool.query('SELECT * FROM cleanup_expired_tokens()');
      const deletedCount = result.rows[0]?.deleted_count || 0;

      const duration = Date.now() - startTime;
      logger.info(`Token cleanup completed: ${deletedCount} tokens deleted in ${duration}ms`);

      return { success: true, deletedCount, duration };
    } catch (error) {
      logger.error('Token cleanup failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cleanup old rate limit records
   * Runs: Every 6 hours
   */
  static async cleanupRateLimits() {
    const startTime = Date.now();

    try {
      logger.info('Starting rate limit cleanup...');

      const result = await pool.query('SELECT cleanup_old_rate_limits()');
      const deletedCount = result.rows[0]?.cleanup_old_rate_limits || 0;

      const duration = Date.now() - startTime;
      logger.info(`Rate limit cleanup completed: ${deletedCount} records deleted in ${duration}ms`);

      return { success: true, deletedCount, duration };
    } catch (error) {
      logger.error('Rate limit cleanup failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Analyze and vacuum tables for optimal performance
   * Runs: Weekly on Sunday at 3:00 AM
   */
  static async vacuumAnalyze() {
    const startTime = Date.now();

    try {
      logger.info('Starting VACUUM ANALYZE...');

      // VACUUM ANALYZE reclaims space and updates statistics
      // This improves query planner decisions
      await pool.query('VACUUM ANALYZE');

      const duration = Date.now() - startTime;
      logger.info(`VACUUM ANALYZE completed in ${duration}ms`);

      return { success: true, duration };
    } catch (error) {
      logger.error('VACUUM ANALYZE failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get database health metrics
   */
  static async getHealthMetrics() {
    try {
      // Table statistics - size, row counts
      const tableStats = await pool.query(`
        SELECT
          schemaname,
          relname as table_name,
          n_live_tup as live_rows,
          n_dead_tup as dead_rows,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||relname)) as total_size
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(schemaname||'.'||relname) DESC
      `);

      // Index usage - find unused indexes
      const indexUsage = await pool.query(`
        SELECT
          schemaname,
          relname as tablename,
          indexrelname as indexname,
          idx_scan,
          pg_size_pretty(pg_relation_size(indexrelid)) as index_size
        FROM pg_stat_user_indexes
        WHERE idx_scan = 0
        AND pg_relation_size(indexrelid) > 1048576
        ORDER BY pg_relation_size(indexrelid) DESC
      `); // Unused indexes > 1MB

      // Security events summary
      const securitySummary = await pool.query(`
        SELECT
          severity,
          COUNT(*) as event_count,
          COUNT(*) FILTER (WHERE NOT resolved) as unresolved_count
        FROM security_events
        WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
        GROUP BY severity
        ORDER BY
          CASE severity
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
          END
      `);

      // User statistics
      const userStats = await pool.query(`
        SELECT COUNT(*) as total_users,
               COUNT(*) FILTER (WHERE last_login > CURRENT_TIMESTAMP - INTERVAL '7 days') as active_users,
               COUNT(*) FILTER (WHERE last_login > CURRENT_TIMESTAMP - INTERVAL '30 days') as monthly_active
        FROM users
        WHERE deleted_at IS NULL
      `);

      return {
        success: true,
        metrics: {
          tables: tableStats.rows,
          unusedIndexes: indexUsage.rows,
          security: securitySummary.rows,
          users: userStats.rows[0]
        }
      };
    } catch (error) {
      logger.error('Failed to retrieve health metrics:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check for table bloat and recommend actions
   */
  static async checkTableBloat() {
    try {
      const result = await pool.query(`
        SELECT
          schemaname || '.' || relname as table_name,
          n_live_tup as live_rows,
          n_dead_tup as dead_rows,
          CASE
            WHEN n_live_tup > 0
            THEN ROUND((n_dead_tup::numeric / n_live_tup::numeric) * 100, 2)
            ELSE 0
          END as bloat_percentage
        FROM pg_stat_user_tables
        WHERE n_dead_tup > 100
        ORDER BY n_dead_tup DESC
      `);

      const bloatedTables = result.rows.filter(row => row.bloat_percentage > 20);

      if (bloatedTables.length > 0) {
        logger.warn(`Found ${bloatedTables.length} tables with significant bloat (>20%)`);
        bloatedTables.forEach(table => {
          logger.warn(`  - ${table.table_name}: ${table.bloat_percentage}% bloat (${table.dead_rows} dead rows)`);
        });
      } else {
        logger.info('No significant table bloat detected');
      }

      return {
        success: true,
        bloatedTables,
        recommendation: bloatedTables.length > 0 ? 'Run VACUUM ANALYZE' : 'No action needed'
      };
    } catch (error) {
      logger.error('Bloat check failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Archive old read notifications (hard delete)
   * Runs: Monthly on 1st at 4:00 AM
   */
  static async archiveOldNotifications() {
    const startTime = Date.now();

    try {
      logger.info('Archiving old notifications...');

      // Delete notifications older than 90 days that are already read
      const result = await pool.query(`
        DELETE FROM notifications
        WHERE is_read = true
        AND created_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
        RETURNING id
      `);

      const archivedCount = result.rowCount;
      const duration = Date.now() - startTime;

      logger.info(`Notification archival completed: ${archivedCount} notifications deleted in ${duration}ms`);

      // Log to audit
      await pool.query(`
        INSERT INTO audit_logs (user_id, action, resource_type, details)
        VALUES (NULL, 'notification_archive', 'notifications', $1)
      `, [JSON.stringify({ archived_count: archivedCount, duration })]);

      return { success: true, archivedCount, duration };
    } catch (error) {
      logger.error('Notification archival failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Run all maintenance tasks
   * Use this for manual maintenance or emergency cleanup
   */
  static async runFullMaintenance() {
    logger.info('========================================');
    logger.info('Starting full database maintenance...');
    logger.info('========================================');

    const results = {
      startTime: new Date().toISOString(),
      tasks: {}
    };

    // Run cleanup tasks
    results.tasks.tokens = await this.cleanupExpiredTokens();
    results.tasks.rateLimits = await this.cleanupRateLimits();
    results.tasks.notifications = await this.archiveOldNotifications();

    // Check health
    results.tasks.bloatCheck = await this.checkTableBloat();

    // If bloat detected, run vacuum
    if (results.tasks.bloatCheck.bloatedTables?.length > 0) {
      results.tasks.vacuum = await this.vacuumAnalyze();
    }

    results.endTime = new Date().toISOString();
    results.success = Object.values(results.tasks).every(task => task.success);

    logger.info('========================================');
    logger.info(`Full maintenance completed: ${results.success ? 'SUCCESS' : 'PARTIAL FAILURE'}`);
    logger.info('========================================');

    return results;
  }

  /**
   * Generate maintenance report
   */
  static async generateReport() {
    try {
      const health = await this.getHealthMetrics();
      const bloat = await this.checkTableBloat();

      const report = {
        timestamp: new Date().toISOString(),
        health: health.metrics,
        bloat: bloat.bloatedTables,
        recommendations: []
      };

      // Generate recommendations
      if (bloat.bloatedTables?.length > 0) {
        report.recommendations.push('Run VACUUM ANALYZE to reclaim space');
      }

      if (health.metrics?.unusedIndexes?.length > 0) {
        report.recommendations.push(`Consider dropping ${health.metrics.unusedIndexes.length} unused indexes`);
      }

      if (health.metrics?.security?.some(s => s.unresolved_count > 0)) {
        report.recommendations.push('Review unresolved security events');
      }

      logger.info('Maintenance report generated:', JSON.stringify(report, null, 2));

      return report;
    } catch (error) {
      logger.error('Report generation failed:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = DatabaseMaintenance;
