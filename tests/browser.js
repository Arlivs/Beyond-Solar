// Headless browser smoke test: loads the game, drives scenes through Game.* and takes screenshots.
const path = require('path');
const { chromium, webkit } = require('/Users/ebanat/.hermes/hermes-agent/node_modules/playwright');
const which = process.argv[2] || 'menu';
const engine = process.argv[3] === 'webkit' ? webkit : chromium;
(async () => {
  const exe = engine === chromium ? '/Users/ebanat/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'
    : '/Users/ebanat/Library/Caches/ms-playwright/webkit-2336/pw_run.sh';
  const browser = await engine.launch(engine === chromium ? { executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(1500);
  await page.addScriptTag({ path: path.join(__dirname, 'autopilot.js') });
  const shot = async (n) => { await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', `_${n}.png`) }); console.log('shot', n); };
  const steps = require('./scenarios')[which];
  await steps(page, shot);
  const loopErr = await page.evaluate(() => Game.lastError || null).catch(() => null);
  if (loopErr) errs.push('game loop: ' + loopErr);
  console.log(errs.length ? 'ERRORS:\n' + [...new Set(errs)].slice(0, 30).join('\n') : 'no page errors');
  await browser.close();
})();
