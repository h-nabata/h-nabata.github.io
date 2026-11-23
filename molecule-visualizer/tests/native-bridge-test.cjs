async function startupToken(engine) {
  let output = '', errors = '';
  engine.stderr.on('data', chunk => { errors += chunk; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Bridge startup timeout: ' + errors)), 20000);
    engine.stdout.on('data', chunk => {
      output += chunk;
      const match = /Token: (\S+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    engine.once('exit', code => {
      clearTimeout(timer);
      reject(Error('Bridge exited ' + code + ': ' + errors));
    });
  });
}

module.exports = {startupToken};
