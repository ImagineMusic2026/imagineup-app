import { describe, expect, it } from 'vitest';

import * as exported from './index';

// CPU e concorrência de cada função (decisão do dono em 08/10/2026). A cota
// "Total CPU allocation, per project per region" do Cloud Run em
// southamerica-east1 é de 20 vCPU, e cada instância parada conta nela por uns
// 15 min. Só a `api`, que atende os fãs, tem 1 vCPU e concorrência 80; as
// outras usam a CPU da 1ª geração (`gcf_gen1`), fracionada, com concorrência
// 1. O teste lê o `__endpoint` de cada export: o mesmo manifesto que o
// firebase-tools lê no deploy.

/** A cota de CPU da região (o Google não aumenta sem histórico de uso). */
const REGION_CPU_QUOTA = 20;

/**
 * As funções com 1 vCPU inteira. Entrar outra aqui é decisão do dono, com o
 * motivo no comentário da função e a `concurrency` dela escrita.
 */
const FULL_CPU = new Set(['api']);

/** Memória de uma função sem `memory` (o `DEFAULT_MEMORY` do firebase-tools). */
const DEFAULT_MEMORY_MB = 256;

/**
 * A CPU que o `gcf_gen1` vira no deploy, pela memória: a tabela
 * `memoryToGen1Cpu` do firebase-tools 15.32.0 (`deploy/functions/backend.js`).
 */
const GEN1_CPU: Record<number, number> = {
  128: 0.0833,
  256: 0.1666,
  512: 0.3333,
  1024: 0.5833,
  2048: 1,
  4096: 2,
  8192: 2,
};

type Endpoint = {
  cpu?: unknown;
  concurrency?: unknown;
  availableMemoryMb?: unknown;
  maxInstances?: unknown;
  eventTrigger?: { retry?: unknown };
  taskQueueTrigger?: { rateLimits?: { maxConcurrentDispatches?: unknown } };
};

const endpoints = new Map<string, Endpoint>(
  Object.entries(exported).flatMap(([name, value]): [string, Endpoint][] => {
    const endpoint = (value as unknown as { __endpoint?: Endpoint }).__endpoint;
    return endpoint ? [[name, endpoint]] : [];
  }),
);

/** As filas, lidas do manifesto: fila nova entra sozinha nos testes. */
const QUEUES = [...endpoints]
  .filter(([, endpoint]) => endpoint.taskQueueTrigger)
  .map(([name]) => name);

function endpointOf(name: string): Endpoint {
  const endpoint = endpoints.get(name);
  if (!endpoint) throw new Error(`${name} não é uma função exportada`);
  return endpoint;
}

function memoryOf(endpoint: Endpoint): number {
  return typeof endpoint.availableMemoryMb === 'number'
    ? endpoint.availableMemoryMb
    : DEFAULT_MEMORY_MB;
}

/** A vCPU de uma instância: o `gcf_gen1` pela tabela, o número como veio, e 1 sem nada. */
function vcpuOf(endpoint: Endpoint): number {
  if (endpoint.cpu === 'gcf_gen1') return GEN1_CPU[memoryOf(endpoint)] ?? Number.NaN;
  if (typeof endpoint.cpu === 'number') return endpoint.cpu;
  return 1;
}

describe('CPU e concorrência das funções', () => {
  it('o manifesto tem as funções de cada tipo: a api, callables, gatilhos, filas e agendadas', () => {
    for (const name of [
      'api',
      'createStaffInvite',
      'createUserProfile',
      'queuePostCountSync',
      'rankingTick',
      'closeStatsDays',
    ]) {
      expect(endpoints.has(name), name).toBe(true);
    }
  });

  it('as filas lidas do manifesto incluem as três de cópia', () => {
    expect(QUEUES).toEqual(
      expect.arrayContaining(['syncArtistFanCount', 'syncPostCounts', 'syncFanProfile']),
    );
  });

  it('só as funções do FULL_CPU têm 1 vCPU; a api, com concorrência 80 e 512 MiB', () => {
    const api = endpointOf('api');
    expect(api.cpu).toBe(1);
    expect(api.concurrency).toBe(80);
    expect(api.availableMemoryMb).toBe(512);
    expect(api.maxInstances).toBe(8);
    for (const name of FULL_CPU) {
      expect(typeof endpointOf(name).concurrency, name).toBe('number');
    }
  });

  it('as outras usam o gcf_gen1, abaixo de 1 vCPU, com concorrência 1', () => {
    const others = [...endpoints].filter(([name]) => !FULL_CPU.has(name));
    const wrong = others
      .filter(([, endpoint]) => {
        return endpoint.cpu !== 'gcf_gen1' || endpoint.concurrency !== 1 || !(vcpuOf(endpoint) < 1);
      })
      .map(([name]) => name);
    expect(wrong).toEqual([]);
  });

  it('o padrão dá 1/6 de vCPU; o rankingTick e o createUserProfile, com 512 MiB, 1/3', () => {
    expect(vcpuOf(endpointOf('createStaffInvite'))).toBe(0.1666);
    expect(vcpuOf(endpointOf('closeStatsDays'))).toBe(0.1666);
    expect(vcpuOf(endpointOf('rankingTick'))).toBe(0.3333);
    expect(vcpuOf(endpointOf('createUserProfile'))).toBe(0.3333);
  });

  it('uma instância de cada função, todas acordadas ao mesmo tempo, cabe na cota de 20 vCPU', () => {
    const total = [...endpoints.values()].reduce((sum, endpoint) => sum + vcpuOf(endpoint), 0);
    // Com 1 vCPU em todas, eram 64. Hoje: a api, o rankingTick e o
    // createUserProfile a 1/3 e as outras 61 a 1/6, uns 11,8.
    expect(total).toBeLessThan(REGION_CPU_QUOTA);
  });

  it('a api cheia, com uma instância de cada outra função, ainda cabe na cota de 20 vCPU', () => {
    const others = [...endpoints]
      .filter(([name]) => name !== 'api')
      .reduce((sum, [, endpoint]) => sum + vcpuOf(endpoint), 0);
    const api = endpointOf('api');
    // As 8 instâncias da api a 1 vCPU mais uns 10,8 das outras: uns 18,8.
    expect((api.maxInstances as number) * vcpuOf(api) + others).toBeLessThan(REGION_CPU_QUOTA);
  });

  it('os gatilhos de evento tentam de novo (o 429 da concorrência 1 depende disso)', () => {
    const events = [...endpoints].filter(([, endpoint]) => endpoint.eventTrigger);
    expect(events.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'createUserProfile',
        'deleteUserProfile',
        'queueArtistFanCountSync',
        'queuePostCountSync',
        'queueFanProfileSync',
      ]),
    );
    const withoutRetry = events
      .filter(([, endpoint]) => endpoint.eventTrigger?.retry !== true)
      .map(([name]) => name);
    expect(withoutRetry).toEqual([]);
  });

  it('as filas mandam no máximo uma tarefa por instância de cada vez', () => {
    for (const name of QUEUES) {
      const endpoint = endpointOf(name);
      const dispatches = endpoint.taskQueueTrigger?.rateLimits?.maxConcurrentDispatches;
      expect(typeof dispatches, name).toBe('number');
      expect(typeof endpoint.maxInstances, name).toBe('number');
      expect(dispatches as number, name).toBeLessThanOrEqual(endpoint.maxInstances as number);
    }
  });
});
