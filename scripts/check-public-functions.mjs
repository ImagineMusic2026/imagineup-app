/**
 * Confere, depois de um deploy, se cada função chamável do imagine-up-app
 * (as callables do painel e a `api`) tem o acesso público do Cloud Run.
 *
 *   node scripts/check-public-functions.mjs
 *
 * Só leitura. Lista as funções pelo firebase-tools e lê a política de acesso
 * de cada serviço do Cloud Run pelo gcloud, que precisa estar logado na conta
 * do projeto (`gcloud auth login`; as Application Default Credentials não
 * servem). Sem o papel `roles/run.invoker` para `allUsers`, o Cloud Run barra
 * todo pedido antes da função (403), e o painel recebe um erro de rede. Isso
 * acontece com a função cuja criação falhou no meio (a cota de CPU do Cloud
 * Run, visto em 07/10/2026): ela aparece ACTIVE nas publicações seguintes,
 * que só trocam o código, e continua sem o acesso. O conserto é mostrado no
 * fim. Não chama as funções: muitas partidas a frio seguidas esbarram na cota
 * de CPU da região ("Rate exceeded"). Os gatilhos e as filas ficam de fora:
 * eles não são públicos de propósito. Fora do package.json de propósito (os
 * scripts entram no fingerprint da EAS).
 */
import { execSync } from 'node:child_process';

const PROJECT = 'imagine-up-app';
const REGION = 'southamerica-east1';

const run = (command) =>
  execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });

const raw = run(`npx --yes firebase-tools@15.32.0 functions:list --project ${PROJECT} --json`);
const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
const functions = (parsed.result ?? parsed)
  .filter((fn) => fn.callableTrigger || fn.httpsTrigger)
  .map((fn) => fn.id)
  .sort();

const blocked = [];
const failed = [];
for (const name of functions) {
  // O serviço do Cloud Run de uma função de 2ª geração é o nome em minúsculas.
  const service = name.toLowerCase();
  let policy;
  try {
    policy = JSON.parse(
      run(
        `gcloud run services get-iam-policy ${service} --region=${REGION} --project=${PROJECT} --format=json`,
      ),
    );
  } catch (error) {
    failed.push(name);
    console.log(
      `???     ${name}: ${
        String(error.stderr ?? error.message)
          .trim()
          .split('\n')[0]
      }`,
    );
    continue;
  }
  const isPublic = (policy.bindings ?? []).some(
    (binding) => binding.role === 'roles/run.invoker' && binding.members?.includes('allUsers'),
  );
  if (!isPublic) blocked.push(name);
  console.log(`${isPublic ? 'ok     ' : 'BARRADA'} ${name}`);
}

console.log(`\n${functions.length} funções chamáveis; barradas: ${blocked.length}.`);
if (failed.length) {
  console.log(
    `Não deu para ler: ${failed.join(', ')}. Confira o login do gcloud (gcloud auth list).`,
  );
  process.exitCode = 2;
}
if (blocked.length) {
  console.log('\nPara liberar (PowerShell, com o gcloud logado na conta do projeto):');
  console.log(
    `$f = ${blocked.map((name) => `"${name}"`).join(',')}; foreach ($n in $f) { gcloud functions add-invoker-policy-binding $n --region=${REGION} --member=allUsers --project=${PROJECT} }`,
  );
  process.exitCode = 1;
}
