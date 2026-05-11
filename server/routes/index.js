import { routes as ambience } from './ambience.js';
import { routes as audio } from './audio.js';
import { routes as backup } from './backup.js';
import { routes as cast } from './cast.js';
import { routes as chat } from './chat.js';
import { routes as dj } from './dj.js';
import { routes as feedback } from './feedback.js';
import { routes as health } from './health.js';
import { routes as insights } from './insights.js';
import { routes as library } from './library.js';
import { routes as lyric } from './lyric.js';
import { routes as netease } from './netease.js';
import { routes as network } from './network.js';
import { routes as now } from './now.js';
import { routes as plan } from './plan.js';
import { routes as queue } from './queue.js';
import { routes as sleepTimer } from './sleep-timer.js';
import { routes as song } from './song.js';
import { routes as stations } from './stations.js';
import { routes as taste } from './taste.js';
import { routes as transport } from './transport.js';
import { routes as tts } from './tts.js';

export const routes = [
  ...now,
  ...chat,
  ...queue,
  ...stations,
  ...feedback,
  ...library,
  ...netease,
  ...network,
  ...health,
  ...backup,
  ...tts,
  ...song,
  ...transport,
  ...ambience,
  ...insights,
  ...dj,
  ...sleepTimer,
  ...audio,
  ...lyric,
  ...taste,
  ...plan,
  ...cast
];
