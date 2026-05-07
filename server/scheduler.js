import { planNext } from './brain.js';
import { setPref, recordPlay } from './db.js';

let intervalId = null;

export function startScheduler(onPlanUpdate) {
  if (intervalId) return;

  // Check every minute
  intervalId = setInterval(() => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });

    // Scheduled plans
    if (timeStr === '07:00') triggerScheduledPlan('醒脑时间', onPlanUpdate);
    if (timeStr === '09:00') triggerScheduledPlan('开始深度工作', onPlanUpdate);
    if (timeStr === '14:00') triggerScheduledPlan('午后提神', onPlanUpdate);
    if (timeStr === '20:00') triggerScheduledPlan('晚间放松', onPlanUpdate);
    if (timeStr === '23:30') triggerScheduledPlan('准备休息', onPlanUpdate);

    // Hourly mood check could be added here
  }, 60000);

  console.log('Scheduler started');
}

async function triggerScheduledPlan(reason, onPlanUpdate) {
  console.log(`Triggering scheduled plan: ${reason}`);
  try {
    const plan = await planNext(reason);
    setPref('current', plan.queue[0]);
    setPref('queue', plan.queue);
    recordPlay(plan.queue[0], plan.mood, 'scheduled');
    
    if (onPlanUpdate) {
      onPlanUpdate(plan);
    }
  } catch (err) {
    console.error('Failed to trigger scheduled plan:', err);
  }
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
