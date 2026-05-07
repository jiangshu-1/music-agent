import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

export async function planWithClaude({ input, context, candidates }) {
  const systemPrompt = readFileSync(join(root, 'prompts', 'dj-persona.md'), 'utf8');

  const fullPrompt = [
    systemPrompt,
    '\n## Current Context\n',
    JSON.stringify({
      userInput: input,
      localTime: context.localTime,
      weather: context.weather,
      calendar: context.calendar,
      taste: context.taste,
      routines: context.routines,
      moodRules: context.moodRules,
      recent: context.recent,
      preferenceSummary: context.preferenceSummary,
      candidates: candidates.map(c => ({
        id: c.id,
        title: c.title,
        artist: c.artist,
        mood: c.mood,
        energy: c.energy
      }))
    }, null, 2),
    '\n## Task\n',
    'Choose a mood and a queue of songs (up to 4 ids) from the candidates.',
    'Output MUST be a single JSON object with: { mood, queueIds, say, reason, segue }',
    'mood MUST be one of: focus, low-energy, morning, night, social, open',
    'say is the DJ line in Chinese.',
    'reason is your rationale in Chinese.',
    'segue is a very short transition note.'
  ].join('\n');

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', fullPrompt, '--output', 'json']);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Claude process exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        // Normalize the result to match the planner schema
        resolve({
          mood: result.mood || 'open',
          queueIds: result.queueIds || [candidates[0]?.id],
          say: result.say || '',
          reason: result.reason || '',
          segue: result.segue || '',
          model: 'claude-code'
        });
      } catch (err) {
        reject(new Error(`Failed to parse Claude output: ${stdout}`));
      }
    });
  });
}
