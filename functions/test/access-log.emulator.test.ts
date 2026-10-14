import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PROJECT_ID, REGION, seedMember, signUpFan, useEmulators, waitFor } from './support';

/**
 * O registro de acesso nos emuladores (docs/arquitetura-api.md, 31.6 e
 * 31.11): a `api` e uma callable do painel de verdade, pelo HTTP do emulador,
 * escrevem a linha `acesso` com o último item do X-Forwarded-For forjado e o
 * uid, e o preflight não escreve a linha. A lista de origens do `cors` fica
 * no access-log.test.ts: o emulador abre o CORS de toda função (o `enableCors`
 * que ele liga no FIREBASE_DEBUG_FEATURES) e devolveria qualquer origem.
 *
 * O emulador não entrega o log das funções aos testes: ele vai ao terminal e
 * ao firebase-debug.log, que o firebase-tools do `npm run test:functions`
 * escreve na raiz do app enquanto roda (e apaga no fim, se tudo passou). O
 * teste lê esse arquivo, só o que entrou depois do pedido, e acha a linha
 * pelo IP do pedido, único em cada execução (um endereço IPv6 do bloco de
 * documentação, 2001:db8::/32). O runtime do emulador confia no proxy: o
 * `req.ip` dele é o primeiro item do cabeçalho, o forjado.
 */
const env = useEmulators('acesso', ['api', 'checkArtistHandle', 'createUserProfile']);

/** O que o cliente escreve no começo do X-Forwarded-For (bloco de documentação). */
const FORGED_IP = '203.0.113.7';

/** A raiz do app, de onde o `npm run test:functions` roda o firebase-tools. */
const ROOT = resolve(__dirname, '../..');

/** O firebase-debug.log e os nomes que o firebase-tools usa quando ele está ocupado. */
const DEBUG_LOGS = [
  'firebase-debug.log',
  ...Array.from({ length: 9 }, (_, i) => `firebase-debug.${i + 1}.log`),
].map((name) => resolve(ROOT, name));

let counter = 0;

/** Um IP só deste pedido, para achar a linha dele no log. */
function uniqueIp(): string {
  const hextet = () => parseInt(randomBytes(2).toString('hex'), 16).toString(16);
  counter += 1;
  return `2001:db8:${hextet()}:${hextet()}::${counter.toString(16)}`;
}

/** O tamanho de cada firebase-debug.log agora: o que entrar depois é deste teste. */
function logMark(): Map<string, number> {
  const mark = new Map<string, number>();
  for (const path of DEBUG_LOGS) {
    if (existsSync(path)) mark.set(path, sizeOf(path));
  }
  if (mark.size === 0) {
    throw new Error(`Sem o firebase-debug.log em ${ROOT}: rode com npm run test:functions.`);
  }
  return mark;
}

function sizeOf(path: string): number {
  const fd = openSync(path, 'r');
  try {
    return fstatSync(fd).size;
  } finally {
    closeSync(fd);
  }
}

/** O que entrou nos firebase-debug.log depois da marca. */
function logSince(mark: Map<string, number>): string {
  let text = '';
  for (const path of DEBUG_LOGS) {
    if (!existsSync(path)) continue;
    const fd = openSync(path, 'r');
    try {
      const from = mark.get(path) ?? 0;
      const size = fstatSync(fd).size;
      if (size <= from) continue;
      const buffer = Buffer.alloc(size - from);
      readSync(fd, buffer, 0, buffer.length, from);
      text += buffer.toString('utf8');
    } finally {
      closeSync(fd);
    }
  }
  return text;
}

type AccessLine = { entry: Record<string, unknown>; fn: string | null };

/**
 * As linhas `acesso` com o IP dado. No firebase-debug.log, cada linha da
 * função vem como `[info] >  {...}`, seguida dos metadados do emulador com o
 * nome da função (`"function":{"name":"southamerica-east1-api"}`).
 */
function accessLinesWith(text: string, ip: string): AccessLine[] {
  return text
    .split('\n')
    .filter((line) => line.includes(`"ip":"${ip}"`))
    .flatMap((line) => {
      const json = line.match(/\{[^{}]*"message":"acesso"[^{}]*\}/)?.[0];
      if (!json) return [];
      const fn = line.match(/"function":\{"name":"([^"]+)"\}/)?.[1] ?? null;
      return [{ entry: JSON.parse(json) as Record<string, unknown>, fn }];
    });
}

/** Espera a linha `acesso` do IP dado e devolve as que achou. */
async function waitForAccess(mark: Map<string, number>, ip: string): Promise<AccessLine[]> {
  let lines: AccessLine[] = [];
  await waitFor(`a linha acesso de ${ip} no firebase-debug.log`, async () => {
    lines = accessLinesWith(logSince(mark), ip);
    return lines.length > 0;
  });
  return lines;
}

const functionUrl = (name: string, path = '') =>
  `${env.origin()}/${PROJECT_ID}/${REGION}/${name}${path}`;

/** A callable como o SDK do painel chama, com o cabeçalho forjado. */
async function callWithForwarded(name: string, data: unknown, ip: string, token?: string) {
  const response = await fetch(functionUrl(name), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `${FORGED_IP}, ${ip}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  return (await response.json()) as { result?: unknown; error?: { status: string } };
}

describe('a linha `acesso` na api', () => {
  it('o 401 sem login: o último item do cabeçalho, nunca o forjado, e o uid null', async () => {
    const ip = uniqueIp();
    const mark = logMark();
    const response = await fetch(functionUrl('api', '/me/wallet'), {
      headers: { 'X-Forwarded-For': `${FORGED_IP}, ${ip}` },
    });
    expect(response.status).toBe(401);
    const lines = await waitForAccess(mark, ip);
    expect(lines).toHaveLength(1);
    expect(lines[0].fn).toBe(`${REGION}-api`);
    // Só o IP e o uid, no info; a data e a hora são as da entrada.
    expect(lines[0].entry).toEqual({ ip, uid: null, severity: 'INFO', message: 'acesso' });
  });

  it('com login, o uid do fã', async () => {
    const fan = await signUpFan(env.db);
    const ip = uniqueIp();
    const mark = logMark();
    const response = await fetch(functionUrl('api', '/me/wallet'), {
      headers: { 'X-Forwarded-For': `${FORGED_IP}, ${ip}`, Authorization: `Bearer ${fan.token}` },
    });
    expect(response.status).toBe(200);
    const [line] = await waitForAccess(mark, ip);
    expect(line.entry).toEqual({ ip, uid: fan.uid, severity: 'INFO', message: 'acesso' });
  });

  it('o JSON malformado, que o runtime recusa antes do handler, fica sem a linha (31.9)', async () => {
    const malformedIp = uniqueIp();
    const mark = logMark();
    const malformed = await fetch(functionUrl('api', '/me/wallet'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `${FORGED_IP}, ${malformedIp}`,
      },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    // O pedido seguinte, na mesma função, prova que o log já andou depois do malformado.
    const after = uniqueIp();
    await fetch(functionUrl('api', '/me/wallet'), {
      headers: { 'X-Forwarded-For': `${FORGED_IP}, ${after}` },
    });
    await waitForAccess(mark, after);
    expect(accessLinesWith(logSince(mark), malformedIp)).toEqual([]);
  });
});

describe('a linha `acesso` nas callables do painel', () => {
  it('com login, o uid de quem é da equipe e o último item do cabeçalho', async () => {
    const admin = await seedMember(env, 'Admin do acesso', 'admin');
    const ip = uniqueIp();
    const mark = logMark();
    const call = await callWithForwarded(
      'checkArtistHandle',
      { handle: 'acesso' },
      ip,
      admin.token,
    );
    expect(call.error).toBeUndefined();
    const lines = await waitForAccess(mark, ip);
    expect(lines).toHaveLength(1);
    expect(lines[0].fn).toBe(`${REGION}-checkArtistHandle`);
    expect(lines[0].entry).toEqual({ ip, uid: admin.uid, severity: 'INFO', message: 'acesso' });
  });

  it('sem login, a linha sai com o uid null antes da recusa', async () => {
    const ip = uniqueIp();
    const mark = logMark();
    const call = await callWithForwarded('checkArtistHandle', { handle: 'acesso' }, ip);
    expect(call.error?.status).toBe('UNAUTHENTICATED');
    const [line] = await waitForAccess(mark, ip);
    expect(line.entry).toEqual({ ip, uid: null, severity: 'INFO', message: 'acesso' });
  });

  it('o preflight do CORS não chega ao handler: sem a linha (31.9, lacuna 4)', async () => {
    const preflightIp = uniqueIp();
    const mark = logMark();
    const preflight = await fetch(functionUrl('checkArtistHandle'), {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://imagineup-admin.vercel.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
        'X-Forwarded-For': `${FORGED_IP}, ${preflightIp}`,
      },
    });
    expect(preflight.status).toBe(204);
    // A chamada seguinte, na mesma função, prova que o log já andou depois do preflight.
    const after = uniqueIp();
    await callWithForwarded('checkArtistHandle', { handle: 'acesso' }, after);
    await waitForAccess(mark, after);
    expect(accessLinesWith(logSince(mark), preflightIp)).toEqual([]);
  });
});
