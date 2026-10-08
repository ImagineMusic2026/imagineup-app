/**
 * Carga do `searchKeys` dos perfis de antes do bloco 11 (docs/arquitetura-api.md,
 * 26.7 e 26.9): a busca de fãs por nome e @ da seção Fãs do painel.
 *
 *   npm --prefix functions run build
 *   node scripts/backfill-fan-search.mjs                              (emulador)
 *   node scripts/backfill-fan-search.mjs --dry-run --project imagine-up-app
 *   node scripts/backfill-fan-search.mjs --project imagine-up-app     (produção)
 *
 * Lê users em páginas de 500 e grava o searchKeys só onde ele falta ou difere
 * do calculado pelo nome e pelo @ de agora, em transações de até 200 perfis,
 * sem updatedAt (o carimbo de edição do fã). Cada gravação dispara o gatilho
 * do perfil, que não vê nome nem @ mudados e não faz nada. Rodar de novo não
 * grava nada. Fora do package.json de propósito (os scripts entram no
 * fingerprint da EAS). Em produção, depois do deploy, primeiro com --dry-run
 * (decisão do dono em 07/10/2026, 26.21). O destino aparece antes de gravar
 * (scripts/lib/admin-script.mjs).
 */
import { runAdminScript } from './lib/admin-script.mjs';

await runAdminScript({
  script: 'backfill-fan-search.mjs',
  build: 'fan-profile/search.js',
  async run({ db, dryRun, lib }) {
    const { total, stale } = await lib.countFanSearchKeys(db);
    console.log(`Perfis: ${total}. Sem o searchKeys de agora: ${stale}.`);
    if (dryRun) {
      console.log('--dry-run: nada gravado.');
      return;
    }
    const written = await lib.writeFanSearchKeys(db);
    console.log(`searchKeys gravado em ${written} perfis.`);
  },
});
