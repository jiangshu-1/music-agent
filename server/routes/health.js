import { libraryStats } from '../db.js';
import { libraryInfo } from '../library.js';
import { localAddresses } from '../network.js';
import { hasNeteaseProvider, userNeteasePlaylists } from '../netease.js';
import { externalSnapshots } from '../resilience.js';
import { fishStatus } from '../tts.js';
import { refreshDevices } from '../upnp.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/health',
    async handler(req, res) {
      const stats = libraryStats();
      const checks = [];
      checks.push({
        id: 'library',
        label: '曲库',
        status: stats.imported || libraryInfo().count ? 'ok' : 'warn',
        detail: `网易云 ${stats.imported} 首，本地 ${libraryInfo().count} 首，缺地址 ${stats.missingUrl} 首`
      });
      checks.push({
        id: 'duplicates',
        label: '重复治理',
        status: stats.duplicateGroups.length ? 'warn' : 'ok',
        detail: stats.duplicateGroups.length
          ? `${stats.duplicateGroups.length} 组疑似重复，可在曲库页处理`
          : '没有未处理的可见重复组'
      });
      checks.push({
        id: 'netease-config',
        label: '网易云配置',
        status: hasNeteaseProvider() && process.env.NETEASE_COOKIE ? 'ok' : 'bad',
        detail: hasNeteaseProvider()
          ? process.env.NETEASE_COOKIE ? `接口 ${process.env.NETEASE_API_BASE}，Cookie 已配置` : '接口已配置，但缺 Cookie'
          : '缺 NETEASE_API_BASE'
      });

      const withTimeout = (promise, ms, onTimeout) => Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(onTimeout()), ms))
      ]);

      const [neteaseLoginCheck, ttsInfo, devices] = await Promise.all([
        hasNeteaseProvider()
          ? withTimeout(
              userNeteasePlaylists({ limit: 1 })
                .then((playlists) => ({
                  id: 'netease-login',
                  label: '网易云登录',
                  status: playlists.playlists.length ? 'ok' : 'warn',
                  detail: playlists.playlists.length ? `账号 ${playlists.uid} 可读取歌单` : '能连通，但没有读到歌单'
                }))
                .catch((error) => ({
                  id: 'netease-login',
                  label: '网易云登录',
                  status: 'warn',
                  detail: `无法连接网易云接口：${error.message}`
                })),
              2500,
              () => ({ id: 'netease-login', label: '网易云登录', status: 'warn', detail: '网易云接口超时（2.5s 无响应）' })
            )
          : Promise.resolve(null),
        withTimeout(fishStatus(), 3500, () => ({ provider: 'unknown', error: 'Fish 状态查询超时' })),
        withTimeout(refreshDevices({ timeout: 800 }).catch(() => []), 1500, () => [])
      ]);

      if (neteaseLoginCheck) checks.push(neteaseLoginCheck);

      checks.push({
        id: 'fish',
        label: 'Fish DJ 声音',
        status: ttsInfo.provider === 'fish' && !ttsInfo.credit?.error ? 'ok' : 'warn',
        detail: ttsInfo.provider === 'fish'
          ? ttsInfo.credit?.error ? `Fish 已配置，余额检查失败：${ttsInfo.credit.error}` : `Fish 已配置，余额 ${ttsInfo.credit?.credit ?? '未知'}`
          : ttsInfo.error ? ttsInfo.error : '未配置 Fish，使用浏览器朗读'
      });

      checks.push({
        id: 'cast',
        label: '音箱投放',
        status: devices.length ? 'ok' : 'warn',
        detail: devices.length ? `发现 ${devices.length} 个 UPnP 设备` : '暂未发现 UPnP 音箱'
      });

      const addresses = localAddresses(Number(process.env.PORT ?? 8080));
      checks.push({
        id: 'network',
        label: '手机访问',
        status: addresses.length ? 'ok' : 'warn',
        detail: addresses.length ? addresses.map((item) => item.url).join(' / ') : '没有可用局域网地址'
      });

      const score = checks.every((check) => check.status === 'ok')
        ? 'ok'
        : checks.some((check) => check.status === 'bad') ? 'bad' : 'warn';
      res.json({ status: score, checks, stats, externals: externalSnapshots() });
    }
  }
];
