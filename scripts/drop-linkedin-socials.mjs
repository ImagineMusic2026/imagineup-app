/**
 * Apaga o LinkedIn guardado nas redes dos perfis (docs/arquitetura-api.md,
 * seção 28): o LinkedIn saiu do app em 02/11/2026, a pedido do dono.
 *
 *   npm --prefix functions run build
 *   node scripts/drop-linkedin-socials.mjs                              (emulador)
 *   node scripts/drop-linkedin-socials.mjs --dry-run --project imagine-up-app
 *   node scripts/drop-linkedin-socials.mjs --project imagine-up-app     (produção)
 *
 * Lê users em páginas de 500 e tira a chave `linkedin` do mapa `socials` só
 * onde ela está, em transações de até 200 perfis, sem updatedAt; o mapa que
 * fica sem nenhuma rede vira null. Rodar de novo não grava nada. Fora do
 * package.json de propósito (os scripts entram no fingerprint da EAS). Em
 * produção, só depois do deploy das funções (o servidor de antes ainda grava o
 * LinkedIn que o app de antes manda) e primeiro com --dry-run. O destino
 * aparece antes de gravar (scripts/lib/admin-script.mjs).
 */
import { runAdminScript } from './lib/admin-script.mjs';

await runAdminScript({
  script: 'drop-linkedin-socials.mjs',
  build: 'fan-profile/drop-linkedin.js',
  async run({ db, dryRun, lib }) {
    const { total, withLinkedin } = await lib.countLinkedinSocials(db);
    console.log(`Perfis: ${total}. Com o LinkedIn nas redes: ${withLinkedin}.`);
    if (dryRun) {
      console.log('--dry-run: nada gravado.');
      return;
    }
    const written = await lib.dropLinkedinSocials(db);
    console.log(`LinkedIn apagado em ${written} perfis.`);
  },
});
