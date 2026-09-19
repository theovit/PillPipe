// Generate APP_PASSWORD_HASH for .env.
//   docker compose run --rm backend node scripts/hash-password.js
// Prompts on a TTY (input hidden, asked twice). When stdin is piped it reads one line,
// so it can be scripted. The password is never taken from argv (shell history).
const readline = require('readline');
const { hashPassword, MIN_LENGTH } = require('../password');

function ask(rl, question, muted) {
  return new Promise(resolve => {
    rl.stdoutMuted = false;
    rl.question(question, answer => {
      rl.stdoutMuted = false;
      if (muted) process.stdout.write('\n');
      resolve(answer);
    });
    rl.stdoutMuted = muted;
  });
}

async function readPassword() {
  const tty = process.stdin.isTTY;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!tty });
  rl._writeToOutput = function (str) {
    if (!rl.stdoutMuted) rl.output.write(str);
  };
  try {
    if (!tty) return await ask(rl, '', false);
    const first = await ask(rl, 'New password: ', true);
    const second = await ask(rl, 'Repeat password: ', true);
    if (first !== second) throw new Error('Passwords do not match.');
    return first;
  } finally {
    rl.close();
  }
}

(async () => {
  if (process.argv.length > 2) {
    console.error('Do not pass the password as an argument (it would land in shell history).');
    process.exit(2);
  }
  const password = await readPassword();
  if (password.length < MIN_LENGTH) {
    console.error(`Password must be at least ${MIN_LENGTH} characters.`);
    process.exit(1);
  }
  const hash = await hashPassword(password);
  console.log('\nAdd this line to .env (no quotes):\n');
  console.log(`APP_PASSWORD_HASH=${hash}`);
})().catch(e => {
  console.error(e.message);
  process.exit(1);
});
