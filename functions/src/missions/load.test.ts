import { describe, expect, it, vi } from 'vitest';

// O núcleo de pontos importa os modelos das missões, das conquistas e, desde a
// seção 39, do check-in diário (valores). Se eles importassem um valor do
// núcleo, o ciclo quebraria a carga em tempo de execução: aqui o núcleo falha
// ao carregar, e os três modelos precisam carregar sem ele (só `import type`,
// 22.2).
vi.mock('../points/model', () => {
  throw new Error('o modelo das missões não pode carregar o núcleo de pontos');
});
vi.mock('../points/config', () => {
  throw new Error('o modelo das missões não pode carregar a configuração');
});

describe('carga dos modelos do bloco 7', () => {
  it('o modelo das missões carrega sem o points/model.ts', async () => {
    const model = await import('./model.js');
    expect(typeof model.applyMissionTicks).toBe('function');
  });

  it('o modelo das conquistas carrega sem o points/model.ts', async () => {
    const model = await import('../achievements/model.js');
    expect(typeof model.unlockAchievements).toBe('function');
  });

  it('o modelo do check-in diário carrega sem o points/model.ts (seção 39)', async () => {
    const model = await import('../checkin/model.js');
    expect(typeof model.planCheckin).toBe('function');
    expect(typeof model.parseCheckinConfig).toBe('function');
  });
});
