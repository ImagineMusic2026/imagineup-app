/**
 * Carga da versão 1 de config/points e config/achievements (bloco 11,
 * docs/arquitetura-api.md, 26.9). Sem os documentos, as funções valem o
 * padrão do código (a versão 0), e o painel, que lê o Firestore direto, não
 * teria a régua nem os ids das conquistas.
 *
 *   npm --prefix functions run build
 *   node scripts/seed-game-config.mjs                              (emulador)
 *   node scripts/seed-game-config.mjs --dry-run --project imagine-up-app
 *   node scripts/seed-game-config.mjs --project imagine-up-app     (produção)
 *
 * Grava o padrão do código como a versão 1 (com a cópia em versions/1 e uma
 * auditoria config.seeded, "Carga inicial"), só no documento que falta, numa
 * transação: o que existe nunca é tocado, e rodar de novo não grava nada.
 * Fora do package.json de propósito (os scripts entram no fingerprint da
 * EAS). Em produção, depois do deploy, primeiro com --dry-run (decisão do dono
 * em 07/10/2026, 26.21). O destino aparece antes de gravar (scripts/lib/admin-script.mjs).
 */
import { runAdminScript } from './lib/admin-script.mjs';

await runAdminScript({
  script: 'seed-game-config.mjs',
  build: 'points/config-seed.js',
  async run({ db, dryRun, lib }) {
    const missing = await lib.readGameConfigSeed(db);
    console.log(
      missing.length > 0
        ? `Faltam: ${missing.map((name) => `config/${name}`).join(' e ')}.`
        : 'config/points e config/achievements já existem: nada a gravar.',
    );
    if (dryRun) {
      console.log('--dry-run: nada gravado.');
      return;
    }
    if (missing.length === 0) return;
    const created = await lib.seedGameConfig(db);
    console.log(
      created.length > 0
        ? `Versão 1 gravada: ${created.map((name) => `config/${name}`).join(' e ')} (com versions/1 e a auditoria config.seeded).`
        : 'Outra carga gravou no meio: nada a gravar.',
    );
  },
});
