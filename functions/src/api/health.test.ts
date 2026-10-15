import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as exported from '../index';
import { HEALTH_BODY } from './index';

// As duas pontas do contrato do aviso de api fora do ar (docs/arquitetura-api.md,
// 32.7 e 32.10): o corpo do GET /health, que o teste de disponibilidade
// "ImagineUP: api no ar" confere pelo `--matcher-content='"ok":true'`, e a
// política que dispara quando ele falha. O arquivo da política é a cópia byte
// a byte do que vai ao projeto (31.2): sem id de canal, de política ou de
// teste, que só existem depois de criados.

type Policy = {
  displayName?: unknown;
  userLabels?: unknown;
  conditions?: { conditionThreshold?: { filter?: unknown } }[];
  documentation?: { content?: unknown };
};

const POLICY_FILE = resolve(__dirname, '../../../docs/protecao/politicas/api-fora-do-ar.json');
const raw = readFileSync(POLICY_FILE, 'utf8');
const policy = JSON.parse(raw) as Policy;

/**
 * O host das funções, montado do que o deploy usa: a região do manifesto da
 * `api` (o `__endpoint` que o firebase-tools lê) e o projeto do `.firebaserc`.
 */
function apiHost(): string {
  const endpoint = (exported.api as unknown as { __endpoint: { region?: unknown } }).__endpoint;
  const firebaserc = JSON.parse(
    readFileSync(resolve(__dirname, '../../../.firebaserc'), 'utf8'),
  ) as { projects: { default: string } };
  expect(endpoint.region).toEqual(['southamerica-east1']);
  return `${(endpoint.region as string[])[0]}-${firebaserc.projects.default}.cloudfunctions.net`;
}

describe('o contrato do GET /health com o teste de disponibilidade (32.7)', () => {
  it('o HEALTH_BODY serializado é {"ok":true}, o texto que o teste procura no corpo', () => {
    // Mudar o corpo pede o `gcloud monitoring uptime update ... --matcher-content`
    // no mesmo deploy (32.17), senão o alerta dispara nas 3 regiões.
    expect(JSON.stringify(HEALTH_BODY)).toBe('{"ok":true}');
    expect(JSON.stringify(HEALTH_BODY)).toContain('"ok":true');
  });

  it('o host das funções é o da api de produção, o mesmo do EXPO_PUBLIC_API_URL', () => {
    expect(apiHost()).toBe('southamerica-east1-imagine-up-app.cloudfunctions.net');
  });
});

describe('a política "ImagineUP: api fora do ar" (docs/protecao/politicas/api-fora-do-ar.json)', () => {
  it('tem o nome dos comandos de 32.7 e o rótulo app=imagineup, que o silenciamento do deploy pega (31.5)', () => {
    expect(policy.displayName).toBe('ImagineUP: api fora do ar');
    expect(policy.userLabels).toEqual({ app: 'imagineup' });
  });

  it('olha o check_passed dos testes de URL no host da api, sem o id do teste', () => {
    expect(policy.conditions).toHaveLength(1);
    const filter = policy.conditions?.[0]?.conditionThreshold?.filter;
    expect(typeof filter).toBe('string');
    expect(filter).toContain('metric.type="monitoring.googleapis.com/uptime_check/check_passed"');
    expect(filter).toContain('resource.type="uptime_url"');
    expect(filter).toContain(`resource.labels.host="${apiHost()}"`);
    expect(filter).not.toContain('check_id');
  });

  it('o "O que fazer" abre o /api/health no host da api e espera o corpo do HEALTH_BODY', () => {
    const content = policy.documentation?.content;
    expect(typeof content).toBe('string');
    expect(content).toContain('O que fazer:');
    expect(content).toContain(`https://${apiHost()}/api/health`);
    expect(content).toContain(`\`${JSON.stringify(HEALTH_BODY)}\``);
  });

  it('não leva id de canal, de política nem de projeto: o canal entra pelo comando (31.2)', () => {
    expect(Object.keys(policy)).not.toContain('name');
    expect(Object.keys(policy)).not.toContain('notificationChannels');
    expect(raw).not.toMatch(/projects\/|notificationChannels|"name"/);
  });

  it('fica em LF, com a quebra de linha no fim, como as outras do diretório', () => {
    expect(raw).not.toContain('\r');
    expect(raw.endsWith('}\n')).toBe(true);
  });
});
