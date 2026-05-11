import { planNext } from './brain.js';
import { syncImportedPlaylists } from './netease.js';
import { setPref, getPref, recordPlay } from './db.js';
import { logger } from './logger.js';

const log = logger.withTag('scheduler');

let intervalId = null;

function sleepTimerState() {
  const timer = getPref('sleep_timer', null);
  if (!timer?.expiresAt) return null;
  const expiresAt = new Date(timer.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return null;
  return {
    expiresAt: timer.expiresAt,
    fadeSec: Number(timer.fadeSec ?? 20),
    note: timer.note ?? '',
    remainingMs: expiresAt - Date.now()
  };
}

export function setSleepTimer({ minutes, fadeSec = 20, note = '' } = {}) {
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0) {
    setPref('sleep_timer', null);
    return null;
  }
  const expiresAt = new Date(Date.now() + mins * 60 * 1000).toISOString();
  const record = { expiresAt, fadeSec: Math.max(0, Math.min(120, Number(fadeSec) || 0)), note };
  setPref('sleep_timer', record);
  return sleepTimerState();
}

export function clearSleepTimer() {
  setPref('sleep_timer', null);
}

export function getSleepTimer() {
  return sleepTimerState();
}

export function startScheduler(onPlanUpdate, onSleepExpire) {
  if (intervalId) return;

  const triggeredMinutes = new Set();

  // Check every 20s so we notice the sleep timer expiring promptly.
  intervalId = setInterval(() => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const dayKey = `${now.toDateString()}@${timeStr}`;

    // Scheduled plans (only once per clock minute per day)
    const scheduleTable = {
      '07:00': '醒脑时间',
      '09:00': '开始深度工作',
      '14:00': '午后提神',
      '20:00': '晚间放松',
      '23:30': '准备休息'
    };
    const scheduledReason = scheduleTable[timeStr];
    if (scheduledReason && !triggeredMinutes.has(dayKey)) {
      triggeredMinutes.add(dayKey);
      triggerScheduledPlan(scheduledReason, onPlanUpdate);
    }

    // Nightly NetEase playlist incremental sync at 03:30.
    if (timeStr === '03:30' && !triggeredMinutes.has(dayKey)) {
      triggeredMinutes.add(dayKey);
      triggerNightlySync();
    }

    // Sleep timer expiry
    const sleep = sleepTimerState();
    if (sleep && sleep.remainingMs <= 0) {
      clearSleepTimer();
      if (onSleepExpire) {
        try {
          onSleepExpire(sleep);
        } catch (error) {
          log.error('sleep expire handler failed', { error: error.message });
        }
      }
    }

    // Prune day keys to avoid unbounded growth (> 24h old)
    if (triggeredMinutes.size > 48) triggeredMinutes.clear();
  }, 20_000);

  log.info('scheduler started');
}

async function triggerScheduledPlan(reason, onPlanUpdate) {
  log.info('triggering scheduled plan', { reason });
  try {
    const plan = await planNext(reason);
    setPref('current', plan.queue[0]);
    setPref('queue', plan.queue);
    recordPlay(plan.queue[0], plan.mood, 'scheduled');
    
    if (onPlanUpdate) {
      onPlanUpdate(plan);
    }
  } catch (err) {
    log.error('failed to trigger scheduled plan', { error: err.message });
  }
}

async function triggerNightlySync() {
  log.info('triggering nightly netease playlist sync');
  try {
    const result = await syncImportedPlaylists();
    if (!result.skipped) {
      setPref('netease_last_sync', { syncedAt: result.syncedAt, totalAdded: result.totalAdded });
      log.info('nightly sync completed', { totalAdded: result.totalAdded, playlists: result.playlists.length });
    }
  } catch (err) {
    log.error('nightly sync failed', { error: err.message });
  }
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
