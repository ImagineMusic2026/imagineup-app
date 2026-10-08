/**
 * Carga da seção e dos alvos das entradas de staffAudit de antes do bloco 11
 * (docs/arquitetura-api.md, 26.8 e 26.9): os filtros dos Logs do painel.
 *
 *   npm --prefix functions run build
 *   node scripts/backfill-audit-index.mjs                              (emulador)
 *   node scripts/backfill-audit-index.mjs --dry-run --project imagine-up-app
 *   node scripts/backfill-audit-index.mjs --project imagine-up-app     (produção)
 *
 * Lê staffAudit em páginas de 500 e grava `section` e `targets` só nas
 * entradas que não têm os dois, pelo mesmo auditIndex do writeAudit, em lotes.
 * A entrada da auditoria não muda depois de gravada; rodar de novo não grava
 * nada. Fora do package.json de propósito (os scripts entram no fingerprint da
 * EAS). Em produção, depois do deploy, primeiro com --dry-run (decisão do dono
 * em 07/10/2026, 26.21). O destino aparece antes de gravar
 * (scripts/lib/admin-script.mjs).
 */
import { runAdminScript } from './lib/admin-script.mjs';

await runAdminScript({
  script: 'backfill-audit-index.mjs',
  build: 'staff/audit-index.js',
  async run({ db, dryRun, lib }) {
    const { total, missing, bySection } = await lib.countAuditIndexBackfill(db);
    const sections = Object.entries(bySection)
      .map(([section, count]) => `${section}: ${count}`)
      .join(', ');
    console.log(
      `Entradas: ${total}. Sem a seção ou os alvos: ${missing}${sections ? ` (${sections})` : ''}.`,
    );
    if (dryRun) {
      console.log('--dry-run: nada gravado.');
      return;
    }
    const written = await lib.writeAuditIndexBackfill(db);
    console.log(`Seção e alvos gravados em ${written} entradas.`);
  },
});
