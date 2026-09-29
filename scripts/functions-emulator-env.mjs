/**
 * Prepara os arquivos locais que o emulador de Functions lê para as funções da
 * equipe do painel (convites por e-mail pelo EmailJS):
 *
 * - functions/.env.demo-imagine-up-app: os parâmetros (defineString). Sem
 *   eles, o emulador pergunta cada um no terminal (e trava o CI e o
 *   `emulators:exec`) e grava as respostas em functions/.env.local, que passa
 *   por cima deste arquivo.
 * - functions/.secret.local: a chave privada do EmailJS (defineSecret). Sem
 *   ela, o emulador tenta o Secret Manager do projeto demo a cada função.
 *
 * Só acrescenta o que falta, com o EmailJS vazio (convite sem e-mail,
 * emailStatus skipped) e uma chave falsa. Valores que você já pôs ficam como
 * estão. Os dois arquivos ficam fora do git (.gitignore).
 *
 * Roda sozinho em `npm run test:functions` e `npm run emulators`, ou com
 * `node scripts/functions-emulator-env.mjs`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FUNCTIONS_DIR = fileURLToPath(new URL('../functions/', import.meta.url));

const FILES = [
  {
    name: '.env.demo-imagine-up-app',
    header: '# Parâmetros das Cloud Functions no emulador (projeto demo-imagine-up-app).',
    values: {
      EMAILJS_SERVICE_ID: '',
      EMAILJS_TEMPLATE_ID: '',
      EMAILJS_PUBLIC_KEY: '',
      PANEL_URL: 'http://localhost:3000',
    },
  },
  {
    name: '.secret.local',
    header: '# Secrets das Cloud Functions no emulador. A chave de verdade fica no Secret Manager.',
    values: { EMAILJS_PRIVATE_KEY: 'chave-falsa-do-emulador' },
  },
];

/** Nomes definidos num arquivo dotenv (linhas NOME=valor). */
function definedKeys(text) {
  return new Set(
    text
      .split(/\r?\n/)
      .map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1])
      .filter(Boolean),
  );
}

/** Cria ou completa os arquivos; devolve os nomes acrescentados por arquivo. */
export function ensureFunctionsEmulatorEnv(functionsDir = FUNCTIONS_DIR) {
  const added = {};
  for (const file of FILES) {
    const filePath = path.join(functionsDir, file.name);
    const current = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
    const keys = current === null ? new Set() : definedKeys(current);
    const missing = Object.entries(file.values).filter(([key]) => !keys.has(key));
    if (missing.length === 0) continue;
    const lines = missing.map(([key, value]) => `${key}=${value}`);
    const prefix =
      current === null ? `${file.header}\n` : current.endsWith('\n') || current === '' ? '' : '\n';
    writeFileSync(filePath, `${current ?? ''}${prefix}${lines.join('\n')}\n`);
    added[file.name] = missing.map(([key]) => key);
  }
  return added;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const added = ensureFunctionsEmulatorEnv();
  for (const [name, keys] of Object.entries(added)) {
    console.log(`functions/${name}: ${keys.join(', ')} (valores de emulador).`);
  }
}
