// Loads the browser-global src files into one Node vm context for headless tests.
// repl: optional [[regex, replacement], ...] applied to the joined source (for tuning runs).
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = function load(files, repl) {
  const ctx = vm.createContext({ console, Math, Date, JSON, setTimeout, atob, btoa, performance: { now: () => Date.now() } });
  let src = files.map(f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n;\n');
  for (const [re, to] of repl || []) src = src.replace(re, to);
  vm.runInContext(src + '\n;globalThis.__get = (n) => eval(n);', ctx, { filename: 'bundle.js' });
  return new Proxy({}, { get: (_, n) => ctx.__get(n) });
};
