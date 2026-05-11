import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

export const routes = [
  {
    method: 'GET',
    path: '/api/taste',
    async handler(req, res) {
      res.json({
        taste: readFileSync(join(root, 'user', 'taste.md'), 'utf8'),
        routines: readFileSync(join(root, 'user', 'routines.md'), 'utf8'),
        moodRules: readFileSync(join(root, 'user', 'mood-rules.md'), 'utf8')
      });
    }
  }
];
