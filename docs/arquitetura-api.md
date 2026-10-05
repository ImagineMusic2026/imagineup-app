# Arquitetura da API do app

Nota de arquitetura do servidor do ImagineUP. Ela diz como o app fala com as Cloud Functions, onde moram os pontos, como o ponto é lançado e como o painel lê os números. Vale para o bloco 1 (base do servidor e núcleo de pontos) e deixa a estrutura pronta para os blocos seguintes.

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

| code                       | status | kind no app  | quando                                                         |
| -------------------------- | ------ | ------------ | -------------------------------------------------------------- |
| `invalid_request`          | 400    | validation   | parâmetro, corpo ou cursor fora do formato                     |
| `idempotency_key_required` | 400    | validation   | rota que grava sem `Idempotency-Key`, ou fora do formato       |
| `unauthenticated`          | 401    | unauthorized | sem token, token inválido, vencido ou de outro projeto         |
| `not_fan`                  | 403    | forbidden    | conta só da equipe tentando gravar                             |
| `not_found`                | 404    | notFound     | rota que não existe                                            |
| `method_not_allowed`       | 405    | unknown      | rota existe, método não                                        |
| `insufficient_points`      | 409    | validation   | débito maior que o saldo (já em `API_ERROR_CODES`)             |
| `payload_too_large`        | 413    | unknown      | corpo acima de 16 KiB                                          |
| `idempotency_key_reused`   | 422    | validation   | mesma chave com outro pedido                                   |
| `internal`                 | 500    | server       | erro inesperado                                                |
| `profile_not_ready`        | 503    | server       | gravação sem `users/{uid}` (perfil nascendo ou conta excluída) |
| `unavailable`              | 503    | server       | disputa, Firestore fora ou falha ao conferir o token           |

Mensagens: `invalid_request` "Pedido inválido."; `idempotency_key_required` "Falta a chave de idempotência."; `unauthenticated` "Entre na sua conta para continuar."; `not_fan` "Esta conta não é de fã."; `not_found` "Não encontrado."; `method_not_allowed` "Método não aceito nesta rota."; `insufficient_points` "Saldo insuficiente."; `payload_too_large` "Pedido grande demais."; `idempotency_key_reused` "Esta chave já foi usada em outro pedido."; `internal` "Algo deu errado. Tente de novo."; `profile_not_ready` "Seu perfil ainda está sendo criado. Tente de novo em instantes."; `unavailable` "Serviço ocupado. Tente de novo."

Códigos que os próximos blocos vão criar entram nesta tabela quando nascerem: `artist_not_found`, `post_not_found`, `event_not_found` e `reward_not_found` (404), `comment_invalid` (400) e `sold_out` (409, que também entra no `API_ERROR_CODES` do app no bloco 10). Não há limite de pedidos por minuto no bloco 1: o `maxInstances` segura o custo, e os limites de pontos não são erro (seção 5).

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
    "2026-10-05": { earned: number, count: { comment: 3, mission: 1 } }
  }
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

Gravação: só quando algo mudou, isto é, algum lançamento foi aplicado ou o fã ganhou uma marca de atividade nova (seção 5, passo 9). `tx.create` na primeira gravação; depois, `tx.update` só com os campos que o servidor cuida (`balance`, `xp`, `seasonId`, `seasonPoints`, `seasonPointsAt`, `earnedTotal`, `spentTotal`, `days`, `stats.pastSeasons`, `activity`, `updatedAt`). O `update` com `days` troca o mapa inteiro, e é assim que os dias velhos saem. Nunca `set` com `merge` no `days`: o merge junta os mapas e os dias velhos ficam. Toda gravação na carteira passa por transação que lê a carteira.

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

O vínculo do fã com a central (seguir, `isMember`, `fanCount`) não mora aqui: é do bloco 4 (seção 17, pergunta 4).

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
- **"PTS DA CENTRAL":** o total de sempre por central, que a página do artista mostra, sai do mesmo fechamento, em `artistStats/{artistId}` (coleção do bloco 4, com as regras dele), e não em `artists/{id}`, que as callables do painel gravam com a regra delas de `updatedAt`. Ele soma até ontem, então fica até um dia atrasado; se o bloco 4 quiser o dia de hoje, a rota soma os shards na leitura.

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
- O ranking (card "Você" da 1f) e o "você é #12" da home continuam lendo a `fixtureWallet`, parada no exemplo (temporada 4.120), para qualquer fã: a Camila do seed tem 4.120 também no servidor, e o Alan, com 0 no servidor, aparece com 4.120 no ranking. São dados de exemplo até o bloco 8. Zerar a temporada do ranking nesse modo (`buildMyRankFixture` com 0) só trocaria a diferença do Alan pela da Camila. O mesmo vale para os pontos e a posição de "Suas centrais" na 1b e na 1e (`FanCentral`, do `buildMyRankFixture`: Netto 4.120 e Nenho 2.980, para qualquer fã), até os blocos 4 e 8; na conferência de 2026-10-05, a conta nova criada pelo cadastro mostrou 0 ponto e nível 1 do servidor e essas centrais de exemplo.
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
4. **Onde ficam os contadores e os pontos por central.** Em `wallets/{uid}` e `wallets/{uid}/centralPoints/{artistId}` (seção 4). O vínculo com a central é do bloco 4, separado dos pontos. Direção: `users/{uid}/centrals/{artistId}`, que some junto com o perfil (a exclusão desconta o `fanCount` antes) e permite a consulta por central pelo grupo de coleção; o bloco 4 confirma, com regras e testes. O `fanCount` não é somado em `artists/{id}` na transação do vínculo: os 4 destaques da 1l recebem quase todo cadastro, e esse documento ficaria disputado (e também é o que as callables do painel gravam). Ele é dividido em shards, sorteados como os do painel, e somado no fechamento ou na leitura (seção 18).
5. **Formato dos agregados.** Documento por dia em 64 shards, na transação do ponto e só quando algo mudou, com pontos por origem e por artista, fãs ativos e coortes, mais o fechamento do dia (seção 7). Teto e saída registrados na seção 7.
6. **Como calcular o ranking.** Consulta ordenada com índice, com desempate por `seasonPointsAt`, e posição por `count()` na mesma ordem da lista; materializar só se o custo pedir (seção 10, bloco 8).
7. **Como guardar a régua.** `config/points`, versionado, com padrão no código e edição por callable com auditoria. Mudança de valor não vale para ação antiga (seção 9).
8. **Como montar o feed.** Bloco 6. A consulta por `artistId` com `in` (até 30 centrais) basta enquanto o fã seguir poucas centrais; sem cópia por fã.
9. **Antifraude.** Limites diários por origem no servidor, sem App Check por enquanto (seção 5).
10. **Ambiente de testes.** Documentado; espera o ok da cliente (seção 15).
11. **Onde o mural e a agenda entram no painel.** Bloco 6. Não muda nada no bloco 1.
12. **Exclusão de conta.** Agregados não descontam (seção 12). Direção para os outros blocos: comentários do fã excluído são apagados, com a contagem do post descontada (bloco 6); resgate em aberto continua para a equipe entregar ou cancelar, sem o uid e com o status de conta excluída (bloco 10).

## 18. O que fica para os próximos blocos

- **Bloco 4 (centrais):** rotas de artistas e centrais; vínculo do fã na transação da ação, com o `requireFan`; `fanCount` dividido em shards (sorteados a cada tentativa, como os do painel) e somado no fechamento ou na leitura, nunca somado direto em `artists/{id}` na transação; onde fica o total somado leva em conta o `has-fans` do `deleteArtist`, que hoje lê `artists/{id}.fanCount`; `central_join` pelo `award`; `/me/centrals` com `seasonPoints` de `centralPoints` (o `fanRank` espera o bloco 8 ou sai por `count()`); "PTS DA CENTRAL" em `artistStats/{artistId}`, pelo fechamento do dia, com as regras dela; `artists` no `SERVER_DOMAINS`.
- **Bloco 5 (convite):** `/me/invite` e o claim final; a visita ao link numa função própria, sem login, com CORS só para a origem do site, e `invite_visit` pelo `award`; `invite_signup` pelo `planAwards` com dois fãs (o convidado chama, quem convidou recebe, e sai `skipped` se excluiu a conta); links criados e pessoas trazidas fora da carteira e sem documento disputado (por exemplo uma entrada por convidado, contada com `count()`; um contador único somado no claim derrubaria o cadastro dos convidados de um link que viraliza), lidos pelo `/me/progress`, e os 63 e 418 da Camila no seed; o código do convite conferido com o `CODE` de `invites/deep-link.ts` antes de guardar, e o app esquecendo o código quando o servidor recusar de vez (seção 2); `signups` e `byOrigin` nos shards e cadastros por semana, o denominador da retenção (seção 7); a carga dos cadastros antigos.
- **Bloco 6 (mural e agenda):** rotas, coleções e regras de posts, comentários, curtidas, shows e presenças; `like`, `comment` e `rsvp` pelo `award`; contadores de engajamento; bloqueio de fã; exclusão do conteúdo do fã.
- **Bloco 7 (missões e conquistas):** progresso de missão na transação; conquistas; tela do extrato (`/me/ledger`, com desenho); `updatePointsConfig` e a seção Missões e régua no painel.
- **Bloco 8 (ranking e temporadas):** `updateSeason` com `season-id-locked` e `season-id-used` (seção 8), histórico em `seasons/{id}`, arquivo do resultado, índices compostos, posição por `count()` com o desempate da lista (seção 10), foto semanal do `change`.
- **Bloco 10 (loja):** rotas da loja e o resgate com o débito já pronto; `sold_out` no `API_ERROR_CODES`.
- **Bloco 11 (painel):** Visão geral e Crescimento lendo `statsDaily` sem escuta em tempo real (seção 7), com ativos do dia, da semana e do mês e a retenção por coorte; Fãs lendo carteira e extrato, mais a regra de `users/{uid}` para a equipe; `adjustFanPoints`; fechamento do dia, se o bloco 4 não tiver feito.
- **Ambiente de testes:** quando a cliente aprovar (seção 15).
- **Publicação:** deploy da `api`, das regras e dos índices, e `minInstances`, só com o ok do dono. `EXPO_PUBLIC_API_URL` nas variáveis da EAS só depois dos blocos 4, 6, 7, 8 e 10, quando nenhuma ação que rende ou gasta pontos ficar nas fixtures (seção 13); antes disso a cliente perderia a demonstração de pontos.

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
