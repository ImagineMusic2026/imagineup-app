/**
 * Contas de teste nos emuladores do Firebase. Rode com `npm run emulators:seed`
 * enquanto `npm run emulators` estiver aberto. Cada conta dispara a função de
 * cadastro, que cria o perfil com o @ em alguns segundos.
 *
 * Só funciona contra o emulador local (127.0.0.1:9099): estas senhas não servem
 * para o projeto de verdade. Os dados somem quando os emuladores fecham, então
 * rode de novo a cada sessão.
 */
const AUTH_EMULATOR = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

const FANS = [
  { email: 'camila@teste.imagineup', password: 'fa-de-teste-1', displayName: 'Camila Ribeiro' },
  { email: 'alan@teste.imagineup', password: 'fa-de-teste-2', displayName: 'Alan Ferreira' },
];

for (const fan of FANS) {
  const response = await fetch(`${AUTH_EMULATOR}/accounts:signUp?key=emulador`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...fan, returnSecureToken: true }),
  });
  const body = await response.json();
  if (response.ok) {
    console.log(`Conta criada: ${fan.email} (${fan.displayName}).`);
  } else if (body.error?.message === 'EMAIL_EXISTS') {
    console.log(`Já existe: ${fan.email}.`);
  } else {
    throw new Error(`Não criou ${fan.email}: ${body.error?.message ?? response.status}`);
  }
}
