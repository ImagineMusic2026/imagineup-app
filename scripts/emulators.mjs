/**
 * Sobe os emuladores do Firebase para o app e o painel usarem no
 * desenvolvimento: Auth, Firestore (com o firestore.rules), as Cloud Functions
 * de functions/ e o Storage (com o storage.rules, porta 9199, para as fotos das
 * centrais), no projeto demo-imagine-up-app, que nunca fala com o projeto de
 * verdade.
 *
 * Os emuladores do Firestore e do Storage precisam de Java 21. Se houver
 * JAVA_HOME, o java dele vem antes do java do PATH.
 *
 * Os parâmetros e o secret das funções da equipe (EmailJS) vêm de
 * functions/.env.demo-imagine-up-app e functions/.secret.local, criados aqui
 * se faltarem: sem eles, o emulador para e pergunta cada valor no terminal.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

import { ensureFunctionsEmulatorEnv } from './functions-emulator-env.mjs';

const env = { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: '60' };
if (process.env.JAVA_HOME) {
  // No Windows a variável pode se chamar Path: troca a que existir.
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = `${path.join(process.env.JAVA_HOME, 'bin')}${path.delimiter}${env[pathKey] ?? ''}`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit', shell: true });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} saiu com ${code}`)),
    );
  });
}

ensureFunctionsEmulatorEnv();
await run('npm', ['--prefix', 'functions', 'run', 'build']);
await run('npx', [
  '--yes',
  'firebase-tools@15.32.0',
  'emulators:start',
  '--only',
  'auth,firestore,functions,storage',
  '--project',
  'demo-imagine-up-app',
]);
