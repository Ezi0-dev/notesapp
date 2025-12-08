const cron = require('node-cron');
const DatabaseMaintenance = require('../utils/maintenance');
const { logger } = require('../utils/logger');

/**
 * Scheduled Job Manager
 * Configures and manages automated database maintenance tasks
 */

class JobScheduler {
  constructor() {
    this.jobs = [];
    this.isRunning = false;
  }

  /**
   * Initialize and start all scheduled jobs
   */
  start() {
    if (this.isRunning) {
      logger.warn('Job scheduler is already running');
      return;
    }

    logger.info('Initializing scheduled maintenance jobs...');

    // Job 1: Cleanup expired tokens - Daily at 2:00 AM
    const tokenCleanup = cron.schedule('0 2 * * *', async () => {
      logger.info('[CRON] Running scheduled token cleanup...');
      await DatabaseMaintenance.cleanupExpiredTokens();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.push({ name: 'Token Cleanup', schedule: '0 2 * * *', task: tokenCleanup });

    // Job 2: Cleanup rate limits - Every 6 hours
    const rateLimitCleanup = cron.schedule('0 */6 * * *', async () => {
      logger.info('[CRON] Running scheduled rate limit cleanup...');
      await DatabaseMaintenance.cleanupRateLimits();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.push({ name: 'Rate Limit Cleanup', schedule: '0 */6 * * *', task: rateLimitCleanup });

    // Job 3: Archive old notifications - Monthly on 1st at 4:00 AM
    const notificationArchive = cron.schedule('0 4 1 * *', async () => {
      logger.info('[CRON] Running scheduled notification archival...');
      await DatabaseMaintenance.archiveOldNotifications();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.push({ name: 'Notification Archive', schedule: '0 4 1 * *', task: notificationArchive });

    // Job 4: Check table bloat - Daily at 3:00 AM
    const bloatCheck = cron.schedule('0 3 * * *', async () => {
      logger.info('[CRON] Running scheduled bloat check...');
      const result = await DatabaseMaintenance.checkTableBloat();

      // If significant bloat detected, run VACUUM ANALYZE
      if (result.bloatedTables && result.bloatedTables.length > 0) {
        logger.info('[CRON] Bloat detected, running VACUUM ANALYZE...');
        await DatabaseMaintenance.vacuumAnalyze();
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.push({ name: 'Bloat Check', schedule: '0 3 * * *', task: bloatCheck });

    // Job 5: Weekly full vacuum - Sunday at 3:30 AM
    const weeklyVacuum = cron.schedule('30 3 * * 0', async () => {
      logger.info('[CRON] Running weekly VACUUM ANALYZE...');
      await DatabaseMaintenance.vacuumAnalyze();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.push({ name: 'Weekly Vacuum', schedule: '30 3 * * 0', task: weeklyVacuum });

    // Job 6: Generate health report - Daily at 8:00 AM
    const healthReport = cron.schedule('0 8 * * *', async () => {
      logger.info('[CRON] Generating daily health report...');
      await DatabaseMaintenance.generateReport();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.push({ name: 'Health Report', schedule: '0 8 * * *', task: healthReport });

    this.isRunning = true;

    logger.info(`✓ Job scheduler started with ${this.jobs.length} scheduled tasks:`);
    this.jobs.forEach(job => {
      logger.info(`  - ${job.name}: ${job.schedule}`);
    });
  }

  /**
   * Stop all scheduled jobs
   */
  stop() {
    if (!this.isRunning) {
      logger.warn('Job scheduler is not running');
      return;
    }

    logger.info('Stopping scheduled jobs...');

    this.jobs.forEach(job => {
      job.task.stop();
    });

    this.jobs = [];
    this.isRunning = false;

    logger.info('✓ All scheduled jobs stopped');
  }

  /**
   * Get status of all jobs
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      jobCount: this.jobs.length,
      jobs: this.jobs.map(job => ({
        name: job.name,
        schedule: job.schedule,
        nextRun: this.getNextRun(job.schedule)
      }))
    };
  }

  /**
   * Calculate next run time for a cron schedule (simplified)
   */
  getNextRun(schedule) {
    // This is a simplified version - node-cron doesn't expose next run time directly
    return 'Check cron schedule: ' + schedule;
  }

  /**
   * Run a specific job manually
   */
  async runJobManually(jobName) {
    const job = this.jobs.find(j => j.name === jobName);

    if (!job) {
      logger.error(`Job not found: ${jobName}`);
      return { success: false, error: 'Job not found' };
    }

    logger.info(`Manually triggering job: ${jobName}`);

    try {
      // Jobs don't return values directly, so we call the maintenance function
      switch (jobName) {
        case 'Token Cleanup':
          return await DatabaseMaintenance.cleanupExpiredTokens();
        case 'Rate Limit Cleanup':
          return await DatabaseMaintenance.cleanupRateLimits();
        case 'Notification Archive':
          return await DatabaseMaintenance.archiveOldNotifications();
        case 'Bloat Check':
          return await DatabaseMaintenance.checkTableBloat();
        case 'Weekly Vacuum':
          return await DatabaseMaintenance.vacuumAnalyze();
        case 'Health Report':
          return await DatabaseMaintenance.generateReport();
        default:
          return { success: false, error: 'Unknown job' };
      }
    } catch (error) {
      logger.error(`Manual job execution failed: ${jobName}`, error);
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
const scheduler = new JobScheduler();

module.exports = scheduler;
