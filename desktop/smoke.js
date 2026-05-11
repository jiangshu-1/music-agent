// Boots Electron just long enough to prove main.js loads and the server handshake works.
// Exits cleanly in headless-friendly way. Used by scripts/check.js if DESKTOP_SMOKE=1.
import { app } from 'electron';

app.on('ready', () => {
  console.log('[desktop-smoke] electron app ready');
  setTimeout(() => {
    console.log('[desktop-smoke] exiting');
    app.exit(0);
  }, 800);
});
