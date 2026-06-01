import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { Types } from 'mongoose';
import ScheduledNotification from '../models/ScheduledNotification';
import { executeBroadcastJob } from '../services/broadcastService';
import { executeIndividualMessageJob } from '../services/studentMessageService';
import logger from '../utils/logger';

/**
 * Starts the cron worker that fires every minute.
 * Finds all pending jobs where scheduledFor <= now and executes them.
 * Each job is processed independently — one failure does not stop others.
 *
 * Call this once from index.ts after DB is connected.
 */
export const startSchedulerWorker = (bot: TelegramBot): void => {
  cron.schedule('* * * * *', async () => {
    const now = new Date();

    let pendingJobs;
    try {
      pendingJobs = await ScheduledNotification.find({
        status: 'pending',
        scheduledFor: { $lte: now }
      });
    } catch (err) {
      logger.error({ err }, 'Scheduler: DB query failed');
      return;
    }

    if (pendingJobs.length === 0) return;

    logger.info({ count: pendingJobs.length }, 'Scheduler: processing jobs');

    for (const job of pendingJobs) {
      try {
        if (job.targetType === 'broadcast') {
          await executeBroadcastJob(
            bot,
            job.teacherId as Types.ObjectId,
            'Teacher',           // name used only in logs; not displayed to parents
            job.teacherChatId,
            job.targetClass,
            job.message
          );
        } else {
          // individual — studentId is guaranteed present for this type
          await executeIndividualMessageJob(
            bot,
            job.teacherId as Types.ObjectId,
            job.teacherChatId,
            job.targetClass,
            job.studentId as Types.ObjectId,
            job.studentName ?? 'Student',
            job.message
          );
        }

        job.status = 'sent';
        job.sentAt = new Date();
        await job.save();

        logger.info({ jobId: job._id, type: job.targetType }, 'Scheduler: job completed');

      } catch (err) {
        job.status = 'failed';
        await job.save();
        logger.error({ jobId: job._id, err }, 'Scheduler: job failed');
      }
    }
  });

  logger.info('Scheduler worker started (runs every minute)');
};
