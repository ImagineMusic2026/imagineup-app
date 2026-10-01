/**
 * Contas de teste nos emuladores do Firebase. Rode com `npm run emulators:seed`
 * enquanto `npm run emulators` estiver aberto. Cada conta dispara a função de
 * cadastro, que cria o perfil com o @ em alguns segundos. Depois o script grava
 * a cidade de cada um, como o fã faria no app, para o perfil bater com o protótipo.
 *
 * Só funciona contra o emulador local (127.0.0.1:9099): estas senhas não servem
 * para o projeto de verdade. Os dados somem quando os emuladores fecham, então
 * rode de novo a cada sessão.
 */
const AUTH_EMULATOR = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const USERS =
  'http://127.0.0.1:8080/v1/projects/demo-imagine-up-app/databases/(default)/documents/users';
// "owner" é o token do emulador que passa por cima das regras.
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const FANS = [
  {
    email: 'camila@teste.imagineup',
    password: 'fa-de-teste-1',
    displayName: 'Camila Ribeiro',
    city: 'Feira de Santana, BA',
  },
  {
    email: 'alan@teste.imagineup',
    password: 'fa-de-teste-2',
    displayName: 'Alan Ferreira',
    city: 'Irará, BA',
  },
];

async function auth(action, body) {
  const response = await fetch(`${AUTH_EMULATOR}/${action}?key=emulador`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, returnSecureToken: true }),
  });
  return { ok: response.ok, status: response.status, body: await response.json() };
}

/** Espera a função criar users/{uid} (até 60 s, a primeira chamada é lenta) e grava a cidade. */
async function setCity(uid, city) {
  const url = `${USERS}/${uid}?updateMask.fieldPaths=city&currentDocument.exists=true`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: OWNER,
      body: JSON.stringify({ fields: { city: { stringValue: city } } }),
    });
    if (response.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`O perfil ${uid} não apareceu: a função de cadastro está no ar?`);
}

for (const { city, ...fan } of FANS) {
  let result = await auth('accounts:signUp', fan);
  if (result.ok) {
    console.log(`Conta criada: ${fan.email} (${fan.displayName}).`);
  } else if (result.body.error?.message === 'EMAIL_EXISTS') {
    console.log(`Já existe: ${fan.email}.`);
    result = await auth('accounts:signInWithPassword', fan);
  }
  if (!result.ok) {
    throw new Error(`Não criou ${fan.email}: ${result.body.error?.message ?? result.status}`);
  }
  await setCity(result.body.localId, city);
  console.log(`Cidade de ${fan.displayName}: ${city}.`);
}
