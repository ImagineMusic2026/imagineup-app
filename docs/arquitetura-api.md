# Arquitetura da API do app

Nota de arquitetura do servidor do ImagineUP. Ela diz como o app fala com as Cloud Functions, onde moram os pontos, como o ponto é lançado e como o painel lê os números. Vale para o bloco 1 (base do servidor e núcleo de pontos) e deixa a estrutura pronta para os blocos seguintes. O bloco 4 (centrais de verdade) está na seção 19.

Origem: decisão do dono em 05/10/2026 (API HTTP numa função `onRequest`, pontos calculados na transação da ação) e o levantamento de 05/10/2026 (13 blocos, 26 endpoints, perguntas técnicas em aberto).

Quem mexe no servidor lê esta nota antes. Mudou uma decisão daqui? Mude a nota no mesmo commit.

## Decisões em uma página

1. Uma função HTTP `api` (`onRequest`, 2ª geração, `southamerica-east1`) com roteador próprio, sem Express e sem dependência nova. O app continua com o axios de `src/services/api`, o `toApiError` e os endpoints que os `api.ts` já chamam.
2. Toda rota exige o ID token do Firebase no `Authorization`. Toda rota que grava exige `Idempotency-Key`, guardada no servidor por 30 dias, na mesma transação do efeito, e lê o perfil do fã nessa transação: conta sem `users/{uid}` não grava nada, com ou sem ponto. A visita ao link de convite, que vem do site sem conta, não passa por esta função (bloco 5).
3. Erro sempre como `{ code, message, details? }`, com o status HTTP que o `toApiError` já entende.
4. O app lê direto do Firestore só o próprio perfil (`users/{uid}`). Todo o resto passa pela API. As coleções novas ficam fechadas para o fã, e só o servidor grava.
5. Carteira em `wallets/{uid}`, separada do perfil, com os três contadores. Extrato em `wallets/{uid}/ledger`. Pontos por central em `wallets/{uid}/centralPoints/{artistId}`.
6. O ponto é lançado pelo `award`, na mesma transação da ação. O id do lançamento é o evento que ele paga (`like:<postId>`), não a chave do pedido: o mesmo evento nunca paga duas vezes.
7. Antifraude por enquanto: limites diários por origem do ponto, no servidor. Sem App Check.
8. Contadores agregados do painel por dia (pontos por origem e por artista, fãs ativos e coortes), em 64 shards por dia, gravados na mesma transação da ação e só quando algo mudou. O painel lê esses documentos direto do Firestore, com regras por seção e sem escuta em tempo real.
9. Valores, limites e régua de níveis em `config/points`; temporada em `config/season`. Os dois são versionados e têm padrão no código. Os valores vêm de um cache de 60 s; a temporada do lançamento é lida dentro da transação. Mudança de valor não é retroativa.
10. Excluir a conta apaga carteira, extrato, pontos por central e chaves de idempotência. Os agregados não descontam.
11. No app, o `dataSource` global vira um seletor por domínio. No bloco 1, só a carteira (com o progresso) vai para a API, e só em desenvolvimento com os emuladores: `EXPO_PUBLIC_API_URL` entra nas builds da cliente depois que as ações que rendem e gastam pontos estiverem na API. Com a carteira na API, ação de fixture não rende ponto.
12. Um projeto Firebase só (`imagine-up-app`), mais os emuladores. O ambiente de testes espera o ok da cliente (UP-15).
13. Bloco 4 (seção 19): vínculo em `users/{uid}/centrals/{artistId}`; `fanCount` somado num shard na transação e copiado para `artists/{id}` por uma fila de tarefas, no máximo uma vez a cada 10 s por central; vínculo novo paga `central_join` uma vez na vida, também na 1l; sair não tira ponto; posição do fã por central só no bloco 8.

## 1. Formato da API

### Endereço e opções da função

- Função `api`, exportada em `functions/src/index.ts`, depois do `setGlobalOptions` (região `southamerica-east1`, `maxInstances: 10`).
- Produção: `https://southamerica-east1-imagine-up-app.cloudfunctions.net/api`. Esse valor só entra em `EXPO_PUBLIC_API_URL` (variáveis da EAS) depois do deploy, com o ok do dono. Hoje a variável fica vazia.
- Emuladores: `http://<EXPO_PUBLIC_FIREBASE_EMULATOR_HOST>:5001/demo-imagine-up-app/southamerica-east1/api`. O app monta essa URL sozinho (seção 13). O alcance é o mesmo dos outros emuladores: `10.0.2.2` no emulador Android; aparelho na rede local precisaria dos emuladores ouvindo fora do 127.0.0.1, o que hoje nenhum faz.
- Opções: `invoker: 'public'` (quem protege é o ID token), `cors: false` (app nativo não faz preflight; o painel não usa esta API, usa callables; a visita ao link de convite, que vem do site, vai para outra função no bloco 5), `timeoutSeconds: 30`, `memory: '512MiB'`, `cpu: 1`, `concurrency: 80`. Confira na doc do firebase-functions 7 os padrões de cpu e concorrência antes de fixar: concorrência acima de 1 pede cpu 1.
- `minInstances` fica 0. Ligar 1 no lançamento é decisão de custo, para cortar a partida a frio (1 a 3 s; o axios espera 15 s).
- Sem prefixo de versão. App instalado não pode quebrar: campo novo na resposta é sempre opcional para o app, e rota que muda de formato ganha endereço novo.

### Pedido

- Métodos `GET`, `POST`, `PUT` e `DELETE`. Outro método numa rota que existe responde 405.
- Corpo em JSON (`Content-Type: application/json`), até 16 KiB (medido em `req.rawBody`). Acima disso, 413.
- Parâmetros de busca: `cursor`, `limit` e `artistId`. O axios já omite parâmetro `null`.
- Cabeçalhos lidos: `Authorization: Bearer <ID token>` e `Idempotency-Key`. O `Accept-Language` é ignorado; as mensagens saem em pt-BR.
- Id na rota (`/posts/:postId`) passa por `decodeURIComponent` e pelo validador da rota. Barra codificada (`%2F`) dentro de um id é 400.
- Corpo malformado pode ser recusado pelo próprio framework das funções antes do roteador, fora do formato de erro. O app sempre manda JSON válido, então isso não é tratado.

### Resposta

- Sucesso: 200 com o objeto do contrato, sem envelope. O `api.get<Wallet>('/me/wallet')` do app lê `data` direto.
- Lista paginada: `{ items, nextCursor }`, o `Page<T>` do app, com `nextCursor: null` na última página. A agenda acrescenta `featured`. O cursor é texto opaco para o app.
- Datas em ISO 8601 UTC (`toISOString()`). Pontos são inteiros. Ausente é `null`, nunca `undefined`.
- Cabeçalhos: `Content-Type: application/json; charset=utf-8` e `Cache-Control: no-store`. A resposta repetida pela idempotência leva `Idempotency-Replayed: true`.
- Os tipos das respostas ficam em `functions/src/api/contract.ts`, espelho dos `types.ts` do app (`src/domains/*/types.ts`). Mudou um, mude o outro.

### Roteador

Arquivos em `functions/src/api/`:

| Arquivo          | O que faz                                                                               |
| ---------------- | --------------------------------------------------------------------------------------- |
| `index.ts`       | `createApiHandler(deps, routes?)`: o handler que o `onRequest` recebe, e `API_ROUTES`   |
| `types.ts`       | `ApiRequest`, `ApiResponse`, `ApiDeps` e os tipos das rotas (`ReadRoute`, `WriteRoute`) |
| `router.ts`      | tabela de rotas e `matchRoute` (puro, com teste)                                        |
| `errors.ts`      | códigos, status e mensagens; `ApiHttpError` e `apiError(code, details?)`                |
| `auth.ts`        | lê o `Bearer` e verifica o token                                                        |
| `idempotency.ts` | `parseIdempotencyKey`, `idempotencyDocId`, `requestFingerprint`, `runIdempotent`        |
| `contract.ts`    | tipos das respostas, espelho do app                                                     |
| `routes/me.ts`   | `/me/wallet`, `/me/progress` e `/me/ledger`                                             |

A rota é `{ method, pattern, writes, handler }`, com `:param` no padrão (`/posts/:postId/like`). `matchRoute(routes, method, path)` devolve a rota e os parâmetros, ou `not_found`, ou `method_not_allowed`. O caminho é o `req.path`, que chega sem o nome da função em produção e no emulador; um teste de ponta a ponta no emulador trava isso. A barra do fim sai antes de casar. `/` sozinho é 404.

O handler recebe interfaces mínimas, para os testes usarem objetos falsos e o código não depender dos tipos do Express:

```ts
interface ApiRequest {
  method: string;
  path: string;
  get(name: string): string | undefined;
  query: Record<string, unknown>;
  body: unknown;
  rawBody?: Buffer;
}
interface ApiResponse {
  status(code: number): ApiResponse;
  set(field: string, value: string): ApiResponse;
  json(body: unknown): void;
}
type ApiDeps = {
  db: Firestore;
  auth: Pick<Auth, 'verifyIdToken'>;
  now?: () => number; // relógio em ms; os testes fixam
  random?: () => number; // sorteio do shard, a cada tentativa da transação; os testes fixam
  config?: ConfigSource; // valores e régua com cache (seção 9); a temporada do lançamento vem da transação
};
```

Fluxo de um pedido:

1. Casa a rota (404 ou 405).
2. Confere o tamanho do corpo (413).
3. Lê e verifica o ID token (401).
4. Nas rotas que gravam, lê e valida a `Idempotency-Key` (400).
5. Valida parâmetros e corpo com o validador da rota (400).
6. Roda o handler. Rota que grava roda dentro de `runIdempotent`, que lê a chave e o fã (`requireFan`) antes dele.
7. Responde e registra uma linha: `logger.info('api', { method, route, status, ms, uid, replayed })`.

`ApiHttpError` vira a resposta do código dele. Qualquer outro erro vira 500 `internal`, com `logger.error` (rota, uid e mensagem do erro; nunca o token, o corpo nem texto de comentário).

### Autenticação

- `Authorization: Bearer <ID token>` em toda rota da `api`, sem exceção. Sem token, token malformado, vencido ou de outro projeto: 401 `unauthenticated`. O interceptor do app renova o token uma vez no 401 e repete; por isso token vencido é sempre 401, nunca 403.
- Falha do servidor ao conferir o token não é 401: 503 `unavailable` com `Retry-After: 1`, que o app tenta de novo. O firebase-admin 14 devolve a falha ao buscar as chaves públicas do Google com o mesmo `auth/argument-error` do token inválido, e só a mensagem separa as duas (`Error fetching public keys...` na resposta do Google, `Error while making request...` na rede); `auth/internal-error` também é 503. Como 401, o app renovaria o token, receberia 401 de novo, mandaria o fã entrar na conta e a mutação da fila offline falharia de vez.
- A visita ao link de convite (bloco 5) vem do site, de quem ainda não tem conta nem token, e pede CORS. Ela não entra na `api`: vai para uma função própria, com CORS só para a origem do site e antiabuso próprio. Assim a `api` continua sem rota aberta e com `cors: false`.
- `verifyIdToken(token)` sem `checkRevoked`: conferir revogação gasta uma chamada ao Auth por pedido. A conta excluída perde o direito de gravar por outro caminho: toda rota que grava lê `users/{uid}` na transação, logo depois da chave (`requireFan`, em Idempotência), e a exclusão apaga esse documento antes da carteira.
- Leitura (`GET`) não exige o perfil: carteira que não existe responde zerada, e nada é criado.
- Gravação exige o perfil, em toda rota que grava, rendendo ponto ou não (descurtir, desfazer o "Eu vou", seguir centrais, entrar numa central depois do limite). Sem `users/{uid}`: 403 `not_fan` quando existe `staff/{uid}` sem `accountCreatedByInvite: false` (conta só da equipe), e 503 `profile_not_ready` no resto (perfil que ainda não nasceu no cadastro, ou conta que acabou de ser excluída). O 503 é `isRetryable` no app. Sem essa conferência nas rotas que não lançam ponto, uma conta excluída com o token ainda válido gravaria, por exemplo, o vínculo com uma central depois do `recursiveDelete`, e sobrariam a subcoleção órfã e um `fanCount` somado que a exclusão nunca desconta.
- Conta desativada no Auth não é conferida no bloco 1. O bloqueio de fã da moderação (bloco 6) vai ser uma marca no servidor, lida na gravação.

### Idempotência

Toda rota que grava exige `Idempotency-Key` no formato `^[A-Za-z0-9._:-]{8,200}$`. Ele cobre o `createIdempotencyKey()` do app e a chave do convite, que leva a data ISO. Sem a chave, ou fora do formato: 400 `idempotency_key_required`.

A chave vale por fã. O documento é `idempotency/{id}`, com `id = sha256(uid + "\n" + chave)` em hexadecimal: a mesma chave de dois fãs são pedidos diferentes, e um fã nunca recebe a resposta guardada de outro.

```
idempotency/{id} {
  uid: string
  route: string          // "PUT /posts/:postId/like"
  fingerprint: string    // sha256 de método, caminho e corpo (JSON com chaves ordenadas)
  status: number         // 200
  body: map              // a resposta que o app recebeu, já como JSON (storedBody)
  createdAt: Timestamp
  expiresAt: Timestamp   // createdAt + 30 dias, com política de TTL
}
```

`runIdempotent(deps, ctx, work)`:

1. Abre `db.runTransaction` (até 5 tentativas). O shard dos agregados (seção 7) é sorteado dentro da função da transação, de novo a cada tentativa.
2. Primeira leitura, num `tx.getAll` só: `idempotency/{id}`, `users/{uid}` e `wallets/{uid}`.
3. A chave existe com a mesma `fingerprint`: devolve o `status` e o `body` guardados, com `Idempotency-Replayed: true`, sem efeito nenhum.
4. Existe com outra `fingerprint`: 422 `idempotency_key_reused`.
5. Não existe: `requireFan`. Sem `users/{uid}`, lê `staff/{uid}` e recusa com `not_fan` ou `profile_not_ready` (Autenticação). Com ele, monta o retrato do fã (`FanContext`: uid, `createdAt` do perfil, estado da carteira e as marcas de atividade do dia, seção 7), que o handler e o `planAwards` usam sem ler de novo.
6. Roda `work(tx, fan)`. Ele faz as leituras do domínio, o `planAwards` (seção 5) e as gravações do domínio, e devolve `{ status, body, plan? }`.
7. Confere que o plano partiu do retrato deste pedido (`plan.caller === fan`, seção 5): plano montado sem o `fan` leria a carteira de novo, sem as marcas de atividade, e a atividade de quem chama sumiria sem aviso. Fora disso é erro de programação (500). Depois grava o que mudou para os fãs (`applyAwards`: carteiras, extrato, pontos por central e um shard dos agregados, cada um só se mudou) e `idempotency/{id}` com `tx.create`, na mesma transação. Ou o efeito e a chave entram juntos, ou nada entra.
8. Duas chegadas da mesma chave ao mesmo tempo: a transação de uma delas repete, encontra a chave e devolve a resposta guardada. A disputa costuma voltar como `ABORTED`, que o SDK repete. Mas o `runTransaction` do Admin SDK (`@google-cloud/firestore` 9, `isRetryableTransactionError`) não repete o código 6 (`ALREADY_EXISTS`), que o `tx.create` da chave ou de um lançamento pode dar, e o emulador pode se comportar diferente da produção. Por isso o `runIdempotent` captura o código 6 em volta do `runTransaction` e roda tudo de novo uma vez: a segunda rodada acha a chave (resposta guardada) ou o lançamento (`duplicate`). Sem isso, o fã receberia 500 em vez da resposta guardada.

A resposta guardada é o JSON que o app recebe (`storedBody`: `JSON.parse(JSON.stringify(body))`), e a primeira resposta sai desse mesmo valor. Campo `undefined` some (o Firestore recusa `undefined`, e a transação cairia com 500 a cada tentativa, que o app repete sem fim) e data vira texto ISO (guardada como `Date`, voltaria como `Timestamp` na repetição). Lista dentro de lista o Firestore não guarda: resposta de rota que grava não usa.

Só sucesso fica guardado. Recusa (409, 400) desfaz a transação e não grava a chave; repetir a mesma chave avalia de novo, o que é seguro porque nada foi aplicado. É o que o app já faz: a mesma chave depois de falha incerta, chave nova depois de recusa definitiva.

Transação que desiste por disputa depois das 5 tentativas responde 503 `unavailable`, com `Retry-After: 1`.

Por que 30 dias: cobre a fila offline do app (o cache persistido vale 3 dias, e a mutação de comentário fica com `gcTime: Infinity`). O TTL do Firestore apaga entre 1 e 3 dias depois do `expiresAt`. O emulador não roda TTL.

Idempotência do pedido não é a do negócio. A chave impede que o mesmo pedido conte duas vezes. Quem impede que o mesmo evento pague duas vezes (curtir, descurtir e curtir de novo, com chaves diferentes) é o id do lançamento (seção 5).

### Erros

Corpo de erro, sempre:

```json
{
  "code": "insufficient_points",
  "message": "Saldo insuficiente.",
  "details": { "balance": 120, "cost": 300 }
}
```

`details` é opcional. O `toApiError` do app lê `code` e `message`, e o `kind` sai do status. A mensagem é curta, em pt-BR, e pode aparecer como está; quando o app conhece o código, ele mostra o texto dele (`t()`).

| code                       | status | kind no app  | quando                                                          |
| -------------------------- | ------ | ------------ | --------------------------------------------------------------- |
| `invalid_request`          | 400    | validation   | parâmetro, corpo ou cursor fora do formato                      |
| `idempotency_key_required` | 400    | validation   | rota que grava sem `Idempotency-Key`, ou fora do formato        |
| `unauthenticated`          | 401    | unauthorized | sem token, token inválido, vencido ou de outro projeto          |
| `not_fan`                  | 403    | forbidden    | conta só da equipe tentando gravar                              |
| `not_found`                | 404    | notFound     | rota que não existe                                             |
| `artist_not_found`         | 404    | notFound     | central inexistente, fora do ar ou id fora do formato (bloco 4) |
| `method_not_allowed`       | 405    | unknown      | rota existe, método não                                         |
| `insufficient_points`      | 409    | validation   | débito maior que o saldo (já em `API_ERROR_CODES`)              |
| `payload_too_large`        | 413    | unknown      | corpo acima de 16 KiB                                           |
| `idempotency_key_reused`   | 422    | validation   | mesma chave com outro pedido                                    |
| `too_many_requests`        | 429    | unknown      | entrada em central acima do teto do dia (bloco 4, 19.5)         |
| `internal`                 | 500    | server       | erro inesperado                                                 |
| `profile_not_ready`        | 503    | server       | gravação sem `users/{uid}` (perfil nascendo ou conta excluída)  |
| `unavailable`              | 503    | server       | disputa, Firestore fora ou falha ao conferir o token            |

Mensagens: `invalid_request` "Pedido inválido."; `idempotency_key_required` "Falta a chave de idempotência."; `unauthenticated` "Entre na sua conta para continuar."; `not_fan` "Esta conta não é de fã."; `not_found` "Não encontrado."; `artist_not_found` "Central não encontrada."; `method_not_allowed` "Método não aceito nesta rota."; `insufficient_points` "Saldo insuficiente."; `payload_too_large` "Pedido grande demais."; `idempotency_key_reused` "Esta chave já foi usada em outro pedido."; `too_many_requests` "Tentativas demais por hoje. Tente amanhã."; `internal` "Algo deu errado. Tente de novo."; `profile_not_ready` "Seu perfil ainda está sendo criado. Tente de novo em instantes."; `unavailable` "Serviço ocupado. Tente de novo."

Códigos que os próximos blocos vão criar entram nesta tabela quando nascerem: `post_not_found`, `event_not_found` e `reward_not_found` (404), `comment_invalid` (400) e `sold_out` (409, que também entra no `API_ERROR_CODES` do app no bloco 10). Não há limite de pedidos por minuto no bloco 1: o `maxInstances` segura o custo, e os limites de pontos não são erro (seção 5). A exceção, do bloco 4, é o teto diário de entradas em centrais (19.5), com 429 e `Retry-After`: sem ele, um script que entra e sai sem parar gravaria sem teto e inflaria os fluxos do painel.

## 2. Mapa dos 26 endpoints

Os 26 endpoints que os `api.ts` do app já chamam. Curtir e "Eu vou" contam como um endpoint cada, com `PUT` para fazer e `DELETE` para desfazer.

| #   | Método e caminho                         | Função do app                                       | Bloco |
| --- | ---------------------------------------- | --------------------------------------------------- | ----- |
| 1   | `GET /me/wallet`                         | `profile/api.ts` `fetchWallet`                      | 1     |
| 2   | `GET /me/progress`                       | `profile/api.ts` `fetchMyProgress`                  | 1     |
| 3   | `GET /artists`                           | `artists/api.ts` `fetchArtists`                     | 4     |
| 4   | `GET /artists/:artistId`                 | `artists/api.ts` `fetchArtist`                      | 4     |
| 5   | `POST /me/artists`                       | `artists/api.ts` `followArtists`                    | 4     |
| 6   | `GET /me/centrals`                       | `artists/api.ts` `fetchFanCentrals`                 | 4     |
| 7   | `PUT /me/centrals/:artistId`             | `artists/api.ts` `joinCentral`                      | 4     |
| 8   | `GET /me/invite`                         | `profile/api.ts` `fetchMyInvite`                    | 5     |
| 9   | `POST /invites/claim`                    | `auth/api.ts` `claimPendingInvite`                  | 5     |
| 10  | `GET /feed`                              | `posts/api.ts` `fetchFeed`                          | 6     |
| 11  | `GET /artists/:artistId/posts`           | `posts/api.ts` `fetchArtistPosts`                   | 6     |
| 12  | `GET /posts/:postId`                     | `posts/api.ts` `fetchPost`                          | 6     |
| 13  | `GET /posts/:postId/comments`            | `posts/api.ts` `fetchComments`                      | 6     |
| 14  | `POST /posts/:postId/comments`           | `posts/api.ts` `addComment`                         | 6     |
| 15  | `PUT` e `DELETE /posts/:postId/like`     | `posts/api.ts` `setPostLike`                        | 6     |
| 16  | `GET /agenda` (com `artistId` opcional)  | `agenda/api.ts` `fetchAgenda` e `fetchArtistAgenda` | 6     |
| 17  | `GET /me/rsvps`                          | `agenda/api.ts` `fetchMyRsvps`                      | 6     |
| 18  | `PUT` e `DELETE /events/:eventId/rsvp`   | `agenda/api.ts` `setEventRsvp`                      | 6     |
| 19  | `GET /missions`                          | `missions/api.ts` `fetchMissions`                   | 7     |
| 20  | `GET /missions/daily`                    | `missions/api.ts` `fetchDailyMission`               | 7     |
| 21  | `GET /me/achievements`                   | `profile/api.ts` `fetchMyAchievements`              | 7     |
| 22  | `GET /ranking/season`                    | `ranking/api.ts` `fetchSeason`                      | 8     |
| 23  | `GET /ranking` (com `artistId` opcional) | `ranking/api.ts` `fetchLeaderboard`                 | 8     |
| 24  | `GET /me/rank` (com `artistId` opcional) | `ranking/api.ts` `fetchMyRank`                      | 8     |
| 25  | `GET /rewards`                           | `rewards/api.ts` `fetchRewards`                     | 10    |
| 26  | `POST /rewards/:rewardId/redeem`         | `rewards/api.ts` `redeemReward`                     | 10    |

Fora dos 26, nova no bloco 1: `GET /me/ledger` (extrato). O app ainda não chama: a tela do extrato é do bloco 7 e precisa de desenho. Ela já serve aos testes, que conferem que carteira e extrato fecham, e ao seed.

Fora dos 26, nova no bloco 4: `DELETE /me/centrals/:artistId` (sair da central, `artists/api.ts` `leaveCentral`, seção 19).

O `POST /invites/claim` é endereço provisório (comentário em `auth/api.ts`). O bloco 5 decide o final; se mudar, mudam o `auth/api.ts`, esta tabela e o teste do domínio.

A chave do claim (`invite-<código>-<receivedAt>`) só cabe no formato da `Idempotency-Key` quando o código é válido. Hoje a rota `/convite/[codigo]` guarda o parâmetro sem conferir (`invite-capture.tsx` chama `savePendingInvite` com o que veio); só o `+native-intent` confere o `CODE` de `invites/deep-link.ts`. Um código com caractere fora do formato gera uma chave recusada (400, que o app não repete), e o `claimPendingInvite` só esquece o código depois de sucesso: ele fica preso no aparelho. O bloco 5 confere o código com o mesmo `CODE` antes de guardar, e o app esquece o código quando o servidor recusar de vez (`invalid_request` ou convite que não existe).

## 3. O que o app lê direto e o que passa pela API

| Dado                                                                                                    | Caminho                                                                                    | Por quê                                                                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Perfil do fã (`users/{uid}`)                                                                            | Firestore direto: `getDoc`, `onSnapshot` e a edição de nome e cidade                       | já está assim, com regras testadas; a escuta mostra o perfil que nasce no cadastro e a foto que o servidor grava |
| Carteira, progresso e extrato                                                                           | API                                                                                        | bloco 1                                                                                                          |
| Centrais, posts, comentários, curtidas, agenda, presenças, missões, conquistas, ranking, loja e convite | API                                                                                        | blocos 4 a 10                                                                                                    |
| Valores de pontos, limites, régua e temporada                                                           | API, embutidos nas respostas (`sharePointsPerVisit`, `pointsPerSignup`, `level`, `Season`) | o app nunca lê `config/`                                                                                         |

Isso resolve a divergência do levantamento: o vault falava em ler as centrais direto do Firestore, e o `artists/api.ts` chama `GET /artists`. Vale a API. A regra que deixa o fã ler a central publicada em `artists/{id}` fica como está, sem uso pelo app: tirar mudaria a lógica de uma regra existente, o que o bloco 1 não faz.

Por que a API para o resto: um caminho só no app (axios, React Query e cache no disco, venha o dado de onde vier); o servidor monta o que o Firestore não tem (`isMember`, `fanRank`, `centralPoints`, `likedByMe`); o formato guardado muda sem build nova; as regras ficam simples (fechado para o fã); e quem controla o custo de leitura é o servidor (paginação e limite). O preço: sem tempo real nesses dados (o app já trabalha com busca e invalidação) e a partida a frio da função.

## 4. Modelo de dados

### Coleções novas

| Caminho                                                 | Quem grava                                      | Quem lê pelo cliente              | Para quê                                                                    |
| ------------------------------------------------------- | ----------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| `wallets/{uid}`                                         | servidor (`award` e a marca de atividade)       | equipe com a seção `fans`         | os três contadores, totais, últimos 7 dias, temporadas passadas e atividade |
| `wallets/{uid}/ledger/{entryId}`                        | servidor (`award`)                              | equipe com `fans`                 | extrato                                                                     |
| `wallets/{uid}/centralPoints/{artistId}`                | servidor (`award`)                              | equipe com `fans`                 | pontos do fã em cada central                                                |
| `config/points` e `config/points/versions/{n}`          | servidor (callable do painel, bloco seguinte)   | equipe ativa                      | valores, limites diários e régua de níveis                                  |
| `config/season` e `config/season/versions/{n}`          | servidor (callable do painel, bloco 8)          | equipe ativa                      | temporada atual                                                             |
| `statsDaily/{dia}` e `statsDaily/{dia}/statsShards/{n}` | servidor (`award`; fechamento do dia depois)    | equipe com `overview` ou `growth` | contadores agregados do painel                                              |
| `statsMeta/close`                                       | servidor (fechamento do dia, quando ele entrar) | ninguém                           | último dia fechado                                                          |
| `idempotency/{id}`                                      | servidor (API)                                  | ninguém                           | chaves de idempotência                                                      |
| `users/{uid}/centrals/{artistId}`                       | servidor (API, bloco 4)                         | equipe com `fans`                 | vínculo do fã com a central (seção 19)                                      |
| `artistStats/{artistId}/fanShards/{n}`                  | servidor (API e exclusão de conta, bloco 4)     | equipe com `artists`              | `fanCount` em shards, copiado para `artists/{id}` (seção 19)                |

O fã não lê nenhuma delas direto, nem a própria carteira: tudo chega pela API.

### Por que a carteira não fica no perfil

- O app escuta `users/{uid}` com `onSnapshot`. Ponto no perfil faria cada curtida disparar a escuta e redesenhar o perfil.
- O perfil é editável pelo fã, com a trava de 10 s no `updatedAt`. Separado, nada do ponto encosta nessa regra.
- A equipe lê a carteira com regra própria (`fans`) sem abrir o perfil.
- O formato da carteira pode mudar sem tocar no documento que o app lê direto.
- O preço: um documento a mais para apagar na exclusão de conta.

### `wallets/{uid}`

```
wallets/{uid} {
  uid: string
  balance: number          // saldo para resgatar; nunca negativo
  xp: number               // XP de nível; só sobe (só um ajuste da equipe desce)
  seasonId: string | null  // temporada a que seasonPoints se refere
  seasonPoints: number     // pontos dessa temporada
  seasonPointsAt: Timestamp | null  // quando seasonPoints subiu pela última vez (desempate do ranking)
  earnedTotal: number      // soma de todos os ganhos
  spentTotal: number       // soma de todos os resgates
  days: {                  // dias de São Paulo de 6 dias antes do pedido em diante; os anteriores saem
    "2026-10-05": { earned: number, count: { comment: 3, mission: 1, central_entry: 2 } }
  }                        // count: eventos pagos por origem e, sem ponto, as entradas em centrais (19.5)
  stats: {
    pastSeasons: number    // temporadas passadas em que o fã pontuou
  }
  activity: {              // última atividade do fã (seção 7), para contar ativos sem repetir
    lastDay: string | null     // "2026-10-05"
    lastWeek: string | null    // "2026-W41", semana ISO em São Paulo
    lastMonth: string | null   // "2026-10"
  }
  schemaVersion: 1
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

Gravação: só quando algo mudou, isto é, algum lançamento foi aplicado, o fã ganhou uma marca de atividade nova (seção 5, passo 9) ou, desde o bloco 4, uma entrada em central somou o `central_entry` do dia (19.5). `tx.create` na primeira gravação; depois, `tx.update` só com os campos que o servidor cuida (`balance`, `xp`, `seasonId`, `seasonPoints`, `seasonPointsAt`, `earnedTotal`, `spentTotal`, `days`, `stats.pastSeasons`, `activity`, `updatedAt`). O `update` com `days` troca o mapa inteiro, e é assim que os dias velhos saem. Nunca `set` com `merge` no `days`: o merge junta os mapas e os dias velhos ficam. Toda gravação na carteira passa por transação que lê a carteira.

Os números do convite (links criados e pessoas trazidas) não moram na carteira: um link que viraliza faria dela um documento disputado, e a disputa derrubaria o cadastro de quem foi convidado. O bloco 5 os guarda sem documento disputado (seção 18), e o `/me/progress` lê os dois lugares.

### `wallets/{uid}/ledger/{entryId}`

O id é `<source>:<eventId>`: o evento que o lançamento paga (seção 5). `eventId` segue `^[A-Za-z0-9_.:-]{1,200}$`.

```
ledger/{entryId} {
  uid: string
  kind: 'earn' | 'spend' | 'adjust'
  source: string           // origem do ponto (tabela da seção 5)
  eventId: string
  points: number           // quanto o saldo mexeu: positivo no ganho, negativo no resgate, o delta no ajuste
  xpDelta: number
  seasonDelta: number      // 0 fora de temporada
  artistId: string | null  // central da ação
  centralSeasonDelta: number  // quanto entrou nos pontos da temporada da central (0 fora de temporada)
  centralTotalDelta: number   // quanto entrou no total de sempre da central
  seasonId: string | null
  subject: { type: 'post' | 'comment' | 'event' | 'artist' | 'mission' | 'reward' | 'invite', id: string } | null
  balanceAfter: number
  xpAfter: number
  seasonPointsAfter: number
  configVersion: number    // versão de config/points usada (0 é o padrão do código)
  actor: { type: 'fan' | 'system' | 'staff', uid: string | null, name: string | null }
  note: string | null      // motivo do ajuste da equipe; nunca dado pessoal
  day: string              // "2026-10-05", dia de São Paulo
  createdAt: Timestamp     // o "agora" do pedido, não serverTimestamp
}
```

Só movimento de verdade vira lançamento. Ação que rendeu zero (valor zero, limite do dia, evento já pago) não grava nada aqui. Com os dois deltas da central, a soma do extrato fecha com o `seasonPoints` e com o `totalPoints` de cada `centralPoints`, também para ganho fora de temporada (que entra só no total).

### `wallets/{uid}/centralPoints/{artistId}`

```
centralPoints/{artistId} {
  uid: string
  artistId: string
  seasonId: string | null
  seasonPoints: number         // o FanCentral.seasonPoints e o ranking da central
  seasonPointsAt: Timestamp | null
  totalPoints: number          // tudo o que o fã já ganhou nesta central
  updatedAt: Timestamp
}
```

O vínculo do fã com a central (seguir, `isMember`, `fanCount`) não mora aqui: é do bloco 4 (seção 19). Sair da central não mexe nestes pontos.

### `config/points`, `config/season` e as versões

```
config/points {
  version: number                // 1, 2, 3...; o padrão do código é a versão 0
  values: { like, comment, rsvp, central_join, invite_visit, invite_signup }   // pontos por evento
  dailyLimits: { <source>: number | null }   // eventos pagos por dia; null é sem limite
  levels: [{ number, name, minXp }]
  updatedAt: Timestamp
  updatedBy: { uid: string, name: string } | null
}
config/points/versions/{version}   // cópia imutável de cada versão, gravada junto

config/season {
  version: number
  season: {
    id: string                   // ^[a-z0-9-]{3,40}$
    name: string                 // "São João"
    startsAt: Timestamp
    endsAt: Timestamp
    leaderTitle: string | null
  } | null
  updatedAt: Timestamp
  updatedBy: { uid: string, name: string } | null
}
config/season/versions/{version}
```

Padrão do código (`DEFAULT_POINTS_CONFIG` em `functions/src/points/config.ts`), usado quando `config/points` não existe:

```json
{
  "version": 0,
  "values": {
    "like": 0,
    "comment": 2,
    "rsvp": 0,
    "central_join": 10,
    "invite_visit": 2,
    "invite_signup": 10
  },
  "dailyLimits": {
    "like": 50,
    "comment": 20,
    "rsvp": 10,
    "central_join": 10,
    "invite_visit": 50,
    "invite_signup": 20,
    "mission": null
  },
  "levels": [
    { "number": 1, "name": "Primeiro passo", "minXp": 0 },
    { "number": 2, "name": "Na roda", "minXp": 600 },
    { "number": 3, "name": "Pé de serra", "minXp": 1500 },
    { "number": 4, "name": "Arrastapé", "minXp": 2800 },
    { "number": 5, "name": "Sanfona", "minXp": 4200 },
    { "number": 6, "name": "Fogueira", "minXp": 5600 },
    { "number": 7, "name": "Purainha", "minXp": 7000 },
    { "number": 8, "name": "Xodó", "minXp": 15000 },
    { "number": 9, "name": "Coração do palco", "minXp": 25000 },
    { "number": 10, "name": "Lenda", "minXp": 40000 }
  ]
}
```

A régua é a `FIXTURE_LEVELS` do app, copiada. Os valores repetem os das fixtures: comentar 2, entrar na central 10, convite 2 por visita e 10 por cadastro. Curtir e "Eu vou" valem 0, como nas fixtures, onde só andam missões. O contrato diz que toda interação vale pontos: os valores de verdade vêm da cliente (UP-9) e mudam no painel, sem código. Sem `config/season`, a temporada é `null`, e nenhum ponto entra em temporada.

### `statsDaily` e `statsMeta`

Seção 7.

### Índices, isenções e TTL (`firestore.indexes.json`)

- TTL: `fieldOverrides` com `{ "collectionGroup": "idempotency", "fieldPath": "expiresAt", "ttl": true, "indexes": [] }`. Confira na doc do firebase-tools 15 que o `ttl` no `fieldOverrides` é aceito; se não for, a política se liga no console (Firestore, TTL) e a nota registra.
- Isenção de índice (`"indexes": []`), para cada gravação custar menos: `wallets.days`, `wallets.activity`, `idempotency.body`, `statsShards.bySource`, `statsShards.byArtist` e `statsShards.cohorts`. Ninguém consulta por esses campos, e os mapas com chaves soltas gerariam uma entrada de índice por chave.
- Isenção das datas que só crescem, porque um campo indexado que sempre cresce concentra a escrita da coleção num ponto só (o Firestore aponta o problema acima de cerca de 500 gravações por segundo na coleção): `idempotency.createdAt`, `idempotency.route`, `idempotency.fingerprint` e `idempotency.status` (fica só o `uid`, que a exclusão de conta consulta), `wallets.updatedAt` e `wallets.seasonPointsAt`. O ranking (bloco 8) usa o `seasonPointsAt` num índice composto, que a isenção do índice simples não afeta.
- O extrato usa o índice automático de `createdAt`. Se o emulador ou a produção pedirem índice composto para `createdAt` com o id, ele entra no arquivo.
- Índices do ranking são do bloco 8 (seção 10).

## 5. Lançamento de pontos (award)

Arquivos em `functions/src/points/`: `model.ts` (puro, com teste em tabela), `config.ts` (padrão, validação e cache), `award.ts` (Firestore), `stats.ts` (shards dos agregados), `wallet.ts` (leitura para as rotas), `seed.ts` (a carteira da Camila no seed dos emuladores, seção 14) e `index.ts`.

O `requireFan` mora em `award.ts`, porque o `runAward` também o usa, e recusa com `PointsError` (`not_fan`, `profile_not_ready`), como o débito (`insufficient_points`); a API traduz esses três motivos para o erro combinado (`toApiHttpError`, em `api/errors.ts`), e qualquer outro motivo é 500. Assim o núcleo de pontos não depende da API.

### Origens do ponto

| source          | kind   | eventId                       | valor padrão                     | limite diário padrão |
| --------------- | ------ | ----------------------------- | -------------------------------- | -------------------- |
| `like`          | earn   | id do post                    | 0                                | 50                   |
| `comment`       | earn   | id do comentário              | 2                                | 20                   |
| `rsvp`          | earn   | id do show                    | 0                                | 10                   |
| `central_join`  | earn   | id da central                 | 10                               | 10                   |
| `mission`       | earn   | `<missionId>:<período>`       | o da missão (`points` explícito) | sem limite           |
| `invite_visit`  | earn   | id da visita (bloco 5 define) | 2                                | 50                   |
| `invite_signup` | earn   | uid de quem se cadastrou      | 10                               | 20                   |
| `redeem`        | spend  | id do resgate                 | o custo da recompensa            | não se aplica        |
| `adjustment`    | adjust | id do ajuste da equipe        | explícito por contador           | não se aplica        |
| `seed`          | adjust | nome fixo do seed             | explícito por contador           | não se aplica        |

O `eventId` decide quantas vezes um evento paga. A primeira curtida de cada post paga uma vez na vida (`like:<postId>`), mesmo depois de descurtir e curtir de novo. Cada comentário paga (`comment:<commentId>`), até o limite do dia. Entrar numa central paga uma vez (`central_join:<artistId>`), como o `followFixture.join`. Origem nova é mudança de código: entra no tipo, no padrão e nesta tabela.

### Entrada

```ts
type EarnSource = 'like' | 'comment' | 'rsvp' | 'central_join' | 'mission' | 'invite_visit' | 'invite_signup';
type Subject = { type: 'post' | 'comment' | 'event' | 'artist' | 'mission' | 'reward' | 'invite'; id: string };

type AwardEntry =
  | { kind: 'earn'; source: EarnSource; eventId: string; artistId?: string | null;
      subject?: Subject | null; points?: number /* só na mission */ }
  | { kind: 'spend'; source: 'redeem'; eventId: string; points: number;
      artistId?: string | null; subject?: Subject | null }
  | { kind: 'adjust'; source: 'adjustment' | 'seed'; eventId: string;
      balance?: number; xp?: number; season?: number;
      central?: { artistId: string; season?: number; total?: number }; note?: string | null };

type AwardContext = {
  now: number;               // o mesmo "agora" do pedido inteiro, também nas novas tentativas
  config: PointsConfig;      // valores, limites e régua, lidos fora da transação, com cache (seção 9)
  shard: number;             // de 0 até SHARD_COUNT menos 1, sorteado de novo a cada tentativa
  actor: { type: 'fan' | 'system' | 'staff'; uid: string | null; name: string | null };
};

type AwardResult = {
  uid: string; entryId: string;
  status: 'applied' | 'duplicate' | 'capped' | 'zero' | 'skipped';
  points: number;
};

type FanAwards = {
  uid: string;
  entries: AwardEntry[];
  fan?: FanContext;          // o retrato do requireFan de quem chama; sem ele, o planAwards lê o fã
};

planAwards(tx, db, fans: FanAwards[], ctx): Promise<AwardPlan>   // só lê e calcula
applyAwards(tx, db, plan): void                                  // só grava (o runIdempotent chama)
// AwardPlan traz results, pointsAwarded (de quem chama), o estado novo de cada carteira
// e caller: o FanContext que ele usou (ou null)
```

O mesmo uid duas vezes vira uma entrada só, com os lançamentos na ordem e o retrato dele (`mergeFanAwards`): dois planos do mesmo fã partiriam da mesma carteira lida, e a segunda gravação apagaria a primeira (ou o commit cairia com dois `create`). O caso real é o claim do próprio convite (bloco 5), com quem chama também no papel de quem convidou; recusar esse convite é regra do bloco 5, mas o núcleo não depende dela. Só quem chama leva o `fan`, uma vez: dois retratos, ou retrato de outro uid, é erro de programação. O `computeAwards` também recusa uid repetido.

O ajuste e o seed não passam pela API: usam `runAward(db, uid, entries, ctx)`, que abre a transação, faz o mesmo `requireFan` (sem marca de atividade), o `planAwards` e o `applyAwards`.

Validação da entrada: `eventId` no formato da seção 4; `artistId` no `HANDLE_PATTERN` de `functions/src/artists/model.ts` (o @ da central); pontos explícitos inteiros maiores que 0 (no ajuste, inteiros diferentes de 0; o `central` do ajuste pede `season`, `total` ou os dois). Entrada fora disso é erro de programação e vira 500. O `award` não lê `artists/{id}`: quem confere que a central existe é a rota do domínio, que já lê o post, o show ou a central.

O Firestore exige todas as leituras antes de qualquer gravação na transação. Por isso o `award` tem duas fases, e a rota segue esta ordem: chave e fã (`runIdempotent`), leituras do domínio, `planAwards`, gravações do domínio; depois o `runIdempotent` grava o que mudou para os fãs e a chave. Vários lançamentos do mesmo pedido (curtida que conclui missão) entram numa chamada só, em ordem: a carteira é lida uma vez e cada lançamento parte do resultado do anterior. Lançamentos para mais de um fã na mesma transação (o convidado e quem convidou, no bloco 5) também entram numa chamada só, com uma gravação de shard para todos.

### Passo a passo da transação

Leituras:

1. De quem chama, `users/{uid}` e `wallets/{uid}` já chegaram no `FanContext` (`runIdempotent`, seção 1). Carteira que faltou é estado zerado, criado na gravação.
2. Num `tx.getAll` só (`planAwards`): `config/season`, lido na transação e nunca do cache (seção 8); `wallets/{uid}/ledger/<source>:<eventId>` de cada lançamento; `wallets/{uid}/centralPoints/{artistId}` de cada central citada, uma vez por central; e, de cada outro fã que recebe lançamento (quem convidou, no bloco 5), `users/{uid}` e `wallets/{uid}`.
3. Outro fã sem `users/{uid}` (conta excluída): os lançamentos dele saem `skipped`, sem erro e sem gravação. Só quem chama é recusado sem perfil; sem essa regra, o claim de um convidado cujo convidante excluiu a conta falharia para sempre, com o código preso no aparelho.

Cálculo (`computeAwards` em `model.ts`, puro, com teste em tabela e relógio fixo):

4. `day = dayKey(now)`, o dia em `America/Sao_Paulo` (`Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })`), no formato `YYYY-MM-DD`.
5. Saem de `days` só as chaves anteriores a `day` menos 6 dias. Um dia depois de `day` fica: perto da meia-noite, um pedido com o "agora" de 23:59:59,950 (fixo nas novas tentativas) pode gravar depois de outro de 00:00:00,010, e cortar o dia seguinte zeraria o limite dele e baixaria o `weekEarned`.
6. Temporada ativa: a de `config/season` lida na transação, com `startsAt <= now < endsAt`; fora disso, nenhuma. Com temporada ativa e `wallet.seasonId` diferente do id dela, a carteira troca de temporada: se `seasonPoints > 0`, `stats.pastSeasons += 1`; depois `seasonId` vira o novo, `seasonPoints = 0` e `seasonPointsAt = null`. O mesmo vale para cada `centralPoints` lido, sem o `pastSeasons`. Sem temporada ativa, os campos de temporada ficam como estão.
7. Cada lançamento, na ordem:
   - Já existe no extrato: `duplicate`, 0 ponto, nada muda.
   - `earn`: `p = entry.points` na `mission`, `config.values[source] ?? 0` nas outras. `p <= 0`: `zero`. Se `config.dailyLimits[source]` não é `null` e `days[day].count[source]` já chegou nele: `capped`. Senão, `applied`: `balance += p`, `xp += p`, `earnedTotal += p`; com temporada ativa, `seasonPoints += p` e `seasonPointsAt = now`; com `artistId`, a central soma `totalPoints += p` (`centralTotalDelta = p`) e, com temporada, `seasonPoints += p` e `seasonPointsAt = now` (`centralSeasonDelta = p`); `days[day].earned += p` e `days[day].count[source] += 1`.
   - `spend`: `p = entry.points`, inteiro maior que 0. `balance < p` recusa a transação inteira com 409 `insufficient_points` e `details: { balance, cost }`. Senão: `balance -= p`, `spentTotal += p`. XP e temporada não mudam.
   - `adjust`: soma os deltas pedidos. `balance` e `xp` vão para a carteira; `season` vai para o `seasonPoints` da carteira e exige temporada ativa; `central.season` vai para o `seasonPoints` da central e exige temporada ativa; `central.total` vai para o `totalPoints` da central, com ou sem temporada. Ajuste que sobe um `seasonPoints` também põe o `seasonPointsAt` dele em `now` (o desempate do ranking). Nenhum contador pode ficar negativo: se ficaria, recusa. Não passa pelo limite do dia nem conta em `days`.
   - Cada aplicado guarda `balanceAfter`, `xpAfter`, `seasonPointsAfter` e os dois deltas da central.
8. Atividade (seção 7): as marcas novas do dia, da semana e do mês, que o `requireFan` calculou, entram na carteira de quem chama. Só para quem chama, e só com `actor.type: 'fan'`; ajuste e seed não marcam.

Gravações (`applyAwards`, chamado pelo `runIdempotent` depois do `work`):

9. Carteira de cada fã: só se algum lançamento dele foi aplicado ou ele ganhou marca de atividade nova; senão, nada, nem o `updatedAt`. A troca de temporada sozinha não é gravada: ela é recalculada do mesmo jeito no próximo lançamento aplicado. `tx.create` ou `tx.update` (seção 4), com `updatedAt = now`.
10. Cada lançamento aplicado: `tx.create` em `ledger/<source>:<eventId>`, com `createdAt = Timestamp.fromMillis(now)`.
11. Cada central que um lançamento aplicado mexeu: `tx.create` ou `tx.update`.
12. Um shard dos agregados, `statsDaily/{day}/statsShards/{shard}`, com `tx.set(..., { merge: true })` e `FieldValue.increment` (seção 7). Uma gravação por transação, somando os lançamentos aplicados e as marcas de atividade de todos os fãs dela, e só quando há o que somar.
13. O `pointsAwarded` do plano é a soma dos `earn` aplicados de quem chama. É o número que volta para o app (`PointsAward`, `JoinCentralResult`, `RsvpResult`).

Custo de uma ação que rende ponto numa central: 6 leituras (chave, perfil, carteira, temporada, extrato, central) e 5 gravações (carteira, extrato, central, shard, chave), mais as do domínio. Ação que não chama o `award` (descurtir, desfazer o "Eu vou"): 3 leituras (chave, perfil, carteira) e 1 gravação (a chave), mais as do domínio. Ganho que saiu `duplicate`, `zero` ou `capped` lê como o que rende e grava só a chave. Nos dois casos, a carteira e o shard são gravados só na primeira ação do dia, da semana ou do mês (atividade).

Concorrência: dois pedidos do mesmo fã disputam a carteira e um repete; nada se perde. Fã não age mais de uma vez por segundo de forma sustentada, então a carteira fica dentro do limite de escrita. Ler `config/season` em toda transação não cria disputa entre elas (leitura não trava leitura); só o callable da temporada grava nele, e raramente.

### Débito do resgate

Já existe no bloco 1, testado, sem rota (a loja é do bloco 10). A rota do resgate, dentro do `runIdempotent`, chama `planAwards` com o lançamento `{ kind: 'spend', source: 'redeem', eventId: <redemptionId>, points: <custo> }` do fã, na mesma transação que baixa o estoque e grava o resgate. Desconta só o saldo. Saldo curto recusa tudo com 409 `insufficient_points`, sem gravar nada, nem a chave de idempotência.

### Ajuste

Também sem rota no bloco 1. É o caminho do seed e, depois, do ajuste manual da equipe pela seção Fãs (callable `adjustFanPoints`, com `canEditSection('fans')`, `actor.type: 'staff'`, motivo em `note` e auditoria `wallet.adjusted`), pelo `runAward`. O ajuste de central diz o que mexe: `central: { artistId, season?, total? }`, com a temporada ativa exigida só para `season`.

### Limites diários

São a antifraude do bloco 1: contam eventos pagos por origem, por fã, por dia de São Paulo, e ficam em `config/points.dailyLimits`, ajustáveis pelo painel. Passar do limite não é erro: a ação acontece (o comentário aparece, a curtida fica), rende 0 e não grava lançamento. O evento que não pagou por causa do limite pode pagar depois, uma vez, porque não deixou lançamento. Sem App Check: o SDK JS não tem App Check nativo (decisão 2 do `CLAUDE.md`), e as alternativas tiram o iPhone do Expo Go ou pedem o app no Play Console (UP-4). Reavaliar quando a conta Apple sair. Junto com os limites, seguram a fraude: a chave de idempotência, o id do lançamento por evento, o perfil exigido em toda gravação e o `maxInstances`.

### Exemplo: curtida que conclui missão (blocos 6 e 7)

`PUT /posts/p-clipe/like` com a chave `mg8x3k2a-4f9a1b2c`. O `runIdempotent` lê a chave, o perfil e a carteira; a rota lê o post, a curtida do fã e o progresso das missões dele; chama `planAwards` com os lançamentos do fã `[{ kind: 'earn', source: 'like', eventId: 'p-clipe', artistId: 'nettobrito' }, { kind: 'earn', source: 'mission', eventId: 'curta-5-netto:2026-W41', points: 20, artistId: 'nettobrito' }]`; grava a curtida e o progresso; o `runIdempotent` grava carteira, extrato, central, shard e a chave. Responde `{ "pointsAwarded": 20 }` com a curtida valendo 0, ou `21` com a curtida valendo 1. O app já espera assim: os pontos da missão voltam no `pointsAwarded` da ação (`useToggleLikeMutation().award`).

## 6. Rotas do bloco 1

As três leem a carteira fora de transação (uma leitura) e a configuração do cache. Não criam nada.

### `GET /me/wallet`

O `Wallet` do app.

```json
{ "balance": 12480, "xp": 12480, "seasonPoints": 4120 }
```

`seasonPoints` é `wallet.seasonPoints` quando `wallet.seasonId` é o id de `config/season.season`, e 0 no resto. Temporada que já acabou e continua na configuração mostra os pontos dela, congelados, como o ranking mostra a última temporada encerrada. Carteira que não existe: tudo 0. A leitura usa a temporada do cache (seção 9): logo depois de a equipe trocar a temporada, a tela pode mostrar a anterior por até 60 s. Só a tela; o lançamento lê a temporada na transação.

### `GET /me/progress`

O `MyProgress` do app.

```json
{
  "xp": 12480,
  "level": { "number": 7, "name": "Purainha", "minXp": 7000 },
  "nextLevel": { "number": 8, "name": "Xodó", "minXp": 15000 },
  "weekEarned": 840,
  "stats": { "linksCreated": 0, "peopleBrought": 0, "seasons": 3 }
}
```

- `level` e `nextLevel`: `levelForXp(xp, config.levels)`, a mesma conta do `levelForXp` do app (o degrau mais alto com `minXp <= xp`; `nextLevel: null` no último). O nível não é guardado: sai do XP a cada leitura.
- `weekEarned`: soma de `days[d].earned` para hoje e os 6 dias anteriores, em dias de São Paulo. Resgate e ajuste não contam.
- `stats.linksCreated` e `stats.peopleBrought`: 0 no bloco 1. O bloco 5 os lê de onde guardar o convite, fora da carteira (seção 4).
- `stats.seasons`: `pastSeasons + (seasonPoints > 0 ? 1 : 0)`. Isso conta certo antes e depois da troca preguiçosa de temporada.
- Carteira que não existe: XP 0, nível 1, `nextLevel` 2, semana 0, números 0.

### `GET /me/ledger`

Extrato, do mais novo ao mais antigo. `limit` de 1 a 50 (padrão 20) e `cursor` opcional.

```json
{
  "items": [
    {
      "id": "mission:seed-camila-4",
      "kind": "earn",
      "source": "mission",
      "points": 100,
      "xpDelta": 100,
      "seasonDelta": 100,
      "artistId": "nenho",
      "centralSeasonDelta": 100,
      "centralTotalDelta": 100,
      "subject": null,
      "createdAt": "2026-10-04T15:00:00.000Z"
    }
  ],
  "nextCursor": "WzE3OTE...XQ"
}
```

Consulta: `orderBy('createdAt', 'desc')` e o id do documento, também decrescente. O cursor é o base64url de `[createdAtEmMs, entryId]`, usado no `startAfter`; o id desempata os lançamentos do mesmo milissegundo (a curtida que conclui missão grava dois). Cursor que não decodifica, com instante acima do maior `Timestamp` do Firestore (253402300799999 ms) ou com id fora do formato de lançamento (`^[a-z_]+:[A-Za-z0-9_.:-]{1,200}$`) é 400 `invalid_request`; sem essa conferência, um cursor montado à mão derrubava o `Timestamp.fromMillis` com 500. O app monta o texto de cada linha a partir de `source` e `subject` (bloco 7); o servidor não guarda frase pronta.

## 7. Contadores agregados do painel

A UP-15 pede os contadores desde o início, porque ler coleções cruas no navegador foi o que estourou a cota do Painel Imagine. O painel nunca soma extrato nem carteira: lê poucos documentos já somados.

### Formato

Um documento por dia, dividido em `SHARD_COUNT = 64` shards. Cada transação que lança pontos ou marca atividade nova sorteia um shard (de novo a cada tentativa) e grava nele uma vez. A subcoleção se chama `statsShards`, e não `shards`, para não colidir com outros contadores divididos (o `fanCount` do bloco 4, o engajamento do bloco 6), que ganham nome próprio.

```
statsDaily/{YYYY-MM-DD}/statsShards/{0..63} {
  day: string
  totals: {
    earned: number, earnedEvents: number,
    spent: number, spentEvents: number,
    adjusted: number, adjustedEvents: number    // soma do delta do saldo nos ajustes
  }
  bySource: { <source>: { points: number, events: number } }
  byArtist: {
    <artistId>: {
      earned: number, earnedEvents: number,
      spent: number, spentEvents: number,
      bySource: { <source>: { points: number, events: number } }
    }
  }
  actives: {
    day: number         // fãs com a primeira atividade do dia
    newInWeek: number   // fãs com a primeira atividade da semana ISO, contados no dia dela
    newInMonth: number  // fãs com a primeira atividade do mês, contados no dia dela
  }
  cohorts: { "<semana do cadastro>": { active: number } }   // "2026-W40": primeira atividade da semana de quem se cadastrou nela
  updatedAt: Timestamp
}

statsDaily/{YYYY-MM-DD} {    // fechamento do dia, quando existir
  day, closed: true, closedAt, shardCount,
  totals, bySource, byArtist, actives, cohorts   // a soma dos shards, na mesma forma
}

statsMeta/close { lastClosedDay: string, updatedAt: Timestamp }
```

- "Por dia" é o id do documento; "por origem" é `bySource` (a origem do ponto: curtida, comentário, missão, resgate...); "por artista" é `byArtist`, com a origem dentro.
- O dia é o de São Paulo, o mesmo do `days` da carteira e do limite diário. A semana é a ISO (`2026-W41`) e o mês é `2026-10`, contados no mesmo fuso.
- Ajuste e seed contam só em `totals.adjusted` e em `bySource`, nunca em `byArtist`.
- A origem do fã (link, campanha, UTM) não é isto: o bloco 5 acrescenta `signups` e `byOrigin` nos mesmos shards. Cadastros por dia também são do bloco 5; os anteriores saem do `createdAt` de `users/` numa carga única.
- Gravação: `tx.set(shardRef, objetoComIncrements, { merge: true })`. Chaves de mapa vão como objeto aninhado, não como caminho com ponto.
- Contador zerado não é gravado (`pruneZeros`, em `points/stats.ts`): um shard que só viu atividade não tem `totals`, e um sem resgate não tem `spent`. Quem lê (o fechamento do dia, o painel) trata campo ausente como 0.

### Fãs ativos e retenção

A Crescimento do painel promete "cadastros, ativos e retenção" (`imagineup-admin/src/lib/staff.ts`). Para isso, a atividade não depende de ponto.

- **Definição de ativo:** o fã que fez, no período, ao menos uma ação que grava pela API (curtir, descurtir, comentar, "Eu vou", seguir ou entrar numa central, missão, resgate, convite), rendendo ponto ou não. Abrir o app e só ler não conta, porque a leitura não grava nada. Se a cliente quiser contar quem só abriu o app, um bloco seguinte marca a atividade também no primeiro `GET` do dia (uma gravação por fã por dia).
- **Marca:** o `requireFan` compara o dia, a semana e o mês do pedido com `wallet.activity`. Dia novo soma `actives.day`; semana nova soma `actives.newInWeek` e `cohorts[<semana do cadastro>].active`; mês novo soma `actives.newInMonth`. A semana do cadastro sai do `createdAt` de `users/{uid}`, que o `requireFan` já leu. A carteira guarda as marcas novas. São no máximo uma gravação de carteira e uma de shard por fã por dia, além das que o ponto já faz.
- Só quem chama marca, e só com `actor.type: 'fan'`. Ajuste da equipe, seed e o crédito de quem convidou não marcam.
- **Leitura:** ativos do dia D são a soma de `actives.day` em D; da semana, a soma de `actives.newInWeek` nos dias dela; do mês, a soma de `actives.newInMonth` nos dias dele (somar os ativos de cada dia contaria o mesmo fã várias vezes). Ativos da coorte C na semana S são a soma de `cohorts[C].active` nos dias de S; a retenção divide isso pelos cadastros da semana C (bloco 5).

### Custo e limite de escrita

- Uma gravação de shard por transação que lançou ponto ou marcou atividade nova, qualquer que seja o número de lançamentos e de fãs nela. Transação sem nada aplicado e sem marca nova não grava shard (nem carteira).
- **Teto:** o Firestore aguenta perto de 1 gravação por segundo por documento de forma sustentada (rajadas curtas passam). Com 64 shards, o dia aguenta perto de 64 transações com ponto ou atividade nova por segundo no país todo, cerca de 230 mil por hora, sustentadas. Cada fã, pela carteira, já fica perto de 1 por segundo.
- **Disputa:** a disputa num shard faz a transação do fã repetir. Como o shard é sorteado de novo a cada tentativa, a repetição cai em outro documento; as 5 tentativas acabarem em shards disputados (o 503 `unavailable`) só acontece bem acima do teto. Sorteado uma vez por pedido, a repetição bateria no mesmo documento disputado.
- **Sinal para mexer:** `unavailable` ou transações repetidas nos logs da `api`. Primeiro passo: subir o `SHARD_COUNT`, porque quem lê lista a subcoleção e nunca supõe o número.
- **Saída sem disputa nenhuma, registrada e não implementada:** tirar o agregado da transação. Uma função agendada, a cada 5 a 15 min, lê os lançamentos novos do extrato (grupo de coleção `ledger` por `createdAt`, com margem para a transação que demorou até 30 s) e soma. Custa 1 leitura por lançamento, mais barato que 1 gravação, mas o painel fica 5 a 15 min atrasado, o grupo `ledger` pede índice próprio e a atividade sem ponto precisa de outro caminho. Fica para quando o teto acima não bastar.
- **Leitura do painel:** hoje são 64 documentos (os shards); um dia fechado é 1. Trinta dias custam 29 fechados mais os 64 de hoje.

### Fechamento do dia

Uma função agendada (`onSchedule`, todo dia às 00:20 de `America/Sao_Paulo`) fecha os dias em ordem, do seguinte ao `statsMeta/close.lastClosedDay` até ontem. Para cada dia: lista `statsDaily/{dia}/statsShards`, soma, grava `statsDaily/{dia}` com `closed: true` (dia sem nada fecha zerado) e avança `lastClosedDay` no mesmo lote. Não precisa de consulta em grupo de coleção nem de índice, porque o dia é o id. Sem `statsMeta/close`, começa em `STATS_FIRST_DAY` (constante no código, o dia do primeiro deploy da `api`). Uma rodada fecha no máximo 31 dias; o resto fica para a próxima.

- Fechamento que falhou não perde o dia: a próxima rodada começa nele. Até lá, o painel soma os shards do dia passado que não tem o documento fechado.
- Às 00:20 todo lançamento do dia anterior já gravou: o "agora" do pedido fica fixo, mas a função tem `timeoutSeconds: 30`.
- O dia fechado nunca muda depois, porque a exclusão de conta não desconta (seção 12).
- A função entra no primeiro bloco que precisar dela (o 4, para os pontos da central, ou o 11, no painel). Até lá, quem lê soma os shards.
- **"PTS DA CENTRAL":** o bloco 4 decidiu somar na leitura, com `sum()` no grupo `centralPoints` (seção 19, decisão 7), sem esperar o fechamento. O total em `artistStats/{artistId}`, somado pelo fechamento, fica como o passo seguinte quando o custo da soma pedir.

### Como o painel lê

Direto do Firestore, com regras: `canSeeSection('overview') || canSeeSection('growth')` lê `statsDaily/{dia}` e os shards. É o mesmo padrão da seção Artistas (leitura direta com `canSeeSection`, gravação por callable), sem partida a frio de função e com custo de poucos documentos. Os comparativos (UP-39) ficam na Crescimento; se virarem seção própria, a regra ganha a seção nova.

Regras do painel para não estourar a cota:

- Faixa de dias com `getDocs` (no máximo 90 dias por consulta).
- Nunca escuta em tempo real (`onSnapshot`), nem nos shards de hoje. Com 64 shards mudando perto de 1 vez por segundo cada, uma escuta custaria dezenas de leituras por segundo por aba aberta; a cota grátis é de 50 mil leituras por dia, e foi esse tipo de leitura que estourou o Painel Imagine.
- Os shards de hoje com `getDocs` ao abrir a tela e no botão de atualizar. Atualização automática, se o bloco 11 quiser, no mínimo a cada 5 min e só com a aba visível (64 leituras por vez).
- Dia passado sem o documento fechado: soma os shards dele.

## 8. Temporada

- A temporada atual mora em `config/season.season`. O histórico (`seasons/{id}` com o resultado congelado) é do bloco 8.
- O `award` só soma em temporada com `startsAt <= now < endsAt`. Ponto ganho fora da janela entra no saldo e no XP, não na temporada.
- Virada sem varrer carteiras: cada carteira e cada `centralPoints` guardam o `seasonId` dos pontos. No primeiro lançamento aplicado da temporada nova, o `award` zera e troca o id (seção 5, passo 6). A leitura mostra 0 para quem ainda não pontuou nela. Arquivar o resultado e criar a próxima temporada são do bloco 8.
- **O lançamento lê `config/season` dentro da transação**, nunca do cache (1 leitura a mais por ação). Com o cache de 60 s por instância, logo depois de a equipe encerrar a S1 antes do fim e criar a S2, uma instância ainda veria a S1 e outra já a S2. Um pedido do fã numa instância trocaria a carteira para a S2, o seguinte, na outra, voltaria para a S1: os pontos da S2 sumiriam e o `pastSeasons` contaria em dobro, e o mesmo em cada `centralPoints`. Na transação, todo lançamento vê a temporada que está gravada. As leituras (`GET`) seguem com o cache, porque só mostram.
- **O id da temporada não muda depois que ela começa.** O id é a chave dos pontos: trocá-lo (para corrigir um erro de digitação, por exemplo) zeraria todo mundo na ação seguinte. O `updateSeason` (bloco 8) recusa mudar o `id` de uma temporada com `startsAt` no passado (`season-id-locked`; nome, fim e título continuam editáveis) e recusa voltar a um id que já foi usado (`season-id-used`, conferido nas versões), porque as carteiras que já trocaram para a temporada seguinte zerariam de novo.
- `pastSeasons` conta as temporadas passadas em que o fã pontuou, na troca preguiçosa.
- O status da temporada (`active` ou `ended`, o `Season.status` do app) é calculado na leitura, pelo `endsAt`.

## 9. Configuração versionada

- `config/points` e `config/season` são lidos juntos (`db.getAll`) por `createConfigSource(db, { ttlMs: 60_000, now })`, com cache em memória por instância. Mudança de valor, limite ou régua feita no painel vale em até 60 s. O `award` usa os valores lidos antes da transação e a temporada lida nela (seção 8); o extrato guarda `configVersion` e `seasonId`.
- Documento que não existe: padrão do código (versão 0; temporada `null`).
- **Leitura tolerante** (`parsePointsConfig`, pura, com teste): parte do padrão do código e sobrepõe, campo a campo, o que veio no documento.
  - Origem que o código não conhece (em `values` ou `dailyLimits`) é ignorada, com `logger.warn`.
  - Valor ou limite inválido volta ao padrão só nele, com `logger.error`. `levels` inválido volta à régua padrão inteira.
  - Origem nova no código entra com o valor padrão dela e não derruba os valores que a equipe ajustou nas outras. Se a leitura exigisse todas as origens, cada origem nova tornaria inválido o `config/points` do painel e o servidor voltaria inteiro ao padrão; se aceitasse o mapa parcial sem completar, `config.values[source]` viria `undefined` e, como `undefined <= 0` é falso, a carteira gravaria `NaN`. Por defesa, o `computeAwards` ainda trata valor ausente como 0.
  - `parseSeasonConfig`: temporada inválida vira `null` (sem temporada), com `logger.error`.
- **Validação estrita na gravação:** o callable do painel recusa o pedido inteiro, com o campo errado em `details`. As regras são as mesmas da leitura:
  - `values`: só origens conhecidas, inteiros de 0 a 10.000.
  - `dailyLimits`: só origens conhecidas, inteiro de 1 a 1.000 ou `null`.
  - `levels`: de 2 a 50 degraus; `number` de 1 a n, em ordem; `minXp` começa em 0 e sobe sempre; `name` com 1 a 40 caracteres e `isVisibleLine` (de `functions/src/visible-line.ts`).
  - `season`: `id` em `^[a-z0-9-]{3,40}$`; `name` de 1 a 40 e linha visível; `startsAt` antes de `endsAt`, no máximo 366 dias; `leaderTitle` `null` ou de 1 a 40 e linha visível.
- Não retroativo: valor novo vale a partir de quando é gravado, e o que já foi lançado fica como foi. A régua é a exceção natural: o nível sai do XP na leitura, então mudar a régua muda o nível mostrado de todo mundo na hora, sem mexer em ponto nenhum. Conquista ligada a nível (bloco 7) precisa levar isso em conta.

Callables do painel, no padrão das de artistas (bloco seguinte para valores e régua; bloco 8 para a temporada), com erro `HttpsError` e `details.reason`:

| Callable                                                                                                          | Quem                         | O que faz                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updatePointsConfig({ expectedVersion, values?, dailyLimits?, levels? })`                                         | `canEditSection('missions')` | na transação: lê a versão atual, recusa com `config-changed` se mudou desde a tela, valida, grava `config/points` com `version + 1`, a cópia em `versions/{n}` e `staffAudit` `points.config.updated` (`details`: versões e campos mudados) |
| `updateSeason({ expectedVersion, season })`                                                                       | `canEditSection('ranking')`  | o mesmo em `config/season`, mais `season-id-locked` e `season-id-used` (seção 8), auditoria `season.updated`                                                                                                                                |
| `adjustFanPoints({ uid, balance?, xp?, season?, central?: { artistId, season?, total? }, note, idempotencyKey })` | `canEditSection('fans')`     | `runAward` com `adjust`, auditoria `wallet.adjusted`                                                                                                                                                                                        |

As ações de auditoria novas entram no `AuditAction` de `functions/src/staff/service.ts`. As callables existentes da equipe e dos artistas não mudam.

## 10. Ranking (direção para o bloco 8)

- Ranking geral: consulta em `wallets` com `seasonId == <temporada>`, `seasonPoints > 0` e `orderBy('seasonPoints', 'desc')`, desempate por `seasonPointsAt` crescente (quem chegou primeiro fica na frente) e, no mesmo milissegundo, pelo id do documento, com índice composto. O filtro `seasonPoints > 0` tira quem está na temporada com 0 (um ajuste que zerou, por exemplo).
- Ranking da central: grupo de coleção `centralPoints` com `artistId == <central>`, `seasonId == <temporada>`, o mesmo filtro e a mesma ordem, com índice composto. Os top fãs da página do artista são as 3 primeiras posições.
- Posição do fã (`/me/rank`): 1 mais o `count()` de quem vem antes dele na mesma ordem da lista, isto é, `seasonPoints > meu` mais `seasonPoints == meu` com `seasonPointsAt < meu` (duas contagens, ou uma consulta `or`). Contar só "quem tem mais pontos" daria a mesma posição a todos os empatados, enquanto a lista os desempata, e o card "Você" e a linha da lista mostrariam posições diferentes. A agregação cobra 1 leitura a cada 1.000 entradas do índice.
- "Posições desde a semana anterior" (`change`) pede uma foto semanal, feita por função agendada.
- Materializar o ranking por função agendada só se o custo pedir.
- Os campos que o ranking precisa (`seasonId`, `seasonPoints`, `seasonPointsAt`) já nascem no bloco 1, para não haver carga de dados depois.

## 11. Regras do Firestore

Só acréscimo: nenhuma regra existente muda. As regras novas entram antes do `match /{document=**}` final.

```
    // Carteira, extrato e pontos por central: só o servidor grava (award). O fã
    // lê pela API, nunca direto, nem a própria. A equipe com a seção fans lê
    // (seção Fãs do painel).
    match /wallets/{uid} {
      allow read: if canSeeSection('fans');
      allow write: if false;

      match /ledger/{entryId} {
        allow read: if canSeeSection('fans');
        allow write: if false;
      }

      match /centralPoints/{artistId} {
        allow read: if canSeeSection('fans');
        allow write: if false;
      }
    }

    // Valores, limites, régua e temporada. A equipe ativa lê só estes dois
    // documentos; muda só por callable, com auditoria. O app recebe os
    // valores pela API. Documento novo em config/ não fica legível sozinho.
    match /config/{docId} {
      allow read: if isActiveStaff() && docId in ['points', 'season'];
      allow write: if false;

      match /versions/{version} {
        allow read: if isActiveStaff() && docId in ['points', 'season'];
        allow write: if false;
      }
    }

    // Contadores agregados do painel (Visão geral e Crescimento).
    match /statsDaily/{day} {
      allow read: if canSeeSection('overview') || canSeeSection('growth');
      allow write: if false;

      match /statsShards/{shard} {
        allow read: if canSeeSection('overview') || canSeeSection('growth');
        allow write: if false;
      }
    }

    // Controle do fechamento do dia e chaves de idempotência da API: só o servidor.
    match /statsMeta/{docId} {
      allow read, write: if false;
    }

    match /idempotency/{id} {
      allow read, write: if false;
    }
```

As regras do bloco 4 (vínculo e shards do `fanCount`) estão na seção 19.

Testes em `tests/points-rules.test.ts`, no molde de `tests/artists-rules.test.ts` (mesmos membros de exemplo: admin, editora, leitor, sem seção, desativada, pendente e ligada com `authValidAfter`):

- Fã logado não lê (`get` e `list`) a própria carteira, a de outro, o extrato nem os pontos por central, e não grava em nenhum.
- Equipe ativa com `fans` (editor e leitor) e admin leem carteira, extrato e pontos por central de qualquer fã.
- Equipe sem `fans`, desativada, pendente ou com sessão de antes do `authValidAfter` não lê.
- Ninguém grava nas coleções novas, nem admin.
- `config/points`, `config/season` e as versões: equipe ativa lê (inclusive o leitor sem seção); fã, sem login e equipe inativa não; ninguém grava.
- `config/<outro id>` e as versões dele: nem a equipe ativa lê, nem admin.
- `statsDaily` e os `statsShards`: quem vê `overview` ou `growth` lê (`get` e `list`); quem só vê `fans` não lê; fã não lê; ninguém grava.
- `statsMeta` e `idempotency`: ninguém lê nem grava.
- Os arquivos de teste que já existem continuam passando sem mudança.

Ficam para depois: a leitura de `users/{uid}` pela seção Fãs (bloco 11, uma linha `allow get, list: if canSeeSection('fans')` somada à do fã), o grupo de coleção `ledger` se o painel listar lançamentos de todos (bloco 11) e o grupo `centralPoints` se o painel ler o ranking direto (bloco 8).

## 12. Exclusão de conta

`deleteUserData` (`functions/src/store.ts`), nesta ordem:

1. Reservas de @ (como hoje).
2. `recursiveDelete(users/{uid})` (como hoje). A partir daqui, nenhuma gravação nova do fã passa: toda rota que grava lê `users/{uid}` na transação (`requireFan`), rendendo ponto ou não, e o ajuste da equipe também (`runAward`). Uma gravação que já tinha lido o perfil segura a trava dele e entra antes desta etapa terminar. O crédito para um fã excluído vindo da ação de outro (quem convidou, bloco 5) sai `skipped`, sem gravar.
3. Novo: `recursiveDelete(wallets/{uid})`, que leva carteira, extrato e pontos por central. Vem depois do perfil, então nada gravado no meio sobra.
4. Novo: as chaves de `idempotency` com `uid == <uid>`, em lotes de até 500 (as respostas guardadas podem ter texto do fã; o TTL só apagaria em 30 dias).
5. `staff/{uid}` (como hoje).

O bloco 4 muda o passo 2: o documento do perfil sai sozinho primeiro, depois saem os vínculos com as centrais (descontando o `fanCount`) e só então o `recursiveDelete(users/{uid})`. Ordem completa e motivo na seção 19 (19.12).

Continua idempotente e seguro de repetir (o gatilho tem `retry: true`), e o `handleUserCreated` que desfaz a conta usa a mesma função.

Os agregados não descontam. Eles contam o que aconteceu em cada dia (pontos dados, eventos, fãs ativos, atividade por coorte), sem uid e sem dado pessoal, e a LGPD não pede que mudem. Descontar reescreveria dias fechados e mudaria comparativos já vistos, e exigiria ler o extrato inteiro do fã. Não ficam inconsistentes porque o bloco 1 só guarda fluxo (o que aconteceu no dia), nunca estoque (quanto existe agora). Quem guardar estoque desconta na exclusão: o `fanCount` das centrais (bloco 4). O resultado congelado das temporadas (bloco 8) guarda o uid e busca o nome na leitura, para o fã excluído sumir dele.

## 13. App: seletor por domínio e coerência com as fixtures

### Seletor por domínio

`src/config/server.ts` (novo; o `env.ts` reexporta tudo dele):

- `firebaseEmulatorHost` (só em `__DEV__`, como antes) e `EMULATOR_PROJECT_ID` (`demo-imagine-up-app`) passam para cá, e `src/firebase/config.ts` reexporta o projeto (o arquivo não pode importar o Firebase).
- `apiUrl` (por `resolveApiUrl`): com `firebaseEmulatorHost`, `http://<host>:5001/demo-imagine-up-app/southamerica-east1/api`, e o `EXPO_PUBLIC_API_URL` é ignorado (o token do emulador não vale na API de verdade); sem ele, o `EXPO_PUBLIC_API_URL`, como hoje. Nenhuma variável nova.
- Por que um arquivo à parte, e não o `env.ts` (desvio da primeira versão desta nota): o seletor abaixo é importado pelas fixtures, pelo cache do React Query e pelo `api.ts` de cada domínio. Lendo o `env.ts`, ele puxava junto a leitura da configuração do Firebase, e cada suíte do Jest que só usa fixtures passava a imprimir o aviso de Firebase sem configuração. O `server.ts` só lê as duas variáveis do servidor.
- `DataSource` e `dataSource` saem do `env.ts`.

`src/config/data-source.ts` (novo):

```ts
export type DataSource = 'api' | 'fixtures';
export type DataDomain =
  | 'wallet' // /me/wallet, /me/progress, /me/ledger (bloco 1)
  | 'achievements' // bloco 7
  | 'invite' // /me/invite e o claim (bloco 5)
  | 'artists' // bloco 4
  | 'posts' // bloco 6
  | 'agenda' // bloco 6
  | 'missions' // bloco 7
  | 'ranking' // bloco 8
  | 'rewards'; // bloco 10

/** Domínios com rota no servidor. Cada bloco acrescenta o seu no commit que entrega as rotas. */
export const SERVER_DOMAINS: ReadonlySet<DataDomain> = new Set(['wallet']);

export function sourceOf(domain: DataDomain): DataSource {
  return apiUrl && SERVER_DOMAINS.has(domain) ? 'api' : 'fixtures';
}
export function usesFixtures(): boolean; // algum domínio em fixtures
```

- Cada `api.ts` troca `dataSource === 'fixtures'` por `sourceOf('<domínio>') === 'fixtures'`. O `profile/api.ts` usa `wallet` em `fetchWallet` e `fetchMyProgress`, `achievements` em `fetchMyAchievements` e `invite` em `fetchMyInvite`. O `claimPendingInvite` usa `invite`: com o emulador ligado no bloco 1, o convite continua sem ir ao servidor, em vez de bater num 404.
- `services/query/client.ts`: o padrão do `networkMode` é `always` enquanto `usesFixtures()`; `queryOptionsFor(domain)` devolve `{ networkMode: queryNetworkMode(sourceOf(domain)), meta: { realData: sourceOf(domain) === 'api' } }`. `useWalletQuery` e `useMyProgressQuery` espalham `queryOptionsFor('wallet')`. Cada bloco faz o mesmo nas queries do seu domínio.
- `services/query/persister.ts`: `shouldPersistQuery(query, fixturesInUse = usesFixtures())` manda para o disco a consulta com `meta.realData === true`, ou todas quando nenhum domínio estiver em fixtures. O formato salvo não muda: não precisa subir `QUERY_CACHE_VERSION`.
- `use-auth-listener.ts`: `if (usesFixtures()) resetFixtureSession()`.
- Testes que faziam `jest.mock('@/config/env', () => ({ dataSource }))` passam a mockar `@/config/data-source` (`sourceOf` e `usesFixtures`); o `env` continua mockado só onde o teste precisava dos outros campos dele.

Comportamento:

| Situação                                           | Carteira e progresso | Outros domínios                 |
| -------------------------------------------------- | -------------------- | ------------------------------- |
| Build sem API e sem emulador (todas as de hoje)    | fixtures             | fixtures (igual a hoje)         |
| Desenvolvimento com emulador                       | API do emulador      | fixtures                        |
| Build com `EXPO_PUBLIC_API_URL` (depois do deploy) | API                  | fixtures até o bloco de cada um |

**`EXPO_PUBLIC_API_URL` só entra nas builds da cliente quando todas as ações que rendem ou gastam pontos estiverem na API:** entrar na central (bloco 4), comentar, curtir e "Eu vou" (bloco 6), missões (bloco 7) e loja (bloco 10), e o ranking (bloco 8), para o card "Você" não mostrar o exemplo. Na prática, depois do bloco 10. Antes disso, com a regra de coerência abaixo, toda ação renderia 0, todo resgate recusaria com `points_unavailable` e todo fã de verdade ficaria com 0 ponto e nível 1: a cliente perderia a demonstração de pontos que tem hoje. Até lá, a API de verdade só vale em desenvolvimento, com os emuladores. Publicar a função `api` antes não muda nada nos aparelhos, enquanto a variável estiver vazia.

### Regra de coerência

Ponto existe num lugar só. Com a carteira na API, a `fixtureWallet` para nos valores de exemplo, e nenhuma ação de fixture rende ponto:

- Comentar, curtir, "Eu vou" e entrar na central acontecem como hoje, mas devolvem `pointsAwarded: 0` (sem o "+N" do botão) e não mexem em carteira nenhuma.
- Concluir missão também: a missão anda e conclui, a ação devolve 0, e a 1g ainda festeja a conclusão com o "+N" do card, que é a recompensa nominal da missão, sem crédito na carteira. É dado de exemplo até o bloco 7.
- O resgate de fixture recusa com 409 e o código `points_unavailable`, porque gastaria um saldo que não é o da tela. O código mora em `services/fixtures` (não é da API), e o app mostra o erro genérico do resgate.
- O ranking (card "Você" da 1f) e o "você é #12" da home continuam lendo a `fixtureWallet`, parada no exemplo (temporada 4.120), para qualquer fã: a Camila do seed tem 4.120 também no servidor, e o Alan, com 0 no servidor, aparece com 4.120 no ranking. São dados de exemplo até o bloco 8. Zerar a temporada do ranking nesse modo (`buildMyRankFixture` com 0) só trocaria a diferença do Alan pela da Camila. O mesmo vale para os pontos e a posição de "Suas centrais" na 1b e na 1e (`FanCentral`, do `buildMyRankFixture`: Netto 4.120 e Nenho 2.980, para qualquer fã), até os blocos 4 e 8; na conferência de 2026-10-05, a conta nova criada pelo cadastro mostrou 0 ponto e nível 1 do servidor e essas centrais de exemplo. Com o bloco 4, "Suas centrais" vêm do servidor sem posição, e o ranking de exemplo ao lado de dado de verdade leva um aviso na tela (seção 19, 19.13).
- Quando o domínio da ação passa para a API, o servidor volta a dar os pontos.
- Com a carteira em fixtures (builds sem API e sem emulador), tudo fica como hoje.

Implementação em `src/services/fixtures/index.ts`: `earnFixturePoints(points): number` soma na `fixtureWallet` e devolve os pontos quando `sourceOf('wallet') === 'fixtures'`, e devolve 0 sem somar quando ela está na API. Os três que hoje chamam `fixtureWallet.earn` passam a usar o retorno no `pointsAwarded`: o comentário (`posts/fixtures.ts`), a entrada na central (`artists/fixtures.ts`) e a conclusão de missão (`missionsFixture.record`). `fixtureWallet.spend` recusa com `points_unavailable` quando a carteira está na API. Testes dos dois modos em `src/services/fixtures/__tests__`.

Outros testes do app no bloco 1: `sourceOf` sem API, com `EXPO_PUBLIC_API_URL` e com emulador (URL montada), em `src/config/__tests__/data-source.test.ts`; `profile/api.ts` no modo API (axios mockado, `/me/wallet` e `/me/progress`); `useWalletQuery` e `useMyProgressQuery` pela API, com a consulta esperando a rede e indo para o disco (`profile/__tests__/wallet-queries.test.tsx`); `shouldPersistQuery` com `meta.realData` e `queryOptionsFor` (`services/query/__tests__/cache.test.ts`); a regra de coerência nos dois modos (`services/fixtures/__tests__/coherence.test.ts`).

Nada disso entra no fingerprint da EAS (só JavaScript). Mudar scripts do `package.json` entraria.

## 14. Seed dos emuladores

`scripts/seed-emulators.mjs` ganha a carteira da Camila, gravada pelo mesmo `award` das funções, para a 1e mostrar os pontos, o nível e a semana do servidor iguais aos de hoje.

- O script carrega `functions/lib/points` (o build que o `npm run emulators` já fez) e o `firebase-admin` de `functions/node_modules` com `createRequire`, como o `staff-bootstrap-invite.mjs`, e chama `seedCamilaWallet(db, uid)` (`functions/src/points/seed.ts`, que o teste de emulador também chama). Fixa no processo `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` e o projeto `demo-imagine-up-app`: nunca grava fora do emulador.
- Depois de a Camila ter o perfil (o script já espera por ele para gravar a cidade), grava `config/season` se ele não existir: `id: 'temporada-sao-joao'`, `name: 'São João'`, `startsAt` 18 dias antes de agora, `endsAt` 12 dias depois, `leaderTitle: null`, `version: 1`. São as datas do `buildSeasonFixture`. `config/points` não é gravado, para o padrão do código ficar exercitado.
- Os números do protótipo não fecham entre si: os pontos das centrais (4.120 no Netto e 2.980 no Nenho) somam mais que os 4.120 da temporada. Por isso a base entra por ajustes, que mexem em cada contador separado, e a semana entra por ganhos de verdade.

Lançamentos, em ordem, cada um com o relógio do `AwardContext` na data indicada (meio-dia de São Paulo, 15:00 UTC):

| Quando       | Lançamento                                                                  | Saldo   | XP      | Temporada | Central                  |
| ------------ | --------------------------------------------------------------------------- | ------- | ------- | --------- | ------------------------ |
| 8 dias atrás | `seed:camila-base` (adjust)                                                 | +11.640 | +11.640 | +3.280    |                          |
| 8 dias atrás | `seed:camila-base-netto` (adjust, `central: { season: 3620, total: 3620 }`) |         |         |           | Netto +3.620             |
| 8 dias atrás | `seed:camila-base-nenho` (adjust, `central: { season: 2640, total: 2640 }`) |         |         |           | Nenho +2.640             |
| 6 dias atrás | `mission:seed-camila-1` (earn, 200)                                         | +200    | +200    | +200      | Netto +200               |
| 4 dias atrás | `mission:seed-camila-2` (earn, 240)                                         | +240    | +240    | +240      | Nenho +240               |
| 2 dias atrás | `mission:seed-camila-3` (earn, 300)                                         | +300    | +300    | +300      | Netto +300               |
| 1 dia atrás  | `mission:seed-camila-4` (earn, 100)                                         | +100    | +100    | +100      | Nenho +100               |
| total        |                                                                             | 12.480  | 12.480  | 4.120     | Netto 4.120, Nenho 2.980 |

Os ids das centrais são `nettobrito` (Netto) e `nenho` (Nenho), no formato do @ das centrais (`HANDLE_PATTERN`; o `netto-brito` das fixtures do app não passaria na validação do `award`). O bloco 4 cria as centrais de teste do emulador com esses mesmos @. Os 840 da semana dão o "+840" da 1e. Os ajustes de central dizem `season` e `total` (seção 5): a temporada de cada central fecha em 4.120 e 2.980, e o total de sempre também.

- O seed usa o `runAward` com `actor.type: 'system'`: não marca atividade.
- `stats.pastSeasons` não é ponto e ainda não tem caminho de servidor (temporadas passadas são do bloco 8): o seed grava direto `wallets/{uid}.stats.pastSeasons = 2`, e a 1e mostra 3 temporadas.
- Links criados e pessoas trazidas (63 e 418 nas fixtures) ficam 0 até o bloco 5, que cria o lugar deles, fora da carteira (seção 4), e põe os da Camila no seed.
- Rodar de novo não muda nada: os lançamentos já existem e voltam `duplicate`, e transação sem nada aplicado não grava a carteira (seção 5, passo 9).
- O Alan fica sem carteira: é o fã novo (0 pontos, nível 1).

Resultado na 1e: "SEUS PONTOS" 12.480; Purainha (7), anel e barra em 68,5%, faltam 2.520; "Esta semana" +840; 0 links, 0 pessoas e 3 temporadas (o 63 e o 418 voltam com o bloco 5).

## 15. Ambientes

- Hoje há um projeto Firebase só, `imagine-up-app`, para os três ambientes da EAS (development, preview e production), e os emuladores (`demo-imagine-up-app`) no desenvolvimento. A API segue o mesmo: a de produção e a do emulador.
- A UP-15 pede o projeto rodando em dois ambientes. Proposta, que espera o ok da cliente: o `imagine-up` (dela, sem uso, com Firestore em `southamerica-east1`) vira o ambiente de testes das builds development e preview, e o `imagine-up-app` fica com a production. Nada disso é feito agora.
- O que muda quando ela aprovar: alias do `imagine-up` no `.firebaserc`; `functions/.env.imagine-up` com `PANEL_URL` e o EmailJS; plano Blaze no `imagine-up` (funções de 2ª geração pedem); Authentication por e-mail e senha e o bucket do Storage ligados lá; regras, índices e funções publicados nos dois projetos (os scripts ganham `--project`); variáveis da EAS de development e preview com a config do `imagine-up` e `EXPO_PUBLIC_API_URL=https://southamerica-east1-imagine-up.cloudfunctions.net/api`; o painel com um ambiente de testes na Vercel apontando para o `imagine-up`; e as origens do painel de testes no `PANEL_ORIGINS`.
- Até lá, dado de teste não vai para o `imagine-up-app`: os testes rodam nos emuladores.

## 16. Testes do bloco 1

Funções, testes puros (`vitest`, em `functions/src`, relógio injetado):

- `router.test.ts`: casa padrão com parâmetro, barra no fim, 404, 405, id com `%2F`.
- `idempotency.test.ts`: formato da chave (inclusive a do convite, com data ISO), id por fã, `fingerprint` estável com chaves do corpo em outra ordem; `ALREADY_EXISTS` (código 6) em volta da transação roda de novo uma vez, e só uma; resposta guardada sem `undefined` e com data em texto; e o `runIdempotent` com um Firestore falso: shard sorteado de novo a cada tentativa (gravado o da última), plano sem o `fan` de quem chama recusado sem gravar, o mesmo fã duas vezes numa carteira só.
- `award.test.ts`: `mergeFanAwards` junta o mesmo uid na ordem, com o retrato, e recusa dois retratos ou retrato de outro fã. `stats.test.ts`: `pickShard` nas pontas (0 dá 0, 0,9999 e 1 dão 63) e o documento do shard com increments em mapas aninhados.
- `config.test.ts`: padrão sem documento; origem nova no código mantém os valores do painel; origem desconhecida ignorada; campo inválido volta ao padrão só nele; régua inválida volta inteira; cada regra da validação estrita do callable.
- `model.test.ts` (tabela): `dayKey`, semana ISO e mês perto da meia-noite de São Paulo; `levelForXp` (12.480 dá 7 e 8); `computeAwards` com ganho, duplicado, valor zero, valor ausente na configuração (0), limite do dia e virada do dia, débito com e sem saldo, ajuste que ficaria negativo, ajuste de central em `season` e em `total` (com e sem temporada ativa) e o `seasonPointsAt` que ele mexe, troca de temporada com `pastSeasons`, ponto fora da janela da temporada (entra só no total da central), outro fã sem perfil (`skipped`), `weekEarned` dos 7 dias; corte de `days` só antes de `day` menos 6 (um dia depois do "agora" fica); nada aplicado e sem marca nova não grava carteira, central nem shard; marcas de atividade do dia, da semana, do mês e da coorte.

Unitários a mais: `wallet.test.ts` (carteira, progresso e cursor do extrato, inclusive instante acima do maior `Timestamp` e id fora do formato) e `api/index.test.ts` (o handler com Auth e Firestore falsos: formato da resposta e dos erros, 401, 404, 405, 413, 400 do extrato e da chave, 500 sem o token no log, 503 com `Retry-After` na disputa e na falha ao buscar as chaves do Google, nos formatos que o firebase-admin lança).

Funções nos emuladores (`functions/test/points.emulator.test.ts`; o `beforeAll` passa a esperar também a `api`). As rotas do bloco 1 só leem: as que gravam (comentário, resgate e uma gravação sem ponto) existem só no teste, passadas ao `createApiHandler` com o Firestore e o Auth dos emuladores, no processo do teste. Nenhuma rota de teste vai para o código publicado.

- HTTP com token do emulador de Auth: sem token 401 no formato combinado; token inválido 401; rota desconhecida 404; método errado 405; carteira e progresso de fã sem carteira zerados; a mesma resposta pelo caminho do emulador que o app usa; o extrato da Camila de 2 em 2 e de 5 em 5, com páginas que cortam entre lançamentos do mesmo milissegundo.
- `award` e `runIdempotent` (com uma rota de teste que grava, porque as rotas do bloco 1 só leem): os três contadores e a central; o mesmo evento não paga duas vezes; limite do dia e o dia seguinte; mesma chave devolve a resposta guardada sem lançar de novo; mesma chave com outro corpo 422; duas chamadas em paralelo com a mesma chave lançam uma vez; recusa não grava a chave; resposta com campo `undefined` e data grava, e a repetição é igual à primeira; o mesmo fã duas vezes no plano grava uma carteira, com o ponto e a atividade; dois lançamentos no mesmo shard (sorteio fixo em 0) somam por origem e por artista; dez lançamentos em paralelo do mesmo fã somam certo; shard do dia somado; perfil ausente 503 `profile_not_ready`, também em gravação sem ponto; conta só da equipe 403 `not_fan`; a temporada trocada em `config/season` vale no lançamento seguinte, sem esperar o cache, e não volta; primeira ação sem ponto do dia marca o fã ativo, a segunda não grava carteira nem shard.
- Débito: sem saldo recusa sem gravar nada; com saldo, só o saldo cai.
- Exclusão: `deleteUserData` apaga carteira, extrato, pontos por central e chaves; agregados ficam; lançamento depois da exclusão recusa.
- Seed: a Camila fica com 12.480, 12.480, 4.120, Netto 4.120 e Nenho 2.980 (temporada e total), e o `/me/progress` responde o da seção 14; rodar de novo não muda nada, nem o "+840".

Regras: `tests/points-rules.test.ts` (seção 11). App: seção 13.

## 17. Perguntas do levantamento

1. **Como o app fala com o servidor.** HTTP `onRequest`, decisão do dono em 05/10/2026. O `toApiError` não precisa de ramo para erro do Firebase. As callables seguem só no painel.
2. **O que o app lê direto.** Só `users/{uid}`; todo o resto pela API, com as regras fechadas (seção 3).
3. **Quem calcula os pontos e quando.** O servidor, na transação da ação, com o id do lançamento pelo evento (seção 5). O progresso de missão também fica na transação, ao contrário da sugestão de gatilho do levantamento: o app espera os pontos da missão no `pointsAwarded` da própria ação. Conquista que não muda o `pointsAwarded` pode vir por gatilho (bloco 7).
4. **Onde ficam os contadores e os pontos por central.** Em `wallets/{uid}` e `wallets/{uid}/centralPoints/{artistId}` (seção 4). O vínculo com a central é do bloco 4, separado dos pontos. Direção: `users/{uid}/centrals/{artistId}`, que some junto com o perfil (a exclusão desconta o `fanCount` antes) e permite a consulta por central pelo grupo de coleção; o bloco 4 confirma, com regras e testes. O `fanCount` não é somado em `artists/{id}` na transação do vínculo: os 4 destaques da 1l recebem quase todo cadastro, e esse documento ficaria disputado (e também é o que as callables do painel gravam). Ele é dividido em shards, sorteados como os do painel, e somado no fechamento ou na leitura (seção 18). Fechado no bloco 4 (seção 19): o vínculo fica em `users/{uid}/centrals/{artistId}`, e os shards em `artistStats/{artistId}/fanShards`, somados por uma tarefa da fila `syncArtistFanCount`, que copia o total para `artists/{id}.fanCount`.
5. **Formato dos agregados.** Documento por dia em 64 shards, na transação do ponto e só quando algo mudou, com pontos por origem e por artista, fãs ativos e coortes, mais o fechamento do dia (seção 7). Teto e saída registrados na seção 7.
6. **Como calcular o ranking.** Consulta ordenada com índice, com desempate por `seasonPointsAt`, e posição por `count()` na mesma ordem da lista; materializar só se o custo pedir (seção 10, bloco 8).
7. **Como guardar a régua.** `config/points`, versionado, com padrão no código e edição por callable com auditoria. Mudança de valor não vale para ação antiga (seção 9).
8. **Como montar o feed.** Bloco 6. A consulta por `artistId` com `in` (até 30 centrais) basta enquanto o fã seguir poucas centrais; sem cópia por fã.
9. **Antifraude.** Limites diários por origem no servidor, sem App Check por enquanto (seção 5).
10. **Ambiente de testes.** Documentado; espera o ok da cliente (seção 15).
11. **Onde o mural e a agenda entram no painel.** Bloco 6. Não muda nada no bloco 1.
12. **Exclusão de conta.** Agregados não descontam (seção 12). Direção para os outros blocos: comentários do fã excluído são apagados, com a contagem do post descontada (bloco 6); resgate em aberto continua para a equipe entregar ou cancelar, sem o uid e com o status de conta excluída (bloco 10).

## 18. O que fica para os próximos blocos

- **Bloco 4 (centrais):** desenhado na seção 19. O que ele deixa para os blocos seguintes está em 19.16.
- **Bloco 5 (convite):** `/me/invite` e o claim final; a visita ao link numa função própria, sem login, com CORS só para a origem do site, e `invite_visit` pelo `award`; `invite_signup` pelo `planAwards` com dois fãs (o convidado chama, quem convidou recebe, e sai `skipped` se excluiu a conta); links criados e pessoas trazidas fora da carteira e sem documento disputado (por exemplo uma entrada por convidado, contada com `count()`; um contador único somado no claim derrubaria o cadastro dos convidados de um link que viraliza), lidos pelo `/me/progress`, e os 63 e 418 da Camila no seed; o código do convite conferido com o `CODE` de `invites/deep-link.ts` antes de guardar, e o app esquecendo o código quando o servidor recusar de vez (seção 2); `signups` e `byOrigin` nos shards e cadastros por semana, o denominador da retenção (seção 7); a carga dos cadastros antigos.
- **Bloco 6 (mural e agenda):** rotas, coleções e regras de posts, comentários, curtidas, shows e presenças; `like`, `comment` e `rsvp` pelo `award`; contadores de engajamento; bloqueio de fã; exclusão do conteúdo do fã.
- **Bloco 7 (missões e conquistas):** progresso de missão na transação; conquistas; tela do extrato (`/me/ledger`, com desenho); `updatePointsConfig` e a seção Missões e régua no painel.
- **Bloco 8 (ranking e temporadas):** `updateSeason` com `season-id-locked` e `season-id-used` (seção 8), histórico em `seasons/{id}`, arquivo do resultado, índices compostos, posição por `count()` com o desempate da lista (seção 10), foto semanal do `change`.
- **Bloco 10 (loja):** rotas da loja e o resgate com o débito já pronto; `sold_out` no `API_ERROR_CODES`.
- **Bloco 11 (painel):** Visão geral e Crescimento lendo `statsDaily` sem escuta em tempo real (seção 7), com ativos do dia, da semana e do mês e a retenção por coorte; Fãs lendo carteira e extrato, mais a regra de `users/{uid}` para a equipe; `adjustFanPoints`; fechamento do dia, se o bloco 4 não tiver feito.
- **Ambiente de testes:** quando a cliente aprovar (seção 15).
- **Publicação:** deploy da `api`, das regras e dos índices, e `minInstances`, só com o ok do dono. `EXPO_PUBLIC_API_URL` nas variáveis da EAS só depois dos blocos 4, 6, 7, 8 e 10, quando nenhuma ação que rende ou gasta pontos ficar nas fixtures (seção 13); antes disso a cliente perderia a demonstração de pontos.

## 19. Bloco 4: centrais de verdade

O app passa a mostrar as centrais que o painel publica, e seguir, entrar e sair de uma central passam a valer no servidor. Esta seção é o contrato do bloco 4: rotas, coleções, transações, regras, efeitos no painel, exclusão de conta, mudanças no app, seed e testes. Ela segue os padrões do bloco 1 (seções 1 a 16) e só diz o que muda ou acrescenta.

Origem: o levantamento de 05/10/2026 (bloco 4) e o pedido do dono de 05/10/2026. A build sem emulador continua nas fixtures até a cliente entregar os artistas reais (UP-2 e UP-48). O `EXPO_PUBLIC_API_URL` segue a regra da seção 13: só depois do bloco 10.

Estado: implementado em 05/10/2026 no app e nas funções, sem deploy (ordem da publicação em 19.16). Onde o código detalhou ou desviou desta seção, o texto abaixo já diz como ficou, marcado com "(implementação)".

### 19.1 Decisões

Cada item traz a recomendação e o motivo. Os marcados como pergunta vão para o dono ou para a cliente, e o código já nasce com o padrão daqui, fácil de trocar.

1. **Vínculo em `users/{uid}/centrals/{artistId}`.** Confirma a direção da seção 17 (pergunta 4). Um documento por fã e central, só do servidor. Motivo: a transação do fã grava só no documento dele, sem nada disputado; `isMember` é uma leitura; "Suas centrais" é a subcoleção; e a equipe acha os fãs de uma central pelo grupo de coleção. O documento sai quando o fã sai, sem marca de "saiu": o histórico de entradas e saídas fica nos agregados (19.9) e no extrato (`central_join`).
2. **`fanCount` somado na mesma transação, num shard, e copiado para `artists/{id}` por uma fila de tarefas.** A transação do vínculo soma +1 ou -1 num de 16 shards (`artistStats/{artistId}/fanShards/{n}`), nunca em `artists/{id}`. Um gatilho nos shards põe na fila `syncArtistFanCount` uma tarefa por central e por janela de 10 s; a tarefa soma os shards e copia o total para `artists/{id}.fanCount`, que o app e o painel leem (19.6). Motivo: os 4 destaques da 1l recebem quase todo cadastro, e as transações de entrada leem `artists/{id}`. Somar direto nele, ou copiar a soma a cada mudança, o deixaria disputado com as próprias entradas (a seção 17 já tinha decidido não somar nele). Com a fila, ele recebe no máximo uma gravação a cada 10 s, e o número sempre fecha. O painel já lê `artists/{id}.fanCount`, então passa a mostrar os membros de verdade sem mudar nada lá. A soma exata, a dos shards, é a que o `deleteArtist` confere (19.11).
3. **Seguir na 1l rende os pontos de entrada, como o "Entrar na central" da 1d.** Regra única no servidor: vínculo novo lança `central_join:<artistId>`, que paga uma vez na vida por central (seção 5), venha da 1l ou da 1d. Motivo: com a 1l sem pontos, quem escolheu a central na 1l nunca ganharia a entrada, e quem saísse e entrasse de novo ganharia; seria um prêmio por sair. Nas fixtures, a 1l continua sem pontos, para a demonstração da cliente ficar com os números do protótipo. Alternativa, se o dono preferir a 1l sem pontos: a `POST /me/artists` passa a lista vazia ao `planAwards` (uma linha), e fica o atalho de sair e entrar para ganhar os 10 uma vez. Pergunta para o dono.
4. **"Fãs" conta os membros da central no app.** Responde a pergunta do comentário de `src/domains/artists/types.ts`. Motivo: é o único número que o servidor mantém exato, e é o que o `has-fans` protege. Seguidores nas redes, se a cliente quiser mostrar, entram depois num campo próprio do painel, com outro rótulo. Pergunta para a cliente (UP-48).
5. **Capa em paisagem: a foto 3:4 recortada pelo topo.** O painel só guarda a foto 3:4. `coverUrl` é a `photo` (1200×1600), e a 1d a desenha com `contentPosition="top"`: aparece a faixa de cima da foto, onde fica o rosto num retrato, abaixo dos botões, e o nome fica sobre o degradê de baixo. A rota já lê um campo `cover` (paisagem, `ArtistImage`) antes da `photo`: uma capa própria no painel, se vier, não muda o app. Pergunta para a cliente: a capa pode ser a foto do perfil recortada, ou a equipe quer subir uma capa em paisagem? Sugestão para o painel, fora deste bloco: a dica do campo de foto pede o rosto no terço de cima.
6. **"Gestão oficial": campo opcional `managedByImagine` em `artists/{id}`, falso quando não existe.** O painel ainda não grava esse campo, então a pílula some nas centrais de verdade até ele ganhar a caixa "Gestão oficial Imagine". O seed marca as 4 do protótipo. Pergunta para a cliente: quais artistas têm a carreira gerida pela Imagine?
7. **"PTS DA CENTRAL" é a soma de `totalPoints` dos `centralPoints` daquela central, feita na leitura** (`sum()` no grupo de coleção). Troca a direção da seção 7 (`artistStats` pelo fechamento do dia). Motivo: é exato e na hora (o +10 de quem acabou de entrar aparece), não depende de função agendada (que o emulador não roda sozinho) e conta os ajustes, como a base do seed. Custo: uma leitura a cada 1.000 fãs com pontos na central, por abertura da 1d. Sinal para mexer: uma central passar de uns 20 mil fãs com pontos. Passo seguinte: o total em `artistStats/{artistId}` pelo fechamento do dia, como a seção 7 previa.
8. **Posição do fã numa central fica sem número até o bloco 8.** O servidor manda `fanRank: null`. Sem posição, as telas mostram os pontos que o servidor manda: a 1b mostra os pontos do fã na central no lugar do "você é #N" ("novo" só sem pontos), a 1e mostra "Sem posição ainda" com os pontos à direita, e o card "Você" do ranking de exemplo de uma central diz "Sem posição ainda" (19.13). O ranking de cada central (1f, top fãs e aba Ranking da 1d) continua de exemplo, com um aviso na tela. Motivo: posição de exemplo ao lado de número de verdade é a contradição da conferência de 05/10 (conta nova com "#12" e 0 ponto), e com as centrais reais ela piora ("#12 entre 1 fã"). Esconder os pontos criaria a contradição inversa: a Camila, com 4.120 pontos no Netto, apareceria como "novo" e leria "Ganhe pontos para entrar no ranking".
9. **Sair da central: rota `DELETE /me/centrals/:artistId` e, como padrão provisório, a sheet "Sair da central" no botão "Na central" da 1d.** O lugar definitivo depende do menu "mais" (pergunta da UP-48). Sair não tira pontos, e entrar de novo não paga a entrada outra vez.
10. **Central fora do ar (rascunho ou `unpublished`) não aparece e não aceita entrada.** Some da 1l, da busca, de "Suas centrais", dos chips e da 1d (404). O vínculo de quem já era fã continua, conta no `fanCount` e volta a aparecer quando a central é publicada de novo. Sair sempre pode, em qualquer status.
11. **Quem lê pelo painel:** o vínculo, que diz de quem cada fã é fã, só com a seção `fans`. Os shards do `fanCount`, ninguém pelo cliente: o painel não os usa (quem cuida das centrais vê o total em `artists/{id}`, e o `deleteArtist` soma no servidor). Motivo: menor acesso. Se o painel precisar deles, a regra abre com a seção `artists`.
12. **Ids das fixtures no formato do @.** `netto-brito`, `juninho-moraes`, `rock-salles` e `artista-N` viram `nettobrito`, `juninhomoraes`, `rocksalles` e `artistaN`, em todas as fixtures e testes do app. Motivo: no desenvolvimento com emulador, as centrais vêm da API, e o mural, a agenda, as missões e o ranking ainda vêm das fixtures. Com os ids antigos, tocar no autor de um post de exemplo abriria "Esta central não existe mais". Os ids novos também passam no `award` (seção 14).
13. **Quem sai continua no ranking da central com os pontos que fez nela.** O ranking da central (seção 10) consulta `centralPoints` por `artistId`, e sair não apaga esse documento (decisão 9). Padrão: o ranking conta quem pontuou na central na temporada, membro ou não. Motivo: é o que a consulta da seção 10 já faz, combina com "sair não tira pontos" e com o "PTS DA CENTRAL", que também soma quem saiu (19.7), e as fixtures já se comportam assim (o "você #12" no Netto continua depois de sair). Consequência para o bloco 8: o texto "#N entre {fanCount} fãs" da 1e (`profile.centrals.meta`) troca por um que não compare a posição com o número de membros, senão aparece "#12 entre 10 fãs". Alternativa, se o dono preferir só os membros: o bloco 8 grava `member` e `memberSince` em `wallets/{uid}/centralPoints/{artistId}` nas transações de entrar e sair (criando o documento zerado quando faltar), filtra o ranking por eles, e as fixtures tiram o fã do ranking da central de onde ele saiu. Não há carga de dados nesse caso: o app só chama a API nas builds depois do bloco 10 (seção 13), então não existe vínculo de verdade antes. Pergunta para o dono.

### 19.2 Rotas

| Método e caminho                | Grava | Função do app em `artists/api.ts` | Resposta                    |
| ------------------------------- | ----- | --------------------------------- | --------------------------- |
| `GET /artists`                  | não   | `fetchArtists`                    | `Artist[]`                  |
| `GET /artists/:artistId`        | não   | `fetchArtist`                     | `ArtistDetails`             |
| `GET /me/centrals`              | não   | `fetchFanCentrals`                | `FanCentral[]`              |
| `POST /me/artists`              | sim   | `followArtists`                   | `FollowArtistsResult`       |
| `PUT /me/centrals/:artistId`    | sim   | `joinCentral`                     | `JoinCentralResult`         |
| `DELETE /me/centrals/:artistId` | sim   | `leaveCentral` (novo)             | `LeaveCentralResult` (novo) |

Arquivos: `functions/src/api/routes/centrals.ts` (`centralRoutes`, somadas ao `API_ROUTES` depois das de `me.ts`) e o domínio em `functions/src/centrals/`, no molde de `functions/src/points`: `model.ts` (puro, com teste em tabela), `service.ts` (Firestore), `sync.ts` (o gatilho e a tarefa da fila), `seed.ts` e `index.ts`. Os tipos das respostas entram em `api/contract.ts`, espelho de `src/domains/artists/types.ts`.

As duas listas respondem um array, e não `Page<T>`: é o que o app já chama (`api.get<Artist[]>`), e são poucas centrais (o painel ordena até `REORDER_MAX`, 240).

Id na rota fora do formato do @ (`HANDLE_PATTERN`, fora dos ids `__.*__`) é 404 `artist_not_found` nas três rotas com `:artistId`, como o `parseArtistId` das callables: fora do formato, a central não existe. O `validate` da rota recusa.

Código novo: `artist_not_found`, 404, "Central não encontrada.", kind `notFound` no app. O núcleo das centrais recusa com `CentralError` (motivo `artist_not_found`, com `details`), e o `toApiHttpError` traduz, como já faz com o `PointsError`: o seed usa o mesmo núcleo fora da API.

#### `GET /artists`

Consulta `artists` com `where('status', '==', 'published')`, `orderBy('order')` e `limit(240)` (índice composto, 19.10). Uma leitura por central publicada.

```json
[
  {
    "id": "nettobrito",
    "name": "Netto Brito",
    "photoURL": "https://firebasestorage.googleapis.com/v0/b/.../thumb-1759600000000-480.webp?alt=media&token=...",
    "fanCount": 1,
    "order": 0
  }
]
```

- `photoURL`: o `thumb.url`, ou `null` sem foto (o card mostra o placeholder pelo id).
- `fanCount`: o de `artists/{id}`, inteiro e nunca negativo. Valor estranho vira 0, como o painel já lê.

#### `GET /artists/:artistId`

Lê em paralelo `artists/{id}`, `users/{uid}/centrals/{id}` e a soma de `totalPoints` no grupo `centralPoints` com `artistId == id` (19.7). Central que não existe ou não está publicada: 404 `artist_not_found`. Custo: 2 leituras, mais 1 a cada 1.000 fãs com pontos na central.

```json
{
  "id": "nettobrito",
  "name": "Netto Brito",
  "coverUrl": "https://.../photo-1759600000000-1200.webp?alt=media&token=...",
  "photoURL": "https://.../thumb-1759600000000-480.webp?alt=media&token=...",
  "verified": true,
  "managedByImagine": true,
  "fanCount": 1,
  "postCount": 0,
  "centralPoints": 4120,
  "isMember": true
}
```

- `coverUrl`: `cover.url` se o campo existir (decisão 5), senão `photo.url`, senão `null`.
- `photoURL`: `thumb.url` ou `null`.
- `verified` e `managedByImagine`: `true` só quando o campo é `true`.
- `fanCount`: o de `artists/{id}`; para quem é membro, o `memberFanCount` (abaixo).
- `postCount`: 0 até o mural (bloco 6).
- `centralPoints`: a soma; 0 quando ninguém pontuou na central, ou quando a soma falha por falta do índice (19.7).
- `isMember`: o vínculo existe.

**`fanCount` de quem é membro** (`memberFanCount(fanCount, fanCountAt, joinedAt)`, puro, em `centrals/model.ts`). A cópia em `artists/{id}` chega uns 10 a 20 s depois de cada mudança (19.6), e o app busca a página e as centrais logo depois de entrar (`refreshAfterJoin`): sem correção, a 1d mostraria "Na central" com "0 fãs", e a 1e "Sem posição ainda · 0 fãs". A rota já lê o vínculo: se o `fanCountAt` não existe ou é anterior ao `joinedAt`, a cópia ainda não contava o fã, e a rota soma 1; senão, usa a cópia, nunca abaixo de 1. Com o `fanCountAt` depois do `joinedAt`, a cópia já o incluía, ou, se a leitura caiu no meio da transação dele, fica 1 abaixo até a janela seguinte, e o mínimo de 1 evita o "0 fãs". Quem saiu não tem como ser descontado (o vínculo já sumiu): por até uns 20 s, a página pode contá-lo.

(Implementação, limite aceito) Pelo mesmo motivo, quem sai e entra de novo antes da cópia seguinte é contado duas vezes, só para ele: a cópia de antes da saída já o contava, e o vínculo novo tem o `joinedAt` depois dela. Exemplo: a cópia diz 5 e conta a fã; ela sai e volta antes da tarefa da janela; a página e "Suas centrais" dela dizem 6 até a cópia seguinte (uns 10 a 20 s), e o cache do app guarda o 6 até a próxima busca. Os outros fãs veem a cópia, sem a soma. Não é corrigido agora porque pede guardar a passagem anterior: um marcador de saída por fã e central (o `joinedAt` e o `leftAt` antigos), gravado no sair e lido na entrada, que grava no vínculo novo a cópia que já o contava, para o `memberFanCount` não somar 1 sobre ela. São uma gravação a mais por saída e uma leitura a mais por entrada, para um número errado por segundos, só para quem fez a troca. Se a cliente estranhar, o caminho é esse.

#### `GET /me/centrals`

Lê `users/{uid}/centrals` (até 240) e, num `getAll`, `artists/{id}` e `wallets/{uid}/centralPoints/{id}` de cada uma. Fica de fora a central que não existe ou não está publicada (decisão 10). Ordem: `joinedAt` crescente, depois o `order` da central, depois o id. Fã sem vínculo: `[]`. Leitura não exige perfil (seção 1).

```json
[
  {
    "artistId": "nettobrito",
    "name": "Netto Brito",
    "shortName": null,
    "photoURL": null,
    "fanCount": 1,
    "fanRank": null,
    "seasonPoints": 4120
  }
]
```

- `shortName`: o do painel, ou `null`.
- `fanCount`: o `memberFanCount`, com o `joinedAt` de cada vínculo (todas são centrais de que o fã é membro).
- `fanRank`: `null` até o bloco 8 (decisão 8), que o preenche pela contagem da seção 10.
- `seasonPoints`: o `seasonPoints` do `centralPoints` quando o `seasonId` dele é o da temporada da configuração (cache de 60 s, como no `/me/wallet`), e 0 no resto.

#### `POST /me/artists`

Corpo `{ "artistIds": ["nettobrito", "nenho", "juninhomoraes"] }`. Validação: lista de 1 a 50 textos (`FOLLOW_MAX`), sem repetir, cada um no formato do @. Fora disso, 400 `invalid_request` com `details: { field: 'artistIds' }`. Alguma central que não existe ou não está publicada: 404 `artist_not_found` com `details: { artistIds: [...] }`, e nada é gravado (tudo ou nada, como as fixtures).

```json
{ "followedArtistIds": ["nettobrito", "nenho", "juninhomoraes"], "pointsAwarded": 30 }
```

- `followedArtistIds`: todas as centrais publicadas que o fã segue depois da ação, na ordem do `/me/centrals`.
- `pointsAwarded`: soma dos `central_join` pagos agora (campo novo, opcional no app). Central que o fã já seguia não paga e não conta de novo.

#### `PUT /me/centrals/:artistId`

Sem corpo. Responde `{ "artistId": "nenho", "pointsAwarded": 10 }`. Quem já está na central recebe `pointsAwarded: 0`, e nada muda. Central fora do ar: 404.

#### `DELETE /me/centrals/:artistId`

Sem corpo. Responde `{ "artistId": "nenho" }`. Sem vínculo, é sucesso sem efeito: sair duas vezes dá o mesmo resultado. Vale em qualquer status da central (decisão 10).

As três que gravam exigem `Idempotency-Key`, rodam no `runIdempotent` com o `requireFan` (perfil exigido, atividade marcada) e respondem 200.

### 19.3 Coleções e campos

```
users/{uid}/centrals/{artistId} {
  uid: string
  artistId: string
  via: 'onboarding' | 'page' | 'seed'   // POST /me/artists, PUT /me/centrals/:id ou o seed
  joinedAt: Timestamp                    // o "agora" do pedido
  schemaVersion: 1
}

artistStats/{artistId}/fanShards/{0..15} {
  count: number          // soma de +1 e -1; um shard sozinho pode ficar negativo, só a soma vale
  updatedAt: Timestamp
}
```

- O vínculo nasce com `tx.create` e sai com `tx.delete`. Ninguém grava pelo cliente.
- `FAN_SHARD_COUNT = 16`. O shard é `award.shard % 16`: o mesmo sorteio do shard do painel, feito de novo a cada tentativa da transação. Gravação sem leitura: `tx.set(ref, { count: FieldValue.increment(1), updatedAt }, { merge: true })` (ou `-1`). O documento `artistStats/{artistId}` em si não é criado neste bloco; o nome fica para o total que a seção 7 previa.
- `artists/{id}`, o que a API lê: `name`, `shortName`, `photo`, `thumb`, `order`, `status`, `verified` e `fanCount`, mais os opcionais `managedByImagine` e `cover` (decisões 5 e 6). A tarefa `syncArtistFanCount` grava `fanCount` e um campo novo, `fanCountAt` (o instante da leitura dos shards copiada, 19.6), sem tocar no `updatedAt`, que é o carimbo das edições da equipe. O tipo `Artist` de `functions/src/artists/service.ts` ganha `fanCountAt?: Timestamp | null` e `managedByImagine?: boolean`, como documentação. As callables não mexem nesses campos, e o `createArtist` continua com `fanCount: 0`.
- Contrato, no app e no `contract.ts`: `Artist`, `ArtistDetails`, `FanCentral` e `JoinCentralResult` como estão; `FollowArtistsResult` ganha `pointsAwarded?: number`; novos `LeaveCentralVariables { artistId, idempotencyKey }` e `LeaveCentralResult { artistId }`. O comentário de `fanCount` passa a dizer "membros da central no app" (decisão 4), e o do topo de `types.ts` deixa de chamar o contrato de provisório para as centrais.

### 19.4 Transações passo a passo

A ordem é a de sempre (seção 5): chave e fã (`runIdempotent`), leituras do domínio, `planAwards`, gravações do domínio. Depois, o `runIdempotent` grava o plano e a chave.

O núcleo da entrada fica em `centrals/service.ts`, em duas partes, usadas pelas duas rotas de entrada e pelo seed:

- `readJoin(tx, db, uid, artistIds)`: um `getAll` com `artists/{id}` e `users/{uid}/centrals/{id}` de cada id. Devolve as centrais lidas e o conjunto de quem já é membro.
- `joinCentrals(tx, db, read, { fan, award, artistIds, via })`:
  1. Central que não existe ou não está publicada: `CentralError('artist_not_found', { artistIds })`. Nada foi gravado.
  2. Novas: as publicadas sem vínculo. (Implementação) Com alguma nova e o fã como ator, o teto do dia: com o `central_entry` do dia na carteira lida em `CENTRAL_ENTRIES_PER_DAY` (30), recusa com `CentralError('too_many_entries')`, antes de gravar (19.5).
  3. `planAwards(tx, db, [{ uid, fan, entries }], award)`, com uma entrada por central nova: `{ kind: 'earn', source: 'central_join', eventId: artistId, artistId, subject: { type: 'artist', id: artistId } }`. Sem novas, a lista vai vazia (fica só a atividade). O `planAwards` lê a temporada, o extrato `central_join:<id>` e o `centralPoints/<id>` de cada nova.
  4. Para cada nova: `tx.create` do vínculo (`joinedAt` é o `award.now`); `+1` no shard `award.shard % 16`; `joined: 1` dela no shard do painel (`addMembershipCounts`, 19.9). (Implementação) Com alguma nova, `+1` no `central_entry` do dia na carteira do fã (`addDailyCount`, em `points/award.ts`, que faz o plano gravar a carteira mesmo sem lançamento).
  5. Devolve o plano e as novas.

`PUT /me/centrals/:artistId`: `readJoin` com `[artistId]` e `joinCentrals` com `via: 'page'`. Responde `{ artistId, pointsAwarded: plan.pointsAwarded }`.

`POST /me/artists`: em vez do `readJoin`, lê a subcoleção inteira do fã (`tx.get` da consulta, até 240) e faz um `getAll` dos `artists/{id}` das pedidas e das já seguidas, tudo antes de gravar (`readFollow`). (Implementação) O mesmo `getAll` lê o vínculo das pedidas que a lista não trouxe: com mais de 240 vínculos, uma pedida já seguida ficaria de fora da lista, o `tx.create` do vínculo cairia com `ALREADY_EXISTS` nas duas rodadas e o pedido daria 500. Monta o mesmo retorno do `readJoin` e chama `joinCentrals` com `via: 'onboarding'`. Responde `followedArtistIds` (as de antes mais as novas, só as publicadas, na ordem do `/me/centrals`) e `pointsAwarded`.

`DELETE /me/centrals/:artistId` (`leaveCentral` em `centrals/service.ts`):

1. Lê `users/{uid}/centrals/{artistId}`.
2. `planAwards` com a lista vazia: não lê nada e leva a atividade de quem chama.
3. Com vínculo: `tx.delete` dele, `-1` no shard `award.shard % 16` e `left: 1` no shard do painel. Sem vínculo, nada.
4. Responde `{ artistId }` com o plano.

Sair não lança ponto e não mexe em `centralPoints` nem no extrato. Voltar depois cria o vínculo de novo, e o `central_join:<id>` sai `duplicate`, com 0 ponto.

Custo de entrar numa central nova: as 6 leituras e 5 gravações de uma ação com ponto (seção 5), mais 2 leituras (central e vínculo) e 2 gravações (vínculo e shard do `fanCount`), e depois o gatilho e a fila (19.6). Na 1l com 3 centrais, uma transação com 3 lançamentos, 3 `centralPoints`, 3 vínculos e 3 shards, abaixo de 20 gravações. Com 50 centrais, perto de 210 gravações, abaixo do limite de 500.

Concorrência: dois pedidos do mesmo fã para a mesma central (a 1l e o "Entrar" da 1d, com chaves diferentes) disputam o vínculo; um repete, acha o vínculo e não paga de novo. Muitos fãs entrando na mesma central gravam em 16 shards, e todos leem `artists/{id}` na transação. Por isso a cópia do `fanCount` vai por fila (19.6): se o documento fosse gravado a cada entrada, cada gravação disputaria com as entradas que o estão lendo, e o teto da central seria o de um documento só, perto de 1 gravação por segundo, com os shards sem ajudar. Com no máximo uma gravação a cada 10 s, a leitura não pesa, e o teto fica nos shards: perto de 16 entradas por segundo na mesma central, sustentadas. Sinal: `unavailable` nos logs da `api` nessas rotas. Primeiro passo: subir `FAN_SHARD_COUNT`, porque quem soma lista a subcoleção e nunca supõe o número.

A leitura de `artists/{id}` fica dentro da transação de propósito: é ela que põe em ordem a entrada e o `deleteArtist` ou o `setArtistStatus` da mesma central, que gravam nesse documento. Central apagada ou tirada do ar no meio de uma entrada não recebe o vínculo.

### 19.5 Idempotência e o evento de pontos

- Pedido: a `Idempotency-Key` de sempre. O app já manda na 1l (`useFollowArtistsMutation`) e na 1d (`useJoinCentralMutation`), e o sair também manda (19.13).
- Negócio: o lançamento `central_join:<artistId>` paga uma vez na vida por fã e central (seção 5). O vínculo é idempotente por existir ou não: entrar quem está dentro e sair quem está fora não mudam nada, nem o `fanCount`.
- Valor e limite: `config/points.values.central_join` (padrão 10) e `dailyLimits.central_join` (padrão 10 por dia). Na 1l com mais de 10 centrais, as que passam do limite entram sem ponto, e o evento pode pagar depois, uma vez, se o fã sair e entrar (seção 5, limites diários).
- **Teto de entradas por dia** (implementação, da revisão do bloco 4). Sem ele, um script com uma conta de fã alterna `PUT` e `DELETE` com chaves novas, sem ganhar ponto, e cada troca grava o vínculo, os shards do `fanCount` e do painel e uma chave de idempotência de 30 dias, dispara o gatilho e o Cloud Tasks, e soma `joined` e `left` nos fluxos que a Visão geral e o Crescimento vão ler (bloco 11). Regra: cada pedido que cria vínculo (o `PUT` da 1d ou o `POST` da 1l, um só com as centrais que trouxer) soma 1 em `days[dia].count.central_entry` da carteira, na mesma transação; com `CENTRAL_ENTRIES_PER_DAY` (30, em `centrals/model.ts`) no dia de São Paulo, o pedido que criaria vínculo é recusado com 429 `too_many_requests` (`details: { limit }`, `Retry-After` até a meia-noite de São Paulo), antes de gravar nada. Pedido que não cria vínculo (o fã já está em todas) não conta nem é recusado. Sair nunca é recusado nem conta: as saídas ficam presas às entradas (sair sem vínculo não grava nada). O seed (ator de sistema) não conta. Nenhum fã de verdade chega perto: são 30 entradas num dia, uma a uma. No app, o 429 é o kind `unknown` (o erro genérico de entrar, e a tentativa seguinte leva chave nova). Custo: a volta a uma central passa a gravar a carteira (antes, a entrada que não pagava não a gravava). Se o painel quiser ajustar o número, ele vai para `config/points`, ao lado dos limites diários. Os outros toques que se desfazem (curtir e descurtir, "Eu vou" e desfazer, no bloco 6) têm o mesmo risco e decidem o teto deles lá.

### 19.6 `fanCount`: shards, o gatilho e a fila `syncArtistFanCount`

Duas funções em `centrals/sync.ts`, exportadas em `functions/src/index.ts` depois do `setGlobalOptions` (região `southamerica-east1`). Sem dependência nova: `onDocumentWritten` (`firebase-functions/firestore`), `onTaskDispatched` (`firebase-functions/tasks`) e `getFunctions().taskQueue` (`firebase-admin/functions`) vêm dos pacotes que já estão no `functions/package.json`.

**Gatilho `queueArtistFanCountSync`:** `onDocumentWritten('artistStats/{artistId}/fanShards/{shard}', { retry: true })`. Não lê nada: põe na fila a tarefa da janela da gravação.

- `fanCountSyncTask(artistId, eventTime)`, puro, em `centrals/model.ts`: janela `w = floor(eventTime / 10 s)`, id `fancount-<artistId>-<w>` e `scheduleTime` 1 s depois do fim da janela (`(w + 1) × 10 s + 1 s`). O `eventTime` é o `event.time` (o instante da gravação), não o relógio da execução: uma entrega repetida do mesmo evento cai na mesma janela e no mesmo id.
- `getFunctions().taskQueue('locations/southamerica-east1/functions/syncArtistFanCount').enqueue({ artistId }, { id, scheduleTime })`. Sem a região no nome, o firebase-admin procura a fila em `us-central1`.
- Id repetido (`functions/task-already-exists`): a tarefa da janela já está na fila ou já rodou, e nesse caso rodou depois desta gravação (roda depois do fim da janela, e a gravação é de dentro dela). Ignora. A fila recusa o id até cerca de 1 h depois de a tarefa rodar; uma entrega mais atrasada que isso cria outra tarefa, que só recalcula.
- Outro erro: lança, e o gatilho repete (`retry: true`). `artistId` fora do formato do @ (erro de programação): `logger.error`, sem lançar, para não repetir para sempre.

Toda mudança de uma central numa janela de 10 s vira uma tarefa só, que roda no fim da janela e vê todas elas.

**Tarefa `syncArtistFanCount`:** `onTaskDispatched({ retryConfig: { maxAttempts: 5, minBackoffSeconds: 10 } }, ...)`. Confere o `artistId` (fora do formato: `logger.error` e termina sem erro, para a fila não tentar de novo) e chama `syncFanCount(db, artistId)`:

1. Lê a subcoleção `artistStats/{artistId}/fanShards` fora de transação, para não travar os shards que as entradas gravam. `sum` é a soma dos `count`, e `readTime` é o instante da leitura (o `readTime` do resultado da consulta). Soma abaixo de 0: `logger.error` com o id, e vale 0. Nunca grava número negativo.
2. Numa transação, lê `artists/{artistId}`. Central que não existe (apagada; apagar os shards também dispara o gatilho): não grava nada.
3. Copia para `artists/{id}` (`fanCount: sum`, `fanCountAt: readTime`) quando `shouldCopyFanCount(shownAt, readTime)`, puro, em `centrals/model.ts`: a leitura é mais nova que a última cópia (`fanCountAt` ausente ou anterior ao `readTime`). (Implementação) Os instantes são comparados com a precisão do Firestore, em microssegundos (`exactMillis`, em ms com fração), e o `fanCountAt` guarda o `readTime` inteiro: com o `toMillis`, duas leituras no mesmo milissegundo, a segunda já com uma entrada nova, deixariam a cópia velha. Duas execuções quase juntas (uma nova tentativa, uma entrega atrasada) podem terminar fora de ordem, e a de leitura mais nova vence. Copia mesmo com o número igual (uma entrada e uma saída na mesma janela): o `fanCountAt` precisa passar o `joinedAt` de quem entrou, senão a API somaria 1 a mais para esse fã (`memberFanCount`, 19.2).
4. Recalcula tudo a cada vez, então repetir é seguro. Erro passageiro lança, e a fila tenta de novo. Se as 5 tentativas acabarem (`logger.error` na última), a próxima mudança da central põe outra tarefa na fila, e o fechamento do dia (bloco 11) passa a acertar o `fanCount` de todas as centrais.

Resultado: o `fanCount` de `artists/{id}` fica uns 10 a 20 s atrás de cada mudança, em qualquer tamanho de central, e sempre fecha. O documento recebe no máximo uma gravação a cada 10 s por central (mais as novas tentativas). Não há diferença mínima nem intervalo mínimo para copiar.

Custo por entrada ou saída: uma execução do gatilho e uma chamada ao Cloud Tasks, quase sempre recusada como repetida. Por janela de 10 s com mudança, uma tarefa com até 17 leituras e uma gravação. O Cloud Tasks só cobra acima de 1 milhão de operações por mês.

Emulador: o firebase-tools 15.32 sobe o emulador do Cloud Tasks junto com o de Functions, sem mudança no `firebase.json` nem nos scripts, e liga o firebase-admin a ele (`CLOUD_TASKS_EMULATOR_HOST`). Ele ignora o `scheduleTime` (roda a tarefa na hora) e nunca libera um id usado: com o id da janela, a segunda mudança da mesma janela nunca seria copiada. Por isso, com `FUNCTIONS_EMULATOR === 'true'`, o gatilho enfileira sem id e sem `scheduleTime`, uma tarefa por gravação, na hora. Os testes nos emuladores passam pela fila de verdade; a janela e o id ficam no teste do `fanCountSyncTask`.

Primeiro deploy: é o primeiro gatilho do Firestore e a primeira fila de tarefas do projeto. O deploy liga a API do Cloud Tasks e pode falhar uma vez pelas permissões do agente do Eventarc; repetir resolve, como no primeiro deploy das funções. Confira no log do gatilho que o enfileiramento passa. Com permissão negada, a conta de serviço das funções precisa criar tarefas (`roles/cloudtasks.enqueuer`) e agir como a conta que assina a chamada da tarefa (`roles/iam.serviceAccountUser`). Até o papel entrar, o gatilho repete, e as mudanças pendentes passam depois.

### 19.7 "PTS DA CENTRAL"

```ts
db.collectionGroup('centralPoints')
  .where('artistId', '==', artistId)
  .aggregate({ total: AggregateField.sum('totalPoints') })
  .get();
```

O `totalPoints` é o de sempre da central: entram ganho fora de temporada e ajuste, e ele não cai quando o fã sai da central. Cai quando o fã exclui a conta, porque a carteira some. Sem cache no bloco 4. Índice composto no grupo (19.10). O emulador não exige índice nenhum, então a falta dele só aparece em produção: a consulta falha com o código 9 (`FAILED_PRECONDITION`), com o link para criar o índice na mensagem, e o `toApiHttpError` responderia 500, derrubando a 1d inteira por um número auxiliar. Por isso a soma (`sumCentralPoints`, em `centrals/service.ts`) captura só o código 9: `logger.error` com o id da central e a mensagem (que traz o link), e `centralPoints: 0`. Qualquer outro erro segue para o 500 de sempre. Se a produção pedir um índice diferente do de 19.10, ele entra no `firestore.indexes.json` pelo link do log. O `GET /artists` não tem essa saída: sem o índice dele, a lista é o conteúdo da 1l, e o 500 mostra o "Tentar de novo". A ordem do deploy em 19.16 evita os dois casos.

### 19.8 Efeitos no painel

- **Artistas:** a coluna "Fãs" e o diálogo da central leem `artists/{id}.fanCount` e passam a mostrar os membros de verdade, uns 10 a 20 s depois de cada entrada e saída, sempre exato depois disso (19.6). Nenhuma mudança no código do painel. O painel escuta a coleção `artists` inteira em tempo real (`onSnapshot` em `imagineup-admin/src/lib/artist-data.ts`), e cada gravação de `artists/{id}` custa 1 leitura por aba aberta. Com a cópia no máximo uma vez a cada 10 s por central, são no máximo 6 leituras por minuto por central com movimento, por aba. Copiar a cada entrada custaria uma leitura por aba a cada fã que entra, o tipo de leitura que a seção 7 evita.
- **Apagar central:** o `deleteArtist` recusa com `has-fans` pela soma dos shards (19.11), mesmo quando o número da tela ainda não chegou, e aceita quando a soma é 0, mesmo com a cópia ainda em 1. A lixeira do painel segue o `fanCount` copiado (`deleteBlockedText` em `imagineup-admin/src/lib/artists.ts`, desligada com `fanCount > 0`): depois de o último fã sair, ela liga quando a fila copiar o 0.
- **Visão geral e Crescimento** (bloco 11): `joined` e `left` por central e no total, nos `statsShards` (19.9).
- **Fãs** (bloco 11): as centrais de um fã (`users/{uid}/centrals`) e os fãs de uma central (grupo `centrals` por `artistId`), com a seção `fans`.
- **Campos novos**, quando as perguntas fecharem: "Gestão oficial Imagine" (`managedByImagine`) e a capa em paisagem (`cover`). As callables `createArtist` e `updateArtist` ganham esses campos, com auditoria, no bloco do painel.

### 19.9 Agregados do painel

- `ShardDelta` (`points/stats.ts`) ganha `totals.joined` e `totals.left`, e cada `byArtist[id]` ganha `joined` e `left`.
- `addMembershipToShard(delta, artistId, 'joined' | 'left')` soma 1. `addMembershipCounts(plan, changes)`, em `points/award.ts`, cria o `plan.shard` quando ele veio `null` e soma. O `applyAwards` grava no mesmo shard do dia: continua uma gravação por transação. Contador zerado não é gravado (`pruneZeros`).
- São fluxo (o que o fã fez no dia). A exclusão de conta não conta como `left` (seção 12). O estoque é o `fanCount`.
- (Implementação) Os fluxos contam ações, e não fãs: o mesmo fã que entra e sai duas vezes no dia soma 2 `joined` e 2 `left`. O teto de entradas (19.5) limita isso a 30 pedidos de entrada por fã e dia, e as saídas a essas entradas mais as centrais que ele já seguia. Se o bloco 11 quiser fãs únicos por dia, conta por um marcador por fã, central e dia, e não pelos fluxos.
- `joined - left` não é o número de membros, e o painel nunca calcula membros pelos fluxos: a exclusão de conta tira o fã do `fanCount` sem fluxo nenhum. Membros de uma central, hoje ou num dia passado, são o `fanCount` (o de hoje) ou um retrato guardado pelo fechamento do dia, se o bloco 11 quiser a série. Se o bloco 11 quiser contar as exclusões por central, o `leaveAllCentrals` soma um `removed` por central no shard do dia (fluxo novo, sem uid, sem reescrever dia nenhum). Não entra agora porque ninguém lê esses fluxos antes do bloco 11, e não há dado de verdade a perder: o app só chama a API nas builds depois do bloco 10 (seção 13).

### 19.10 Regras e índices

Acréscimo ao `firestore.rules`. Nenhuma regra existente muda; o bloco do vínculo entra dentro do `match /users/{uid}` que já existe, e os outros antes do `match /{document=**}` final.

```
    match /users/{uid} {
      // (regras de hoje do perfil)

      // Vínculo do fã com as centrais: só o servidor grava (API). O fã não lê
      // nem o próprio: chega pela API (/me/centrals, isMember). A equipe com a
      // seção fans lê (seção Fãs do painel).
      match /centrals/{artistId} {
        allow read: if canSeeSection('fans');
        allow write: if false;
      }
    }

    // Os fãs de uma central, pelo grupo de coleção (seção Fãs do painel).
    // Vale para qualquer caminho que termine em centrals/{id}, inclusive uma
    // coleção de raiz: nenhuma outra coleção pode se chamar centrals.
    match /{path=**}/centrals/{artistId} {
      allow read: if canSeeSection('fans');
    }

    // Contagem de fãs de cada central, em shards. Só o servidor lê e grava.
    // O número que o app e o painel mostram é o fanCount de artists/{id},
    // copiado daqui pela fila syncArtistFanCount.
    match /artistStats/{artistId} {
      allow read, write: if false;

      match /fanShards/{shard} {
        allow read, write: if false;
      }
    }
```

A regra de grupo é a única que alcança a consulta `collectionGroup('centrals')` do painel, e ela vale para qualquer coleção chamada `centrals`, em qualquer profundidade. Conferir `resource.data.uid` ou `resource.data.artistId` nela não resolve: regra não é filtro, e a consulta do painel (`where('artistId', '==', id)`) não prova o `uid`, então seria recusada inteira. Fica a regra de nome: nenhuma outra coleção ou subcoleção se chama `centrals`, e o teste de regras trava o caso de uma coleção de raiz (19.15). O bloco `artistStats` fechado repete o `match /{document=**}` final de propósito, como o `statsMeta`: deixa escrito que é do servidor e onde abrir, com a seção `artists`, se o painel um dia precisar dos shards.

Índices novos em `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "artists",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "order", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "centralPoints",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "artistId", "order": "ASCENDING" },
        { "fieldPath": "totalPoints", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": [
    {
      "collectionGroup": "centrals",
      "fieldPath": "artistId",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "DESCENDING", "queryScope": "COLLECTION" },
        { "arrayConfig": "CONTAINS", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
  ]
}
```

Os de hoje ficam. O primeiro serve ao `GET /artists`; o segundo, à soma do "PTS DA CENTRAL" (e o bloco 8 acrescenta os do ranking da central no mesmo grupo); o terceiro, à lista dos fãs de uma central no painel (bloco 11). Um `fieldOverride` troca os índices padrão do campo, por isso os três de coleção vêm escritos.

O emulador não exige índice, então nenhum teste pega a falta deles. Em produção, sem os dois primeiros, a consulta falha com o código 9: o `GET /artists` responde 500, e o "PTS DA CENTRAL" vira 0 com log de erro (19.7). Por isso os índices sobem antes da `api` e terminam de montar antes de ela ir ao ar (ordem em 19.16).

### 19.11 `deleteArtist` coerente

O `removeArtist` (`functions/src/artists/service.ts`) lê, na transação e antes de gravar, a consulta `artistStats/{id}/fanShards`. O número que decide é a soma dos shards (nunca abaixo de 0) quando há shard, e o `fanCount` de `artists/{id}` quando não há nenhum (central de antes do bloco 4, ou os testes de hoje, que gravam só o `fanCount`): `shards.empty ? fanCount : max(0, soma)`. O `deleteProblem` recebe esse número, sem mudar, e recusa com `has-fans` quando ele passa de 0. Quando apaga, apaga também cada shard, até 16 gravações a mais (o gatilho dispara, e a tarefa acha a central apagada e não grava). Para o painel, o comportamento é o mesmo: central com fãs sai do ar em vez de sumir.

Por que a soma, e não `max(fanCount, soma)`: a cópia pode ficar para trás (a última tarefa da central falhou em todas as tentativas). Numa central fora do ar e sem fãs, ninguém mais entra nem sai, então nada põe outra tarefa na fila, e o `max` recusaria para sempre uma central que pode ser apagada. A lixeira do painel ainda segue a cópia (19.8); esse resto, raro, fica para o fechamento do dia do bloco 11, que acerta o `fanCount`.

Os testes de hoje continuam verdes (`fanCount > 0` sem shards recusa). Testes novos: soma 1 com `fanCount` 0 (cópia atrasada) recusa; soma 0 com `fanCount` 1 (cópia atrasada ou perdida) apaga a central e os shards; soma 0 com `fanCount` 0 apaga os shards.

Caso raro, registrado: o @ de uma central apagada pode ir para outra central. Os `centralPoints` e os `central_join` antigos dos fãs continuam com esse id, então a central nova herda o "PTS DA CENTRAL", e quem entrou na antiga não ganha a entrada de novo.

### 19.12 Exclusão de conta

`deleteUserData` (`functions/src/store.ts`), na ordem nova:

1. Reservas de @, como hoje.
2. Novo: só o documento `users/{uid}` (`delete()`, sem as subcoleções). Daqui em diante nenhuma gravação da API passa (`requireFan`). Uma entrada que já tinha lido o perfil termina antes, porque a transação dela segura a leitura, e o vínculo dela aparece no passo 3.
3. Novo: `leaveAllCentrals(db, uid)`, em `centrals/service.ts`. Lista `users/{uid}/centrals` em páginas de 200 e, por página, abre uma transação que relê os vínculos e, para cada um que ainda existe, faz `tx.delete` e `-1` num shard sorteado. Não grava `statsShards` (seção 12).
4. `recursiveDelete(users/{uid})`, para o resto das subcoleções.
5. Carteira, chaves de idempotência e `staff/{uid}`, como hoje.

(Implementação) `functions/src/store.test.ts` prende essa ordem com um Firestore falso que anota cada passo: nos emuladores, as entradas terminam antes da exclusão, e a ordem trocada passaria em todas as suítes.

Por que o perfil sai antes: o `recursiveDelete` apaga o documento do perfil por último. Se ele continuasse no passo 2, uma entrada no meio da exclusão criaria um vínculo depois da listagem, o `recursiveDelete` o levaria sem descontar, e o `fanCount` ficaria 1 acima para sempre. Repetir é seguro (o gatilho de exclusão tem `retry: true`): a transação relê o vínculo, e o que já saiu não desconta de novo. A fila `syncArtistFanCount` acerta o `fanCount` de cada central, que nunca fica negativo (19.6). Os agregados do painel não recebem fluxo da exclusão (19.9).

### 19.13 App

**Seletor e leitura**

- `SERVER_DOMAINS` ganha `artists`, no commit que entrega as rotas. Com o emulador, as centrais vêm da API; nas builds, das fixtures, como hoje.
- `useArtistsQuery`, `useFanCentralsQuery` e `useArtistQuery` espalham `queryOptionsFor('artists')` (rede e disco, seção 13).
- `api.ts` ganha `leaveCentral({ artistId, idempotencyKey })`, com `api.delete('/me/centrals/<id>', { headers: { 'Idempotency-Key': ... } })` e a fixture `followFixture.leave`.
- No modo API, `fetchArtist` troca o `postCount` pelo número de posts de exemplo da central enquanto `sourceOf('posts') === 'fixtures'`, com `countArtistPostsFixture(fixtureNow(), artistId)`, novo em `posts/fixtures.ts` e importado direto do arquivo (o `posts/fixtures.ts` não importa `artists`, então não há ciclo). Assim o "N posts" da 1d bate com a grade do Mural, que ainda é de exemplo. O bloco 6 tira a troca.
- Nenhuma posição de exemplo entra no `/me/centrals` (decisão 8).

**Mutações e invalidação**

- `useFollowArtistsMutation`: no sucesso, com `pointsAwarded > 0`, invalida também `profileKeys.wallet()` e `rankingKeys.all`. No erro `notFound` (central que saiu do ar entre a lista e o toque), invalida `artistKeys.list()`. A 1l tira da escolha os ids que sumiram da lista, com a ação nova `retain(ids)` do store `useArtistSelection`, chamada quando a lista muda, e mostra o erro de sempre.
- `useJoinCentralMutation`: o otimista soma 1 ao `fanCount` da página junto com o `isMember: true` (e a central que entra em "Suas centrais" leva esse número, pelo `centralOf`), e o erro desfaz os dois. Sem isso, a 1d mostraria "Na central" com "0 fãs" enquanto o pedido vai. O `refreshAfterJoin` já invalida as centrais, a página, o mural da home e, com pontos, a carteira e o ranking; a página e as centrais voltam com o `memberFanCount` (19.2), que já conta o fã. (Implementação) Recusa `notFound` (a central saiu do ar com a página aberta): além de desfazer, a página e as centrais buscam de novo, e a 1d mostra "Esta central não existe mais."; o toque de erro fica, e o anúncio "Tente de novo" sai, porque tentar de novo daria 404 para sempre. A 1d trata o 404 de uma busca de novo como central que sumiu (o `artistFailed` vale também com a página na tela), e não como "Não deu para atualizar". A entrada restaurada do disco, sem o hook e sem o contexto do otimista, que falha faz a página e as centrais buscarem de novo em qualquer erro (`onError` do `registerArtistMutationDefaults`).
- `useLeaveCentralMutation(artistId, { onLeft?, onError? })`, novo em `artists/queries.ts` e exportado pelo index (os dois retornos são da sheet: fechar e anunciar, ou o toque de erro e o anúncio). Não é otimista e não entra na fila offline (`networkMode: 'always'`, `retry: false`), como o resgate: o fã confirma numa sheet e espera o resultado. A chave de idempotência é a da tentativa: a mesma depois de falha incerta, nova depois de recusa (`isUncertain`, como no join). No sucesso: `isMember: false` na página (`setMember`), a central sai de `artistKeys.centrals()`, e as centrais, a página e `postKeys.feed()` buscam de novo. Carteira e ranking ficam, porque sair não muda ponto. A página buscada de novo pode contar o fã por até uns 20 s (19.2); sem desconto local, que a busca desfaria. (Implementação) O `onLeft` e o `onError` da sheet só rodam com o hook montado (`mounted`, como no join e no resgate): os dois são passados ao `useMutation`, e o TanStack os chama mesmo depois de a tela desmontar. A resposta que chega com a sheet já fechada só anuncia o resultado (com o toque de erro na falha), sem o `router.back()` da sheet, que tiraria a 1d da pilha.

**Telas**

- **1l:** lê `/artists` (só as publicadas, na ordem). O mínimo vira `min(MIN_ARTISTS, total publicado)` (`minimumArtists`), também no subtítulo e na dica; com uma central só, o botão diz "Continuar com 1 artista" (`onboarding.chooseArtists.continueOne`, implementação) e a dica "Escolha pelo menos 1 artista." (`needMoreHint`, em `onboarding/selection.ts`). Sem nenhuma publicada, o `useArtistsLoad` trata a lista vazia como erro de carregar ("Tentar de novo"); isso não acontece com o seed, e a API só vai para as builds com as centrais da cliente no ar (UP-2). O card diz "1 fã" no singular.
- **1b e 1e ("Suas centrais"):** leem `/me/centrals`, sem posição até o bloco 8 (decisão 8). Na 1b, o card sem posição mostra os pontos da temporada do fã na central, em lima ("4.120 pts", lido como "Netto Brito, 4.120 pontos na temporada"), no lugar do "você é #N"; "novo" fica só para quem não tem ponto nela. Na 1e, "Sem posição ainda · N fãs" (com "1 fã" no singular), e os pontos à direita sempre que passam de 0, também sem posição; o rótulo de acessibilidade diz os pontos. A regra mora no `central-card.tsx` e no `central-row.tsx` (hoje o primeiro mostra "novo" e o segundo esconde os pontos quando `fanRank` é `null`).
- **1d:** lê `/artists/<id>`. A capa passa `contentPosition="top"` ao `RemoteImage` (decisão 5). "Entrar na central" fica como está. O "Na central" deixa de ser `readOnly` e abre a sheet de sair. Ele volta a ser `readOnly` enquanto houver entrada dessa central pendente ou pausada: `useIsMutating({ mutationKey: artistMutationKeys.join, predicate: (m) => joinArtistIdOf(m.state.variables) === artistId }) > 0`, com `joinArtistIdOf` lendo o `artistId` das variáveis sem supor o tipo (implementação: o hook `useIsJoinPending(artistId)`, em `artists/queries.ts`). O `isPending` do hook da página não basta: ele é do hook, e com a página reaberta não vê a entrada pausada na fila offline nem a que voltou do disco. Sem a trava, o sair chegaria antes da entrada (sem efeito), a entrada recriaria o vínculo depois, e a tela voltaria a "Na central". O `useIsMutating` conta as mutações com `status: 'pending'`, o que inclui as pausadas e as restauradas do disco. Rótulo de acessibilidade "Você está na central de {{name}}" e dica "Abre a opção de sair da central". O comentário do `ArtistActions` e a seção Acessibilidade do `CLAUDE.md`, que citam o "Na central" como estado, mudam junto.
- **1f:** os chips vêm de `/me/centrals` (e o do link `?artista=`, da lista `/artists`). O ranking de cada chip continua de exemplo, com o aviso abaixo.

**Sheet "Sair da central" (provisória, UP-48)**

- Rota `src/app/sair-da-central/[artistaId].tsx`, só com o `export default` de `LeaveCentralSheetScreen`, de `@/domains/artist-page`. Entra na pilha raiz, no guard de quem já entrou, com as opções do `convidar`: `presentation: 'formSheet'`, `sheetAllowedDetents: 'fitToContents'`, `sheetGrabberVisible: true`, `sheetCornerRadius: radii.sheet` e fundo `colors.surface`. O "Na central" faz `router.push({ pathname: '/sair-da-central/[artistaId]', params: { artistaId } })`.
- No visual do "Gerar meu link": `SheetGrabber` no Android, o título "Sair da central?" com o fechar (`BackButton variant="close"`), o texto, e no pé dois botões `lg` em coluna: "Sair da central" (`primary`, haptic `confirm`, `loading` enquanto vai, desligado sem internet) e "Continuar na central" (`ghost`, fecha a sheet).
- Texto: "A central sai de Suas centrais. Os pontos que você ganhou nela continuam com você, e entrar de novo não rende os pontos de entrada outra vez." Sem o nome da central, para a sheet não depender de a página ter carregado. Sem falar do mural: o mural de exemplo (`buildFeedPageFixture`, em `posts/fixtures.ts`) mostra os posts de Netto, Nenho e Juninho para qualquer fã, nas fixtures e no modo misto, e a sheet também aparece nas builds da cliente. O bloco 6, com o mural filtrado pelas centrais do fã, devolve a frase "Os posts desta central saem do seu mural".
- Sucesso: fecha (`router.back()`), anuncia "Você saiu da central." e a 1d volta a "Entrar na central". Erro: fica na sheet, com haptic `error` e "Não deu para sair da central. Tente de novo." acima dos botões, também anunciado.
- (Implementação) Enquanto o pedido vai, o voltar do Android e o gesto do iOS ficam presos (`useStayOnScreen(leave.isPending)`), como no resgate; o "×" e o "Continuar na central" ficam desligados. O arrasto da sheet no Android não trava (react-native-screens 4.26), e a resposta que chega depois dele não navega (a mutação confere se a sheet está montada).
- Provisória: o lugar definitivo depende do menu "mais" (UP-48). Entra nas Pendências do `CLAUDE.md`.

**Ranking de exemplo ao lado de dado de verdade**

- `LeaderboardPage` ganha `example?: boolean`. O servidor nunca manda. A fixture marca `true` quando a página aparece ao lado de dado de verdade: recorte de central com `sourceOf('artists') === 'api'`, ou o geral com `sourceOf('wallet') === 'api'` (`isExampleBesideRealData`, em `ranking/fixtures.ts`). (Implementação) O `MyRank` ganha o mesmo `example?: boolean`, também só da fixture: é por ele que o card "Você" sabe que a falta de posição é a do exemplo, e não a de quem não pontuou.
- No recorte de central marcado, o fã não entra no ranking de exemplo (o "você" das centrais de exemplo valia para qualquer fã). O card "Você" da 1f mostra "Sem posição ainda" (`ranking.me.pending`), o mesmo "sem posição" da 1e, e não o "Ganhe pontos para entrar no ranking" de hoje, que seria falso para quem tem pontos na central (a Camila tem 4.120 no Netto). (Implementação) Os pontos do card, nesse recorte, são os de verdade do fã na central, lidos de `/me/centrals` pela própria 1f, e não o 0 da fixture: assim o card e a 1e mostram o mesmo número. (Implementação) O rótulo do card diz esses pontos também: "Você, sem posição ainda, 4.120 pontos." (`ranking.me.labelPending`; sem pontos, "Você. Sem posição ainda."). O geral continua como a seção 13 decidiu, agora com o aviso.
- Aviso: `ExampleNotice`, em `ranking/components` e exportado pelo index, uma linha `labelSmall` em `colors.textMuted`: "Ranking de exemplo: as posições de verdade chegam com o ranking do servidor." Na 1f, logo abaixo da linha da temporada; na 1d, abaixo do título do card de top fãs e abaixo da linha da temporada da aba Ranking. Aparece quando a primeira página da consulta traz `example: true`. As builds de hoje, com tudo nas fixtures, não mostram; o bloco 8 apaga o campo e o aviso.

**O que é de verdade e o que é de exemplo** (desenvolvimento com emulador, do bloco 4 ao 8)

| Número ou lista                         | Telas                     | Fonte no bloco 4                |
| --------------------------------------- | ------------------------- | ------------------------------- |
| Centrais publicadas, nome, foto e ordem | 1l, 1d, chips da 1f       | servidor                        |
| Centrais do fã                          | 1b, 1e, chips da 1f       | servidor                        |
| Fãs da central (`fanCount`)             | 1l, 1d, 1e                | servidor                        |
| Estar na central (`isMember`)           | 1d                        | servidor                        |
| "PTS DA CENTRAL"                        | 1d                        | servidor (soma)                 |
| Pontos de seguir e de entrar            | carteira (1e, 1h)         | servidor                        |
| Pontos do fã em cada central            | 1b, 1e                    | servidor                        |
| Posição do fã numa central              | 1b, 1e, card "Você" da 1f | nenhuma, até o bloco 8          |
| Ranking de cada central e top fãs       | 1f, 1d                    | exemplo, com o aviso            |
| Ranking geral e o card "Você"           | 1f                        | exemplo, com o aviso (seção 13) |
| Posts da central (contagem e grade)     | 1d                        | exemplo, até o bloco 6          |
| Missões e agenda da central             | 1d                        | exemplo, até os blocos 6 e 7    |

**Fixtures**

- Ids no formato do @ (decisão 12), em `artists`, `ranking`, `posts`, `agenda` e `missions`, e nos testes. Os testes que usam o id como semente do placeholder (`avatar`, `remote-image`, `pick-stable`) mudam o esperado. O `QUERY_CACHE_VERSION` não sobe: com algum domínio nas fixtures, só o dado de verdade vai para o disco (`shouldPersistQuery`, em `services/query/persister.ts`), e nenhum dado de verdade salvo hoje (o perfil, a carteira e o progresso) guarda id de central. Subir jogaria fora o perfil salvo e as mutações pausadas. Uma entrada pausada com um id antigo volta com 404 (`assertKnown` das fixtures, ou a API) e desfaz sozinha. Links de central já compartilhados nos testes da cliente (`/artista/netto-brito`) param de abrir a central.
- `followFixture.leave(artistId, key)`: tira do conjunto, guarda a resposta pela chave e não mexe em ponto.
- `followFixture.join` paga só na primeira entrada de cada central na sessão (conjunto `joinedOnce`, que nasce com as três do protótipo), como o servidor: sair e entrar de novo não paga.
- `followFixture.follow` continua sem pontos (decisão 3) e devolve `pointsAwarded: 0`.

**Textos novos** (`translations.json`)

- `artist.join.memberHint`: "Abre a opção de sair da central"
- `artist.leave.title`: "Sair da central?"
- `artist.leave.body`: o texto da sheet, acima.
- `artist.leave.confirm`: "Sair da central"
- `artist.leave.cancel`: "Continuar na central"
- `artist.leave.left`: "Você saiu da central."
- `artist.leave.error`: "Não deu para sair da central. Tente de novo."
- `ranking.exampleNotice`: o aviso, acima.
- `ranking.me.pending`: "Sem posição ainda"; `ranking.me.labelPending`: "Você, sem posição ainda, {{points}}." (implementação)
- `onboarding.chooseArtists.needMoreHintOne`: "Escolha pelo menos 1 artista." (implementação)
- `artist.central.points`: "{{points}} pts"; `artist.central.pointsLabel`: "{{name}}, {{points}} na temporada" (com o `formatPointsSpoken`, "4.120 pontos")
- `onboarding.chooseArtists.fansOne`: "1 fã"; `onboarding.chooseArtists.cardLabelOne`: "{{name}}, 1 fã"
- `profile.centrals.metaUnrankedOne`: "Sem posição ainda · 1 fã"; `profile.centrals.labelUnrankedOne`: "{{name}}, ainda sem posição, 1 fã."
- `profile.centrals.labelUnrankedPoints`: "{{name}}, ainda sem posição, entre {{fans}} fãs, {{points}} na temporada."; `profile.centrals.labelUnrankedPointsOne`: "{{name}}, ainda sem posição, 1 fã, {{points}} na temporada."

**`CLAUDE.md` e `AGENTS.md`**

No mesmo commit: Dados (centrais na API com o emulador, a regra de coerência do bloco 4 e o sair), Navegação (a sheet), Acessibilidade (o "Na central" passa a abrir a sheet), Artistas e centrais (etapa 2 feita: vínculo, `fanCount`, gatilho e fila), API do app e pontos (as rotas do bloco 4) e Pendências (sair provisório, capa, gestão oficial, o que "fãs" conta). O `AGENTS.md` recebe a mesma cópia, com o cabeçalho dele.

Nada disso entra no fingerprint da EAS: só JavaScript, regras e funções.

### 19.14 Seed dos emuladores

`functions/src/centrals/seed.ts` exporta `SEED_CENTRALS`, `seedCentrals(db, now)` e `seedCamilaCentrals(db, uid, now)`. O `scripts/seed-emulators.mjs` carrega `functions/lib/centrals/index.js` do mesmo jeito que carrega os pontos, chama `seedCentrals` antes das contas e `seedCamilaCentrals` depois da carteira da Camila, e escreve uma linha de cada.

| id              | Nome           | `shortName` | `order` | Status        | Verificado | Gestão oficial |
| --------------- | -------------- | ----------- | ------- | ------------- | ---------- | -------------- |
| `nettobrito`    | Netto Brito    | `null`      | 0       | `published`   | sim        | sim            |
| `nenho`         | Nenho          | `null`      | 1       | `published`   | sim        | sim            |
| `juninhomoraes` | Juninho Moraes | Juninho M.  | 2       | `published`   | sim        | sim            |
| `rocksalles`    | Rock Salles    | `null`      | 3       | `published`   | sim        | sim            |
| `artista5`      | Artista 5      | `null`      | 4       | `published`   | não        | não            |
| `artista6`      | Artista 6      | `null`      | 5       | `published`   | não        | não            |
| `artista7`      | Artista 7      | `null`      | 6       | `draft`       | não        | não            |
| `artista8`      | Artista 8      | `null`      | 7       | `unpublished` | não        | não            |

- Cada central só é criada se não existir, numa transação; a que existe fica como o desenvolvedor deixou no painel. (Implementação) A reserva `usernames/{id}` só é criada se não existir: o @ de uma fã que chegou antes fica com ela. Grava `artists/{id}` no formato do painel (`handle`, `name`, `shortName`, `genre: null`, `city: null`, `bio: null`, `verified`, `photo: null`, `thumb: null`, `order`, `status`, `fanCount: 0`, `publishedAt` com o agora nas publicadas e na fora do ar e `null` no rascunho, `createdAt`, `updatedAt`, e `managedByImagine: true` nas 4 do protótipo), `artistPrivate/{id}` (`email`, `phone`, `managerUid` e `managerName` nulos, `imageRightsConfirmed: true`, `createdBy` e `updatedBy` `'seed'`, `updatedAt`) e a reserva `usernames/{id}` (`{ artistId, createdAt }`).
- Sem foto: o painel exige foto para publicar, e o seed publica sem ela, como nas fixtures (placeholder pelo id). Para ver a capa recortada, suba a foto pelo painel ligado aos emuladores.
- 4 publicadas na grade da 1l e 2 no "+2 artistas" e na busca; o rascunho e a fora do ar não aparecem em lugar nenhum do app.
- Camila: `seedCamilaCentrals` chama `runJoinCentrals(db, uid, ['nettobrito', 'nenho', 'juninhomoraes'], options)`, o mesmo `readJoin` e `joinCentrals` das rotas, numa transação com o `requireFan` sem marca de atividade, como o `runAward`. Opções: o meio-dia de 8 dias atrás (`joinedAt`, que põe as três na ordem do protótipo), `actor` de sistema, `via: 'seed'` e a configuração padrão com `central_join: 0`.
- Por que o valor 0 só no seed: a base do seed (seção 14) já tem os pontos do protótipo, e a entrada pagaria 30 a mais, com o Juninho pontuando, o que o protótipo não tem. Com 0, o `central_join` sai `zero` e não grava extrato; se a Camila sair e entrar de novo no app, ganha os 10, o que serve para ver o "+10".
- Resultado: a Camila segue Netto, Nenho e Juninho, com a carteira igual (12.480, 4.120, "+840"); a fila deixa o `fanCount` em 1, 1 e 1 (as outras em 0); o `/me/centrals` dela responde Netto 4.120, Nenho 2.980 e Juninho 0, todas com `fanRank: null` e "1 fã". Na 1b, os cards mostram "4.120 pts", "2.980 pts" e "novo"; na 1e, os mesmos pontos à direita (decisão 8). O Alan não segue nada: no app, passa pela 1l com as 6 publicadas, e seguir 3 rende 30 pontos.
- Rodar de novo não muda nada: as centrais existem, os vínculos existem e não há ponto.

### 19.15 Testes

Funções, testes puros (`vitest`, relógio fixo):

- `centrals/model.test.ts` (tabela): as três respostas a partir do documento (foto e miniatura, `cover` antes de `photo`, sem imagem, `fanCount` negativo ou estranho vira 0, `verified` e `managedByImagine` só com `true`); a validação do corpo da `POST` (vazio, 51 ids, repetido, fora do formato, id `__x__`); a ordem de "Suas centrais" (`joinedAt`, depois `order`, depois id); `seasonPoints` só com a temporada da configuração; `shouldCopyFanCount` (sem `fanCountAt` copia, leitura mais nova copia mesmo com o número igual, leitura igual ou mais velha que o `fanCountAt` gravado não copia); a soma dos shards negativa vira 0; `memberFanCount` (sem `fanCountAt` soma 1, `fanCountAt` antes do `joinedAt` soma 1, igual ou depois usa a cópia, cópia 0 de membro vira 1); `fanCountSyncTask` (janela de 10 s, o mesmo id para dois instantes da mesma janela e outro na seguinte, `scheduleTime` 1 s depois do fim da janela, id no formato que o Cloud Tasks aceita, `^[A-Za-z0-9_-]+$`, com o @ que tem `_`); o shard do `fanCount` (`award.shard % 16`).
- `points/stats.test.ts`: `joined` e `left` por central e no total, e o `pruneZeros` deles. `addMembershipCounts` com o `plan.shard` nulo.
- `api/router.test.ts`: `GET /me/centrals/nenho` responde 405 com `Allow: PUT, DELETE`; `/me/centrals` e `/me/centrals/:artistId` não se confundem.
- `api/index.test.ts`: `artist_not_found` com 404 e o corpo combinado; `CentralError` traduzido; id fora do formato do @ é 404 nas três rotas com `:artistId`.
- `centrals/service.test.ts`: `sumCentralPoints` com a consulta injetada que falha com o código 9 devolve 0 e chama o `logger.error`; com outro código, lança.
- `centrals/sync.test.ts`: o gatilho ignora `functions/task-already-exists`, lança nos outros erros e não lança com `artistId` fora do formato; com `FUNCTIONS_EMULATOR`, enfileira sem id e sem `scheduleTime` (fila injetada).
- (Implementação, revisão do bloco) `centrals/model.test.ts`: o teto de entradas (`exceedsEntryLimit`, o Retry-After em segundos, a recusa com motivo e mensagem) e o limite aceito do `memberFanCount` (sair e entrar antes da cópia seguinte); `points/model.test.ts`: `nextDayStart` (o começo do dia seguinte de São Paulo); `points/award.test.ts`: `addDailyCount` (carteira lida com os dias velhos cortados, carteira nova, carteira já no plano); `api/index.test.ts`: `too_many_entries` vira 429 com `details.limit` e `Retry-After`; `store.test.ts`: a ordem do `deleteUserData` (19.12).

Funções nos emuladores (`functions/test/centrals.emulator.test.ts`, com a `api` de verdade por HTTP e tokens do emulador de Auth; o gatilho roda no emulador de Functions e a tarefa no do Cloud Tasks, que sobe junto, e os testes esperam o `fanCount` mudar, até 10 s):

- `GET /artists`: só as publicadas, na ordem, com a foto mapeada; rascunho e fora do ar não aparecem.
- `GET /artists/:id`: publicada responde; rascunho, fora do ar, inexistente e id malformado dão 404; `isMember`; `centralPoints` somando dois fãs com pontos na central; `postCount` 0.
- `PUT`: cria o vínculo, soma 1 nos shards, a fila copia `fanCount` 1 com `fanCountAt`, paga 10 (carteira, extrato `central_join:<id>`, `centralPoints`), `joined` 1 no shard do dia; o `GET /artists/:id` e o `GET /me/centrals` logo depois, antes da cópia, dão `fanCount` 1 numa central que tinha 0 (`memberFanCount`); a mesma chave devolve a resposta guardada; outra chave com o fã dentro paga 0 e não soma shard; central fora do ar dá 404; sem perfil, 503; conta só da equipe, 403.
- `DELETE`: tira o vínculo, desconta o shard, a fila volta o `fanCount`, `left` 1, os pontos ficam; sair sem vínculo é 200 sem mexer em shard; entrar de novo cria o vínculo e paga 0 (`duplicate`).
- `POST /me/artists`: 3 centrais criam 3 vínculos e pagam 30, com `followedArtistIds` na ordem; uma fora do ar dá 404 com `details.artistIds` e nada gravado; uma já seguida não paga; a 11ª do dia sai sem ponto (limite); 51 ids e id repetido dão 400.
- Concorrência: 10 fãs entrando juntos na mesma central deixam a soma dos shards e o `fanCount` em 10; o mesmo fã entrando e saindo em paralelo, com chaves diferentes, termina com o vínculo e a soma coerentes.
- Exclusão: fã em 3 centrais; depois do `deleteUserData`, nenhum vínculo, cada soma 1 abaixo e o `fanCount` de volta, nunca negativo; rodar de novo não desconta outra vez; entrada depois de o perfil sair dá 503 e não cria vínculo.
- `deleteArtist`: `fanCount` 0 com a soma dos shards 1 (gravados direto, como cópia atrasada) recusa com `has-fans`; `fanCount` 1 com a soma 0 (cópia atrasada ou perdida) apaga a central e os shards; soma 0 e `fanCount` 0 apaga os shards. Os testes de `functions/test/artists.emulator.test.ts` continuam passando sem mudança (gravam o `fanCount` sem shards).
- Fila: shards somando negativo deixam `fanCount` 0; central apagada não é recriada; entrada e saída de fãs diferentes na mesma central, com a soma igual, ainda avançam o `fanCountAt`.
- Seed: centrais e vínculos da Camila como em 19.14, a carteira dela sem mudar, e rodar de novo não muda nada.
- (Implementação, revisão do bloco) O teto do dia: entrada nova com o teto feito dá 429 com `Retry-After` e não grava vínculo nem shard, a 1l também, entrar onde já está passa, sair vale, e voltar é entrada (429); o `central_entry` sobe só com vínculo novo. Sair de uma central fora do ar desconta o shard e a fila volta o `fanCount`. Fã com mais de 240 vínculos: a pedida que ele já segue, fora da lista do `readFollow`, responde 200 sem pagar nem mexer em shard. Os shards do painel são lidos pelo dia que o servidor usou (o `day` do extrato `central_join`, ou os dias entre o antes e o depois do pedido), e não pelo relógio depois da resposta.

Regras, `tests/centrals-rules.test.ts` (novo, no molde de `tests/artists-rules.test.ts`, com os mesmos membros de exemplo):

- `users/{uid}/centrals/{artistId}`: o próprio fã não lê (`get` e `list`), outro fã também não; a equipe ativa com `fans` (editora e leitor) e admin leem o documento e a consulta em grupo `collectionGroup('centrals').where('artistId', '==', ...)`; equipe sem `fans` (só `artists`), desativada, pendente ou com sessão de antes do `authValidAfter` não lê; ninguém grava, nem admin.
- `artistStats/{id}` e `fanShards`: ninguém lê nem grava pelo cliente, nem a equipe com `artists`, nem admin.
- Coleção de raiz `centrals/{id}`: a equipe com `fans` lê (a regra de grupo alcança qualquer coleção `centrals`). O teste deixa escrito por que nenhuma outra coleção pode ter esse nome (19.10).
- As regras de `users/{uid}` de hoje continuam iguais, e os arquivos de teste que já existem passam sem mudança.

App:

- `artists/__tests__/api.test.ts`: `leaveCentral` nos dois modos (`DELETE` com a chave; a fixture tira e devolve a mesma resposta pela chave); `POST` devolve `pointsAwarded`; nas fixtures, sair e entrar de novo não paga; `postCount` de exemplo no modo misto.
- `artists/__tests__/queries.test.tsx`: sair atualiza a página e "Suas centrais" só no sucesso e mantém tudo no erro, com a mesma chave depois de falha incerta e nova depois de recusa; entrar soma 1 ao `fanCount` da página e da central inserida, e o erro desfaz; seguir com pontos invalida a carteira; seguir com `notFound` invalida a lista.
- `artists/__tests__/central-card.test.tsx` e `profile/__tests__/profile-cards.test.tsx`: sem posição e com pontos, o card da 1b mostra os pontos (e o rótulo os diz) e a linha da 1e mostra os pontos à direita; sem posição e sem pontos, "novo" e nada à direita.
- `src/config/__tests__/data-source.test.ts`: `artists` na API com o emulador.
- `ranking/__tests__/fixtures.test.ts`: `example` e o fã fora do ranking de central quando as centrais estão na API; sem a marca nas fixtures puras. O card "Você" de uma central marcada diz "Sem posição ainda".
- Navegação (`src/navigation/__tests__/artist.test.tsx`): o "Na central" abre a sheet; "Sair da central" volta a 1d para "Entrar na central"; "Continuar na central" fecha sem mudar nada; o "Na central" fica sem toque enquanto a entrada vai, e também com a página montada de novo sobre uma entrada pausada (sem rede) dessa central, feita antes de a página abrir.
- `onboarding`: `retain` e o mínimo `min(3, n)`; `describe-profile`: o singular "1 fã". Na navegação da 1l (`src/navigation/__tests__/onboarding.test.tsx`): duas publicadas pedem 2 e o card diz "1 fã"; lista vazia é erro de carregar; central que sai do ar entre a lista e o toque sai da escolha.
- Os testes que citam os ids antigos passam para os ids no formato do @.
- (Implementação, revisão do bloco) `artists/__tests__/queries.test.tsx`: entrar com `notFound` faz a página e as centrais buscarem de novo, sem o "Tente de novo", e a recusa de outro tipo desfaz no lugar; a entrada restaurada do disco que falha também busca de novo; sair com o hook desmontado só avisa (sem o `onLeft` e o `onError`). Navegação: a sheet fechada com o pedido indo não tira a 1d da pilha; entrar numa central que saiu do ar mostra "Esta central não existe mais."; com as centrais na API, o aviso de exemplo nos top fãs e na aba Ranking da 1d (`artist.test.tsx`) e na 1f (`ranking.test.tsx`), com o card "Você" sem posição e com os 4.120 de "Suas centrais", e o Geral sem aviso com a carteira nas fixtures; a 1l com uma central só, com o botão e a dica no singular (`onboarding.test.tsx`).

### 19.16 Fica para depois

- Posição por central, ranking da central e top fãs de verdade (bloco 8): `fanRank` pela contagem da seção 10; o bloco apaga o `example` e o aviso, e segue a resposta da decisão 13 (quem saiu no ranking da central e o texto "#N entre N fãs").
- `postCount` de verdade (bloco 6), com o contador de posts por central; sai a troca pelo número de exemplo. Com o mural filtrado pelas centrais do fã, a sheet de sair volta a dizer que os posts saem do mural.
- Fechamento do dia (bloco 11): acerta o `fanCount` de todas as centrais (a rede de segurança da fila, 19.6) e fecha `joined` e `left`; se quiser, `removed` pela exclusão de conta (19.9).
- Painel: os campos `managedByImagine` e `cover`; a seção Fãs com os vínculos; a Visão geral com `joined` e `left`.
- O guard do onboarding continua local (`preferences`): quem reinstala o app passa pela 1l de novo, e seguir de novo não duplica nem paga. Pular a 1l quando o `/me/centrals` não vier vazio fica para quando o login social entrar.
- O lugar definitivo do "Sair" (UP-48).
- Publicação, só com o ok do dono, nesta ordem: regras e índices (`deploy --only firestore:rules,firestore:indexes`); esperar os índices novos aparecerem como prontos no console (Firestore, Índices), porque o deploy volta antes de eles terminarem de montar; depois todas as funções (`npm run functions:deploy`), que levam a `api`, o gatilho `queueArtistFanCountSync` e a fila `syncArtistFanCount` novos, o `deleteArtist` mudado e o `deleteUserData` novo, usado pela `deleteUserProfile` e pela `createUserProfile`. Com a ordem trocada, o `GET /artists` responde 500 e o "PTS DA CENTRAL" vira 0 até o índice ficar pronto (19.7).

### 19.17 Armadilhas do bloco 4

- O `fanCount` de `artists/{id}` é cópia: fica uns 10 a 20 s atrás de cada mudança, em qualquer central, e sempre fecha. Quem precisa do número exato (o `deleteArtist`) soma os shards na transação.
- Logo depois de entrar, a cópia ainda não conta o fã: as rotas de leitura somam 1 para o membro cujo `joinedAt` é depois do `fanCountAt` (`memberFanCount`). Logo depois de sair, a página pode contar o fã por até uns 20 s, e não há como descontar sem o vínculo.
- A tarefa copia mesmo com o número igual quando a leitura é mais nova: o `fanCountAt` tem de passar o `joinedAt` de quem entrou, senão o `memberFanCount` soma 1 a mais para sempre.
- Um shard sozinho pode ficar negativo; só a soma vale, e a cópia nunca é negativa.
- A transação de entrada lê `artists/{id}` (é o que a põe em ordem com o `deleteArtist` e o `setArtistStatus`), mas nunca grava nele. Somar o `fanCount` ali, ou copiá-lo a cada mudança, faria o documento dos destaques disputado com as próprias entradas.
- O id da tarefa sai do `event.time` do gatilho, não do relógio: a entrega repetida cai na mesma janela.
- `taskQueue('syncArtistFanCount')` sem a região procura a fila em `us-central1`: use `locations/southamerica-east1/functions/syncArtistFanCount`.
- O emulador do Cloud Tasks ignora o `scheduleTime` e nunca libera um id usado: lá, a tarefa vai sem id, uma por gravação, na hora.
- O emulador não exige índice: a falta do índice só aparece em produção, como código 9. Índices antes da `api`.
- A regra de grupo de `centrals` vale para qualquer coleção com esse nome: não crie outra.
- Na exclusão de conta, o perfil sai sozinho antes dos vínculos: o `recursiveDelete` apaga o documento do perfil por último.
- Sair não tira ponto, e entrar de novo não paga a entrada outra vez.
- Posição de exemplo nunca aparece ao lado de número de verdade, e ranking de exemplo ao lado de dado de verdade leva o aviso. Sem posição, a tela mostra os pontos do fã na central, nunca "novo" ou "Ganhe pontos" para quem já pontuou.
- A trava do "Na central" é o `useIsMutating` das entradas da central, não o `isPending` do hook: só o primeiro vê a entrada pausada ou restaurada do disco.
- Os ids das fixtures seguem o formato do @, e o `QUERY_CACHE_VERSION` não sobe por isso.
- `planAwards` sem lançamentos não lê nada: a rota de sair pode chamá-lo depois de ler o vínculo.
- Quem sai e entra de novo antes da cópia seguinte do `fanCount` é contado duas vezes, só para ele, até ela (limite aceito, 19.2).
- O teto de entradas mora em `days[dia].count.central_entry` da carteira: a carteira é gravada em toda entrada nova. Sair nunca é recusado.
- Callback passado ao `useMutation` roda mesmo com a tela desmontada (só os do `mutate` conferem): o que navega ou mexe na tela confere se o hook está montado.

## Armadilhas

- Na transação, todas as leituras vêm antes de qualquer gravação. Por isso o `award` tem duas fases e a ordem da rota é fixa (seção 5).
- `set` com `merge` junta mapas: os dias velhos de `days` nunca sairiam. Use `update` com o campo inteiro.
- O dia é o de São Paulo, igual no limite, no `days`, no extrato e nos agregados. Teste com relógio fixo perto da meia-noite.
- O `createdAt` do extrato é o "agora" do pedido, não `serverTimestamp`: o dia do lançamento e o do agregado precisam bater, e os testes precisam de relógio fixo.
- Os valores e a régua têm cache de 60 s por instância; a temporada do lançamento não, ela é lida na transação (seção 8). Teste que muda os valores injeta a fonte, em vez de esperar.
- O corte de `days` só tira dias para trás. Um dia depois do "agora" do pedido fica (seção 5, passo 5).
- Nada aplicado e nenhuma marca de atividade nova: nada gravado, nem carteira, nem central, nem shard.
- O shard é sorteado dentro da função da transação, de novo a cada tentativa.
- O mesmo fã não entra duas vezes no cálculo: o `planAwards` junta as entradas do mesmo uid, e o plano da rota parte do `fan` do pedido (o `runIdempotent` confere).
- A resposta de rota que grava é guardada como JSON (`storedBody`): `undefined` derrubaria a transação e `Date` voltaria como `Timestamp` na repetição.
- Falha ao buscar as chaves do Google chega como `auth/argument-error`, igual a token inválido: a `api` separa pela mensagem e responde 503, não 401.
- O `runTransaction` do Admin SDK não repete `ALREADY_EXISTS` (código 6). O `runIdempotent` captura e roda de novo uma vez.
- Toda rota que grava passa pelo `requireFan`, rendendo ponto ou não.
- Só sucesso grava a chave de idempotência. Recusa repetida com a mesma chave é avaliada de novo.
- A rota não usa o caminho completo: o `req.path` já chega sem o nome da função. Não monte rota com `/api` na frente.
