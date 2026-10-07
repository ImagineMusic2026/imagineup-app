# Arquitetura da API do app

Nota de arquitetura do servidor do ImagineUP. Ela diz como o app fala com as Cloud Functions, onde moram os pontos, como o ponto é lançado e como o painel lê os números. Vale para o bloco 1 (base do servidor e núcleo de pontos) e deixa a estrutura pronta para os blocos seguintes. O bloco 4 (centrais de verdade) está na seção 19, o bloco 5 (convite com atribuição e origem do fã), na seção 20, o bloco 6 (mural e agenda com conteúdo real), na seção 21, e o bloco 7 (missões, níveis, conquistas e extrato), na seção 22.

Origem: decisão do dono em 05/10/2026 (API HTTP numa função `onRequest`, pontos calculados na transação da ação) e o levantamento de 05/10/2026 (13 blocos, 26 endpoints, perguntas técnicas em aberto).

Quem mexe no servidor lê esta nota antes. Mudou uma decisão daqui? Mude a nota no mesmo commit.

## Decisões em uma página

1. Uma função HTTP `api` (`onRequest`, 2ª geração, `southamerica-east1`) com roteador próprio, sem Express e sem dependência nova. O app continua com o axios de `src/services/api`, o `toApiError` e os endpoints que os `api.ts` já chamam.
2. Toda rota exige o ID token do Firebase no `Authorization`. Toda rota que grava exige `Idempotency-Key`, guardada no servidor por 30 dias, na mesma transação do efeito, e lê o perfil do fã nessa transação: conta sem `users/{uid}` não grava nada, com ou sem ponto. A visita ao link de convite conta no app, de conta logada, por uma rota que grava como as outras; o clique no site não conta (seção 20).
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
14. Bloco 5 (seção 20): código de convite por fã, sorteado no servidor e criado no primeiro `GET /me/invite`; claim uma vez por conta, em `referrals/{uid}`, só para conta de até 7 dias, pagando quem convidou (visita e cadastro) com o id do evento pela chave da pessoa (o e-mail normalizado, em HMAC-SHA256 com um segredo do servidor), para a conta excluída e recriada não pagar de novo; visita só no app, de conta logada diferente do dono e de outra pessoa (a chave do dono também barra o apelido do e-mail), contada no painel uma vez por pessoa e convidante, pague ou não; origem (tipo de link, destino e `utm_source`, `utm_medium` e `utm_campaign`) no convite e nos agregados por origem e campanha; cadastros por dia no gatilho de cadastro.
15. Bloco 6 (seção 21): a equipe publica posts e shows pelas callables do painel, com a seção `artists` (provisório até a UP-9); post em `posts/{postId}`, show em `events/{eventId}`, curtida e presença em subcoleções do fã, comentário em `posts/{postId}/postComments`; curtidas e comentários contados em shards e copiados para o post por uma fila, no máximo uma vez a cada 10 s; `postCount` por `count()`; curtir paga uma vez na vida, comentar dentro do limite do dia, "Eu vou" uma vez por show; tetos diários de ações; denunciar comentário e bloquear fã, com a fila da Moderação e a callable `moderateComment`; a exclusão de conta apaga comentários, curtidas, presenças, denúncias e bloqueios, descontando as contagens.
16. Bloco 7 (seção 22): catálogo de missões em `config/missions`, versionado e lido pelo cache, com índice por tipo de ação, e as arquivadas em `missionArchive`; períodos do dia e da semana de São Paulo; progresso do fã na carteira, contado na transação da ação (a troca para curtido ou "Eu vou", o comentário e a entrada contam o alvo uma vez por missão e período; o link e o convite contam a pessoa pelo marcador), e a conclusão paga pelo núcleo com `mission:<id>:<período>`, no mesmo `pointsAwarded`; meta da temporada por missões concluídas ou pelos pontos da temporada, com a marca de quem a bateu; conquistas do servidor (nível, primeira vez, ranking no bloco 8) guardadas na carteira; subida de nível devolvida na resposta; tetos do dia na configuração; callables da régua, das missões, das conquistas (seção `missions`) e da temporada (seção `ranking`); extrato provisório no Perfil.

## 1. Formato da API

### Endereço e opções da função

- Função `api`, exportada em `functions/src/index.ts`, depois do `setGlobalOptions` (região `southamerica-east1`, `maxInstances: 10`).
- Produção: `https://southamerica-east1-imagine-up-app.cloudfunctions.net/api`. Esse valor só entra em `EXPO_PUBLIC_API_URL` (variáveis da EAS) depois do deploy, com o ok do dono. Hoje a variável fica vazia.
- Emuladores: `http://<EXPO_PUBLIC_FIREBASE_EMULATOR_HOST>:5001/demo-imagine-up-app/southamerica-east1/api`. O app monta essa URL sozinho (seção 13). O alcance é o mesmo dos outros emuladores: `10.0.2.2` no emulador Android; aparelho na rede local precisaria dos emuladores ouvindo fora do 127.0.0.1, o que hoje nenhum faz.
- Opções: `invoker: 'public'` (quem protege é o ID token), `cors: false` (app nativo não faz preflight; o painel não usa esta API, usa callables; a visita ao link de convite conta no app, pela própria `api`, seção 20), `timeoutSeconds: 30`, `memory: '512MiB'`, `cpu: 1`, `concurrency: 80`. Confira na doc do firebase-functions 7 os padrões de cpu e concorrência antes de fixar: concorrência acima de 1 pede cpu 1.
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
- A visita ao link de convite conta no app, de quem já tem conta e token, pela própria `api` (`POST /invites/visit`, seção 20). O clique no site não conta: sem conta, não dá para separar pessoa de robô. Assim a `api` continua sem rota aberta e com `cors: false`.
- `verifyIdToken(token)` sem `checkRevoked`: conferir revogação gasta uma chamada ao Auth por pedido. A conta excluída perde o direito de gravar por outro caminho: toda rota que grava lê `users/{uid}` na transação, logo depois da chave (`requireFan`, em Idempotência), e a exclusão apaga esse documento antes da carteira.
- Leitura (`GET`) não exige o perfil: carteira que não existe responde zerada, e nada é criado. A exceção é o `GET /me/invite`, que cria o código do fã na primeira chamada e por isso exige o perfil (seção 20).
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
| `comment_invalid`          | 400    | validation   | comentário vazio, longo demais ou com invisível (bloco 6)       |
| `unauthenticated`          | 401    | unauthorized | sem token, token inválido, vencido ou de outro projeto          |
| `not_fan`                  | 403    | forbidden    | conta só da equipe tentando gravar                              |
| `not_found`                | 404    | notFound     | rota que não existe                                             |
| `artist_not_found`         | 404    | notFound     | central inexistente, fora do ar ou id fora do formato (bloco 4) |
| `invite_not_found`         | 404    | notFound     | código de convite que não existe (bloco 5)                      |
| `post_not_found`           | 404    | notFound     | post que não existe ou não está visível (bloco 6)               |
| `event_not_found`          | 404    | notFound     | show que não existe, fora do ar ou encerrado (bloco 6)          |
| `comment_not_found`        | 404    | notFound     | comentário que não existe ou oculto (bloco 6)                   |
| `fan_not_found`            | 404    | notFound     | fã que não existe, no bloqueio (bloco 6)                        |
| `method_not_allowed`       | 405    | unknown      | rota existe, método não                                         |
| `insufficient_points`      | 409    | validation   | débito maior que o saldo (já em `API_ERROR_CODES`)              |
| `invite_not_allowed`       | 409    | validation   | autoconvite ou conta fora da janela do claim (bloco 5)          |
| `block_list_full`          | 409    | validation   | lista de bloqueios cheia (bloco 6)                              |
| `payload_too_large`        | 413    | unknown      | corpo acima de 16 KiB                                           |
| `idempotency_key_reused`   | 422    | validation   | mesma chave com outro pedido                                    |
| `too_many_requests`        | 429    | unknown      | ação acima do teto do dia (bloco 4, 19.5; bloco 6, 21.7)        |
| `internal`                 | 500    | server       | erro inesperado                                                 |
| `profile_not_ready`        | 503    | server       | gravação sem `users/{uid}` (perfil nascendo ou conta excluída)  |
| `unavailable`              | 503    | server       | disputa, Firestore fora ou falha ao conferir o token            |

Mensagens: `invalid_request` "Pedido inválido."; `idempotency_key_required` "Falta a chave de idempotência."; `unauthenticated` "Entre na sua conta para continuar."; `not_fan` "Esta conta não é de fã."; `not_found` "Não encontrado."; `artist_not_found` "Central não encontrada."; `invite_not_found` "Convite não encontrado."; `invite_not_allowed` "Este convite não vale para esta conta."; `method_not_allowed` "Método não aceito nesta rota."; `insufficient_points` "Saldo insuficiente."; `payload_too_large` "Pedido grande demais."; `idempotency_key_reused` "Esta chave já foi usada em outro pedido."; `too_many_requests` "Tentativas demais por hoje. Tente amanhã."; `internal` "Algo deu errado. Tente de novo."; `profile_not_ready` "Seu perfil ainda está sendo criado. Tente de novo em instantes."; `unavailable` "Serviço ocupado. Tente de novo."; do bloco 6, `post_not_found` "Post não encontrado.", `event_not_found` "Show não encontrado.", `comment_not_found` "Comentário não encontrado.", `fan_not_found` "Fã não encontrado.", `comment_invalid` "Comentário vazio, longo demais ou com caracteres invisíveis." e `block_list_full` "Você chegou ao limite de fãs bloqueados.".

Códigos que os próximos blocos vão criar entram nesta tabela quando nascerem: `reward_not_found` (404) e `sold_out` (409, que também entra no `API_ERROR_CODES` do app no bloco 10). Não há limite de pedidos por minuto no bloco 1: o `maxInstances` segura o custo, e os limites de pontos não são erro (seção 5). A exceção, do bloco 4, é o teto diário de entradas em centrais (19.5), com 429 e `Retry-After`: sem ele, um script que entra e sai sem parar gravaria sem teto e inflaria os fluxos do painel. O bloco 6 faz o mesmo com curtidas, comentários, presenças, denúncias e bloqueios (21.7).

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
| 9   | `POST /invites/claim`                    | `auth/api.ts` `sendInviteClaim`                     | 5     |
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

Fora dos 26, nova no bloco 1: `GET /me/ledger` (extrato). O app ainda não chama: a tela do extrato é do bloco 7 e precisa de desenho. Ela já serve aos testes, que conferem que carteira e extrato fecham, e ao seed. O bloco 7 liga o extrato a uma tela provisória e acrescenta a cada linha o nome da central e o título da missão (22.2).

Fora dos 26, nova no bloco 4: `DELETE /me/centrals/:artistId` (sair da central, `artists/api.ts` `leaveCentral`, seção 19).

Fora dos 26, novas no bloco 5: `POST /invites/visit` (visita ao link no app, `auth/api.ts` `sendInviteVisit`) e `PUT /me/invite/links/:linkId` (link compartilhado, `profile/api.ts` `registerInviteLink`), seção 20.

Fora dos 26, novas no bloco 6: `POST /posts/:postId/comments/:commentId/report` (denunciar comentário, `posts/api.ts` `reportComment`) e `PUT` e `DELETE /me/blocks/:fanId` (bloquear e desbloquear um fã, `posts/api.ts` `blockFan`; o desbloquear ainda sem tela), seção 21. Os endpoints 10 a 18 são os do bloco 6.

O `POST /invites/claim` era endereço provisório (comentário em `auth/api.ts`). O bloco 5 o mantém como final, com o corpo novo (seção 20).

A chave do claim (`invite-<código>-<receivedAt>`) só cabe no formato da `Idempotency-Key` quando o código é válido. Até o bloco 5, a rota `/convite/[codigo]` guardava o parâmetro sem conferir, e o `claimPendingInvite` só esquecia o código depois de sucesso: um código fora do formato gerava uma chave recusada (400, que o app não repete) e ficava preso no aparelho. Hoje a captura normaliza o código (`normalizeInviteCode`) e descarta o que fica fora do formato, a chave do claim usa o código normalizado, e o app esquece o convite só pelas recusas definitivas de `isFinalInviteRejection` (20.11).

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

| Caminho                                                                      | Quem grava                                      | Quem lê pelo cliente                                     | Para quê                                                                                       |
| ---------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `wallets/{uid}`                                                              | servidor (`award` e a marca de atividade)       | equipe com a seção `fans`                                | os três contadores, totais, últimos 7 dias, temporadas passadas e atividade                    |
| `wallets/{uid}/ledger/{entryId}`                                             | servidor (`award`)                              | equipe com `fans`                                        | extrato                                                                                        |
| `wallets/{uid}/centralPoints/{artistId}`                                     | servidor (`award`)                              | equipe com `fans`                                        | pontos do fã em cada central                                                                   |
| `config/points` e `config/points/versions/{n}`                               | servidor (callable do painel, bloco seguinte)   | equipe ativa                                             | valores, limites diários e régua de níveis                                                     |
| `config/season` e `config/season/versions/{n}`                               | servidor (callable do painel, bloco 8)          | equipe ativa                                             | temporada atual                                                                                |
| `config/missions`, `config/achievements`, as versões e `missionArchive/{id}` | servidor (callables do painel, bloco 7)         | equipe com `missions` (as missões também com `overview`) | catálogo de missões, meta da temporada, missões arquivadas e catálogo de conquistas (seção 22) |
| `statsDaily/{dia}` e `statsDaily/{dia}/statsShards/{n}`                      | servidor (`award`; fechamento do dia depois)    | equipe com `overview` ou `growth`                        | contadores agregados do painel                                                                 |
| `statsMeta/close`                                                            | servidor (fechamento do dia, quando ele entrar) | ninguém                                                  | último dia fechado                                                                             |
| `idempotency/{id}`                                                           | servidor (API)                                  | ninguém                                                  | chaves de idempotência                                                                         |
| `users/{uid}/centrals/{artistId}`                                            | servidor (API, bloco 4)                         | equipe com `fans`                                        | vínculo do fã com a central (seção 19)                                                         |
| `artistStats/{artistId}/fanShards/{n}`                                       | servidor (API e exclusão de conta, bloco 4)     | equipe com `artists`                                     | `fanCount` em shards, copiado para `artists/{id}` (seção 19)                                   |
| `inviteCodes/{code}`                                                         | servidor (API e exclusão de conta, bloco 5)     | ninguém                                                  | dono de cada código de convite (seção 20)                                                      |
| `fanInvites/{uid}` e `fanInvites/{uid}/inviteLinks/{linkId}`                 | servidor (API e exclusão de conta, bloco 5)     | equipe com `fans`                                        | o código do fã e os links que ele compartilhou (seção 20)                                      |
| `fanInvites/{uid}/inviteVisitors/{personKey}`                                | servidor (API e exclusão de conta, bloco 5)     | ninguém                                                  | quem já contou como visitante de cada convidante (seção 20)                                    |
| `referrals/{uid}`                                                            | servidor (API e exclusão de conta, bloco 5)     | equipe com `fans`                                        | quem trouxe o fã, por qual link e campanha (seção 20)                                          |
| `posts/{postId}`                                                             | servidor (callables do painel, API, bloco 6)    | equipe com `artists`, `moderation` ou `fans`             | mural (seção 21)                                                                               |
| `posts/{postId}/postComments/{commentId}`                                    | servidor (API e callable, bloco 6)              | equipe com `artists` ou `moderation`                     | comentários (seção 21)                                                                         |
| `postStats/{postId}/countShards/{n}`                                         | servidor (API e exclusão de conta, bloco 6)     | ninguém                                                  | curtidas e comentários em shards, copiados para o post (seção 21)                              |
| `events/{eventId}`                                                           | servidor (callables do painel, bloco 6)         | equipe com `artists`, `moderation` ou `fans`             | shows da agenda (seção 21)                                                                     |
| `users/{uid}/postLikes/{postId}` e `users/{uid}/eventRsvps/{eventId}`        | servidor (API, bloco 6)                         | equipe com `fans`                                        | curtidas e presenças do fã, com o estado (seção 21)                                            |
| `commentReports/{id}` e `moderationQueue/{commentId}`                        | servidor (API e callable, bloco 6)              | equipe com `moderation`                                  | denúncias e fila da Moderação (seção 21)                                                       |
| `blockLists/{uid}`                                                           | servidor (API e exclusão de conta, bloco 6)     | ninguém                                                  | quem cada fã bloqueou (seção 21)                                                               |

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

Os números do convite (links criados e pessoas trazidas) não moram na carteira: um link que viraliza faria dela um documento disputado, e a disputa derrubaria o cadastro de quem foi convidado. O bloco 5 os guarda sem documento disputado (seção 20), e o `/me/progress` lê os dois lugares.

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

| source          | kind   | eventId                 | valor padrão                     | limite diário padrão |
| --------------- | ------ | ----------------------- | -------------------------------- | -------------------- |
| `like`          | earn   | id do post              | 0                                | 50                   |
| `comment`       | earn   | id do comentário        | 2                                | 20                   |
| `rsvp`          | earn   | id do show              | 0                                | 10                   |
| `central_join`  | earn   | id da central           | 10                               | 10                   |
| `mission`       | earn   | `<missionId>:<período>` | o da missão (`points` explícito) | sem limite           |
| `invite_visit`  | earn   | chave da pessoa (20.5)  | 2                                | 50                   |
| `invite_signup` | earn   | chave da pessoa (20.5)  | 10                               | 20                   |
| `redeem`        | spend  | id do resgate           | o custo da recompensa            | não se aplica        |
| `adjustment`    | adjust | id do ajuste da equipe  | explícito por contador           | não se aplica        |
| `seed`          | adjust | nome fixo do seed       | explícito por contador           | não se aplica        |

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
- `stats.linksCreated` e `stats.peopleBrought`: 0 no bloco 1. Desde o bloco 5, os `count()` dos links que o fã compartilhou e dos convidados dele, fora da carteira (seção 4 e 20.2).
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
- A origem do fã (link, campanha, UTM) não é isto: o bloco 5 acrescenta `signups`, `invites` e `byOrigin` nos mesmos shards (20.7). Cadastros por dia também são do bloco 5, somados no gatilho de cadastro; os anteriores saem do `createdAt` de `users/` numa carga única (20.7).
- Gravação: `tx.set(shardRef, objetoComIncrements, { merge: true })`. Chaves de mapa vão como objeto aninhado, não como caminho com ponto.
- Contador zerado não é gravado (`pruneZeros`, em `points/stats.ts`): um shard que só viu atividade não tem `totals`, e um sem resgate não tem `spent`. Quem lê (o fechamento do dia, o painel) trata campo ausente como 0.

### Fãs ativos e retenção

A Crescimento do painel promete "cadastros, ativos e retenção" (`imagineup-admin/src/lib/staff.ts`). Para isso, a atividade não depende de ponto.

- **Definição de ativo:** o fã que fez, no período, ao menos uma ação que grava pela API (curtir, descurtir, comentar, "Eu vou", seguir ou entrar numa central, missão, resgate, convite), rendendo ponto ou não. Abrir o app e só ler não conta, porque a leitura não grava nada. Se a cliente quiser contar quem só abriu o app, um bloco seguinte marca a atividade também no primeiro `GET` do dia (uma gravação por fã por dia).
- **Marca:** o `requireFan` compara o dia, a semana e o mês do pedido com `wallet.activity`. Dia novo soma `actives.day`; semana nova soma `actives.newInWeek` e `cohorts[<semana do cadastro>].active`; mês novo soma `actives.newInMonth`. A semana do cadastro sai do `createdAt` de `users/{uid}`, que o `requireFan` já leu. A carteira guarda as marcas novas. São no máximo uma gravação de carteira e uma de shard por fã por dia, além das que o ponto já faz.
- Só quem chama marca, e só com `actor.type: 'fan'`. Ajuste da equipe, seed e o crédito de quem convidou não marcam.
- **Leitura:** ativos do dia D são a soma de `actives.day` em D; da semana, a soma de `actives.newInWeek` nos dias dela; do mês, a soma de `actives.newInMonth` nos dias dele (somar os ativos de cada dia contaria o mesmo fã várias vezes). Ativos da coorte C na semana S são a soma de `cohorts[C].active` nos dias de S; a retenção divide isso pelos cadastros da semana C (`signups.total`, 20.7).

### Custo e limite de escrita

- Uma gravação de shard por transação que lançou ponto, marcou atividade nova ou somou um fluxo sem ponto, qualquer que seja o número de lançamentos e de fãs nela. Os fluxos sem ponto vieram nos blocos seguintes: entrar e sair de central (bloco 4, 19.9), cadastro, convite, visita e link (bloco 5, 20.7) e, no bloco 6, toda curtida, descurtida, comentário, presença, desfazer, denúncia e bloqueio (21.10), pontue ou não. Transação sem nada aplicado, sem marca nova e sem fluxo não grava shard (nem carteira).
- **Teto:** o Firestore aguenta perto de 1 gravação por segundo por documento de forma sustentada (rajadas curtas passam). Com 64 shards, o dia aguenta perto de 64 transações que gravam shard por segundo no país todo, cerca de 230 mil por hora, sustentadas, divididas entre os pontos, a atividade, as centrais, o convite e todo o engajamento do bloco 6 (as curtidas e os comentários são o grosso). Cada fã, pela carteira, já fica perto de 1 por segundo.
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

As ações de auditoria novas entram no `AuditAction` de `functions/src/staff/service.ts`. As callables existentes da equipe e dos artistas não mudam. O bloco 7 faz o `updatePointsConfig` e antecipa o `updateSeason` (22.8); o `adjustFanPoints` fica para o bloco 11.

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

As regras do bloco 4 (vínculo e shards do `fanCount`) estão na seção 19, as do bloco 5 (convite), em 20.9, e as do bloco 6 (mural, agenda e moderação), em 21.11.

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

O bloco 4 muda o passo 2: o documento do perfil sai sozinho primeiro, depois saem os vínculos com as centrais (descontando o `fanCount`) e só então o `recursiveDelete(users/{uid})`. Ordem completa e motivo na seção 19 (19.12). O bloco 5 acrescenta o código, os links e os convites (20.10). O bloco 6 acrescenta as curtidas, os comentários, as denúncias e os bloqueios (21.12).

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
- Links criados e pessoas trazidas (63 e 418 nas fixtures) ficam 0 até o bloco 5. Com ele, a Camila tem 4 links e 3 pessoas trazidas no servidor (20.12), e os 63 e 418 ficam só nas fixtures.
- Rodar de novo não muda nada: os lançamentos já existem e voltam `duplicate`, e transação sem nada aplicado não grava a carteira (seção 5, passo 9).
- O Alan fica sem carteira: é o fã novo (0 pontos, nível 1).
- O bloco 7 acrescenta 8 lançamentos de missão antes da base e diminui a base no mesmo tanto, para a meta da temporada dar 12 de 20 sem mudar os totais (22.13).

Resultado na 1e: "SEUS PONTOS" 12.480; Purainha (7), anel e barra em 68,5%, faltam 2.520; "Esta semana" +840; 0 links, 0 pessoas e 3 temporadas (com o bloco 5, 4 links e 3 pessoas, 20.12).

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
8. **Como montar o feed.** Bloco 6. A consulta por `artistId` com `in` (até 30 centrais) basta enquanto o fã seguir poucas centrais; sem cópia por fã. Fechado no bloco 6 (21.2): `in` em blocos de 30 centrais, juntados na mesma ordem.
9. **Antifraude.** Limites diários por origem no servidor, sem App Check por enquanto (seção 5).
10. **Ambiente de testes.** Documentado; espera o ok da cliente (seção 15).
11. **Onde o mural e a agenda entram no painel.** Bloco 6. Não muda nada no bloco 1. Fechado no bloco 6 (21.1, decisão 1): dentro da seção `artists`, sem seção nova; as telas são do bloco 11.
12. **Exclusão de conta.** Agregados não descontam (seção 12). Direção para os outros blocos: comentários do fã excluído são apagados, com a contagem do post descontada (bloco 6, 21.12, ainda pergunta para a cliente e a revisão jurídica); resgate em aberto continua para a equipe entregar ou cancelar, sem o uid e com o status de conta excluída (bloco 10).

## 18. O que fica para os próximos blocos

- **Bloco 4 (centrais):** desenhado na seção 19. O que ele deixa para os blocos seguintes está em 19.16.
- **Bloco 5 (convite):** desenhado na seção 20. A visita conta no app, e não numa função própria para o site, como esta nota dizia antes (decisão 3 de 20.1). Os 63 e 418 da Camila ficam nas fixtures, e o seed dá a ela 4 links e 3 convidados (20.12). O que fica fora do bloco está em 20.15.
- **Bloco 6 (mural e agenda):** desenhado na seção 21. O que ele deixa para os blocos seguintes está em 21.17.
- **Bloco 7 (missões e conquistas):** desenhado na seção 22. As telas da seção Missões e régua ficam para o bloco 11, e o que ele deixa para os blocos seguintes está em 22.16.
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

## 20. Bloco 5: convite com atribuição e origem do fã

O fã ganha um código de convite do servidor, o link dele passa a trazer gente de verdade, e cada fã novo fica com a origem: quem trouxe, por qual link e por qual campanha. Esta seção é o contrato do bloco 5: rotas, coleções, transações, antifraude, regras, efeitos no painel, exclusão de conta, mudanças no app, seed e testes. Ela segue os padrões dos blocos 1 e 4 (seções 1 a 19) e só diz o que muda ou acrescenta.

Origem: o levantamento de 05/10/2026 (bloco 5); a UP-16 e a UP-20 (+2 por pessoa que abre o link e +10 por cadastro, valores provisórios de `config/points`); a UP-33 (qual link trouxe cada fã); a UP-39 (comparar campanhas no painel). A build sem emulador continua nas fixtures, e o `EXPO_PUBLIC_API_URL` segue a regra da seção 13.

Estado: implementado em 05/10/2026 no app e nas funções, sem deploy (ordem da publicação em 20.16). Onde o código detalhou ou desviou desta seção, o texto abaixo já diz como ficou, marcado com "(implementação)", como na seção 19.

Como era antes do bloco: o `+native-intent` lia o `?ref=` de qualquer link e o `/c/CODIGO`; a rota `/convite/[codigo]` guardava o código no aparelho sem conferir; o cadastro mandava `{ code }` para `POST /invites/claim`, que ninguém respondia (com o emulador, a chamada nem saía, porque `sourceOf('invite')` estava nas fixtures). Os `utm_*` do link ficavam no destino da navegação e se perdiam; no link curto, a busca inteira sumia. O código ficava preso ao aparelho, e não à conta: se o envio falhasse, ele ia no próximo cadastro feito ali, que podia ser de outra pessoa.

### 20.1 Decisões

Cada item traz a recomendação e o motivo. As perguntas para a cliente e para o dono estão em 20.14, e o código já nasce com o padrão daqui.

1. **Código por fã, sorteado no servidor e criado no primeiro `GET /me/invite`.** Oito caracteres de `23456789BCDFGHJKMNPQRSTVWXYZ`: sem vogal (não forma palavra) e sem 0, 1, I, L e O (não se confundem ao ditar nem ao digitar no cadastro). São 28^8, perto de 3,8 × 10^11 códigos: colisão e chute ficam fora de alcance. Único por `inviteCodes/{code}` com `tx.create`, e nunca muda. Motivo de criar na leitura: o gatilho de cadastro não muda por isso, e os perfis de antes do bloco 5 não pedem carga. É a exceção à regra do GET que não cria nada (seção 1): a criação é idempotente (o mesmo fã recebe sempre o mesmo código) e exige o perfil. Código tirado do @ foi descartado: o @ ainda pode mudar (Pendências do `CLAUDE.md`), e o código não pode.
2. **Claim final em `POST /invites/claim`, uma vez por conta.** O endereço provisório fica como final, com o corpo novo (20.2). O registro é `referrals/{uid do convidado}`, criado com `tx.create`: um segundo claim, com qualquer código, responde `already_claimed` sem efeito. Só vale para conta criada há até 7 dias (`INVITE_CLAIM_WINDOW_MS`): conta antiga que abre um link não vira convidada. O claim exige o perfil (`requireFan`), que é o "cadastro concluído", e paga quem convidou na mesma transação.
3. **Visita conta só no app, de conta logada de outra pessoa que não o dono do código.** O app manda `POST /invites/visit` quando um link com código abre o app com uma conta, ou quando a pessoa entra numa conta que já existe logo depois de abrir o link. A visita é contada no painel uma vez por par convidante e pessoa, pelo marcador `fanInvites/{inviterUid}/inviteVisitors/{personKey}`, pague ou não; o ponto (`invite_visit`) segue o extrato, também uma vez na vida por par (20.5), dentro do limite diário de quem convidou (`invite_visit`, padrão 50). Cada conta manda no máximo 20 visitas por dia. O claim também conta e paga a visita: quem se cadastra pelo link abriu o link antes. Contar e pagar ficam separados porque o lançamento barrado pelo limite (`capped`) ou que valia 0 (`zero`) não grava no extrato (`computeAwards`, em `points/model.ts`): sem o marcador, a mesma pessoa contaria de novo a cada visita. Motivo de contar só no app: o clique no site não tem conta nem token, e qualquer script o repete (o IP não separa as pessoas atrás da mesma operadora); contar no site também pede mudança no repositório do site, que depende da UP-49. Contar só na instalação vale só no Android e depende do bloco 3. Consequência: até os links abrirem o app (bloco 13), a visita no app só acontece com o link do esquema `imagineup://`; na prática, a visita paga vem junto com o cadastro. Troca a direção das seções 1 e 18 (uma função própria para a visita do site, com CORS).
4. **O id do evento é a chave da pessoa, e não o uid.** `personKey`: `e` mais os 40 primeiros caracteres hexadecimais de `HMAC-SHA256(INVITE_KEY_SECRET, "imagineup:invite:v1:" + e-mail normalizado)`, com o e-mail do ID token; sem e-mail no token, `u` mais o uid. Normalização: minúsculas, sem espaço nas pontas, sem o `+` e o que vem depois na parte local; no `gmail.com` e no `googlemail.com`, sem os pontos da parte local e com o domínio `gmail.com`. Os lançamentos são `invite_visit:<personKey>` e `invite_signup:<personKey>`, no extrato de quem convidou. Motivo: esse extrato fica na carteira de quem convidou, que não some quando o convidado exclui a conta. A conta excluída e recriada com o mesmo e-mail ganha outro uid, mas a mesma chave: o lançamento sai `duplicate`, e o mesmo convite não paga de novo. Com outro e-mail paga, dentro do limite diário (limite aceito, 20.6). A mesma chave, calculada com o e-mail de quem é dono do código, barra o autoconvite pelo apelido do e-mail (`ownerKey`, 20.3). HMAC, e não sha256, desde o primeiro deploy: o extrato é lido pela equipe com a seção `fans`, e com sha256 e prefixo fixo qualquer um ali testaria um e-mail conhecido contra o id do lançamento, mesmo depois de o convidado excluir a conta; trocar para HMAC depois faria cada pessoa já convidada pagar de novo uma vez. O segredo fica no Secret Manager (`defineSecret('INVITE_KEY_SECRET')`, no molde do `EMAILJS_PRIVATE_KEY`), declarado só na `api`, e nunca muda (20.16). Guardar essa chave depois da exclusão continua pergunta jurídica (20.14).
5. **Convidado que exclui a conta não desfaz os pontos já pagos.** Sai o `referrals/{uid}` dele, e "pessoas trazidas" de quem convidou cai 1. Os lançamentos ficam no extrato de quem convidou. Motivo: desfazer pediria reescrever a carteira de outro fã no gatilho de exclusão, podia deixar saldo negativo depois de um resgate, e os agregados guardam fluxo (seção 12). Recriar a conta não paga de novo (decisão 4).
6. **Convidante que exclui a conta leva o código, os links e os marcadores de visita.** O código para de valer na hora (404, e o app esquece). Os `referrals` das pessoas que ele trouxe ficam, com `inviterUid: null`. Motivo: a origem é dado do convidado e serve ao painel; o uid de quem saiu não aponta mais para ninguém.
7. **"Links criados" são os links diferentes que o fã compartilhou com o código; "pessoas trazidas" são as contas que existem e entraram pelo convite dele.** Um link por destino: `invite` (o app, pelo atalho Convidar), `agenda`, `post:<postId>` e `artist:<artistId>`. O app registra o link (`PUT /me/invite/links/:linkId`) quando a folha de compartilhar do sistema volta com `sharedAction`. Os dois números são `count()`, fora da carteira e sem documento disputado (seção 4). Motivo: com o código estável, criar um link é compartilhar uma página, e o servidor só sabe disso se o app contar. Contar os links que trouxeram alguém mudaria o sentido para "links que funcionaram".
8. **Origem: o app manda o caminho e os `utm_*`; o servidor classifica e normaliza.** O tipo do link sai do caminho (`invite`, `post`, `artist`, `agenda`, `other`; `code` quando o código foi digitado). Só `utm_source`, `utm_medium` e `utm_campaign` são guardados, normalizados e sem dado pessoal (20.3); `utm_content`, `utm_term` e `utm_id` são descartados, porque é neles que costuma ir o e-mail ou o id de quem recebeu o link. A origem fica no `referrals` e entra nos agregados do dia: o tipo em cadastros, visitas e links; `utm_source` e `utm_campaign` só nos cadastros (20.7). Campanha é o `utm_campaign` de um link com código até a cliente responder; o link que só tem `utm_*`, sem código, não guarda nada neste bloco (pergunta 3 de 20.14). Motivo: um lugar só classifica, e um tipo de link novo não pede app novo.
9. **Campo "Código de convite" no cadastro, opcional e conferido pelo próprio claim.** Vem preenchido com o código do link guardado, quando há. O código digitado é conferido no servidor antes de o fã sair do cadastro: recusado, a conta já existe, e a tela fica para ele corrigir ou continuar sem código (20.11). Motivo: não há rota sem token (decisão 2 desta nota), e o token só existe depois da conta.
10. **Convite pendente amarrado ao uid no cadastro.** O cadastro move o convite do aparelho para o armazenamento de convites amarrados (`invite-claims`, por uid), e só a sessão confirmada desse uid tenta de novo, por até 7 dias. A sincronização também amarra quando a conta da sessão nasceu neste aparelho depois de o link chegar e ninguém entrou nela desde então (o app fechou entre criar a conta e amarrar, ou a conta nasceu por um fluxo de entrar, como Apple ou Google), 20.11. Quem entra numa conta que já existe, com um convite guardado de menos de 24 h, manda a visita, e o convite sai do aparelho. Motivo: o convite de uma pessoa nunca vai para a conta de outra que entrar depois no mesmo aparelho, e a conta nova não perde o convite porque o app fechou na hora errada.
11. **Pontos do convite fora das centrais.** Os dois lançamentos vão sem `artistId`, também no link de uma central ou de um post. Motivo: o convite é do fã, não uma ação na central, e o artista do post exigiria ler o post (bloco 6).
12. **Cadastros por dia no gatilho de cadastro.** `signups.total` soma 1 no shard do dia, na mesma transação que cria o perfil (`createProfile`), que marca o perfil como contado (`signupCounted: true`); os cadastros de antes saem do `createdAt` dos perfis sem a marca, numa carga única (20.7). Motivo: é o denominador da retenção por coorte (seção 7) e a base da parte dos cadastros que veio de convite, e só o gatilho vê todo cadastro.
13. **Resposta 200 para o que não paga, e erro só para o que o app deve esquecer.** Claim repetido, visita do próprio dono, visita acima do teto e link já registrado respondem 200 sem efeito. Código que não existe é 404 `invite_not_found`; a própria conta dona do código e a conta fora da janela são 409 `invite_not_allowed`. Motivo: o app trata as recusas definitivas de um jeito só (esquece o código), e a resposta repetida pela idempotência fica simples. (implementação) Nenhuma resposta diz a quem chama se a pessoa do e-mail dele é dona do código ou já passou por ele: a visita responde sempre o mesmo corpo, e a dona do código noutra conta (o apelido do e-mail) recebe no claim a resposta de um claim comum (20.6).

### 20.2 Rotas

| Método e caminho               | Grava                 | Função do app                                                  | Resposta                                |
| ------------------------------ | --------------------- | -------------------------------------------------------------- | --------------------------------------- |
| `GET /me/invite`               | cria o código uma vez | `profile/api.ts` `fetchMyInvite`                               | `MyInvite`                              |
| `POST /invites/claim`          | sim                   | `auth/api.ts` `sendInviteClaim` (troca o `claimPendingInvite`) | `InviteClaimResult`                     |
| `POST /invites/visit`          | sim                   | `auth/api.ts` `sendInviteVisit` (novo)                         | `InviteVisitResult`                     |
| `PUT /me/invite/links/:linkId` | sim                   | `profile/api.ts` `registerInviteLink` (novo)                   | `InviteLinkResult`                      |
| `GET /me/progress`             | não                   | `profile/api.ts` `fetchMyProgress` (como hoje)                 | `MyProgress`, com os números de verdade |

Arquivos: `functions/src/api/routes/invites.ts` (`inviteRoutes`, somadas ao `API_ROUTES` depois de `centralRoutes`) e o domínio em `functions/src/invites/`, no molde de `functions/src/centrals`: `model.ts` (puro, com teste em tabela, constantes e o `InviteError`), `service.ts` (Firestore: `ensureInviteCode`, `claimInvite`, `recordInviteVisit`, `recordInviteLink`, `countInviteStats`, `removeInviteData`, `detachReferrals`, `runClaim` e, para o seed, `runInviteLinks`), `config.ts` (o secret), `seed.ts` e `index.ts`. O `requireFan` ganhou a metade que só confere o perfil, `requireProfile` (em `points/award.ts`), que o `ensureInviteCode` usa (implementação). Os tipos das respostas entram em `api/contract.ts`, espelho de `src/domains/invites/types.ts` (novo) e do `MyInvite` de `src/domains/profile/types.ts`.

O `authenticate` (`api/auth.ts`) passa a devolver `{ uid, email }` (o `email` do token decodificado, ou `null`), e o `ReadContext` ganha `email` (o `WriteContext` o estende). O e-mail sai sempre do token, nunca do corpo. O `ApiDeps` ganha `inviteKey`, o segredo do HMAC (decisão 4): a `api` lê `INVITE_KEY_SECRET.value()` a cada pedido e declara `secrets: [INVITE_KEY_SECRET]` nas opções; os testes fixam a chave. (implementação) É uma função (`inviteKey: () => string`), lida só pelas rotas do convite: sem ela nas dependências, só elas respondem 500, e os testes das outras rotas não precisam dela. A chave da pessoa recusa segredo vazio (erro, nunca chave fraca). O secret mora em `functions/src/invites/config.ts`, como o `EMAILJS_PRIVATE_KEY` em `staff/config.ts`.

Códigos novos, já na tabela da seção 1: `invite_not_found`, 404, "Convite não encontrado.", kind `notFound`; `invite_not_allowed`, 409, "Este convite não vale para esta conta.", kind `validation`, com `details.reason` `self` ou `account_too_old`. O núcleo recusa com `InviteError` (motivo e `details`), e o `toApiHttpError` traduz, como faz com o `CentralError`.

#### `GET /me/invite`

```json
{
  "code": "K7P3M9QX",
  "url": "https://imagineup-painel.vercel.app/?ref=K7P3M9QX",
  "linkBase": "https://imagineup-painel.vercel.app",
  "pointsPerVisit": 2,
  "pointsPerSignup": 10
}
```

- `code`: o de `fanInvites/{uid}`. Sem ele, o `ensureInviteCode` cria (20.4).
- `url`: o link do atalho Convidar, o `linkBase` mais `/?ref=<code>`.
- `linkBase`: `INVITE_LINK_BASE`, de `invites/model.ts`, espelho do `SHARE_LINK_BASE` do app. Com ele, a troca de domínio (bloco 13) muda os links que o fã compartilha sem build nova.
- `pointsPerVisit` e `pointsPerSignup`: `values.invite_visit` e `values.invite_signup` da configuração, pelo cache de 60 s.
- `url` e `linkBase` são campos novos, opcionais no `MyInvite` do app.
- Sem perfil: 403 `not_fan` (conta só da equipe) ou 503 `profile_not_ready`, como nas rotas que gravam. Não marca atividade e não grava shard.
- Custo: 1 leitura, mais a configuração do cache. Na primeira vez, até 8 leituras e 2 gravações.

#### `POST /invites/claim`

Cabeçalho `Idempotency-Key`: a chave do convite amarrado (`invite-<CODIGO>-<receivedAt>`, 20.11). Corpo:

```json
{
  "code": "K7P3M9QX",
  "via": "link",
  "link": { "path": "/post/p-clipe" },
  "utm": { "source": "instagram", "medium": "story", "campaign": "sao-joao" },
  "openedAt": "2026-10-05T14:02:11.000Z"
}
```

Validação (`parseClaimBody`, pura). Fora dela, 400 `invalid_request` com `details.field` (implementação: `body` para corpo que não é objeto, `utm.source`, `utm.medium` e `utm.campaign` para o valor que não é texto ou passa de 200, e `openedAt` para o texto que não é data):

- `code`: texto de 3 a 64 caracteres em `^[A-Za-z0-9_-]+$` (o `CODE` do app). O servidor normaliza com o `normalizeInviteCode` (sem espaços nem hífens, em maiúsculas) e confere `^[A-Z0-9_]{3,64}$` antes de procurar. O app manda o código já normalizado pela cópia da mesma função (20.11), e é esse o código da chave de idempotência.
- `via`: `link` (link aberto no app) ou `code` (digitado no cadastro). O Install Referrer do bloco 3 acrescenta `install` (20.15).
- `link`: `{ path }` com `via: 'link'`, e `null` com `via: 'code'`. O `path` começa com `/`, sem `//`, até 200 caracteres; o servidor só o usa para classificar (20.3) e não o guarda.
- `utm`: opcional, só com `via: 'link'`. Chaves `source`, `medium` e `campaign`, cada uma texto de até 200. Chave desconhecida é ignorada, inclusive `content`, `term` e `id` (decisão 8).
- `openedAt`: ISO ou `null`, opcional, só com `via: 'link'`; com `via: 'code'`, o servidor grava `null` (o app manda `null`). Fora da faixa de 30 dias antes de agora até 5 min depois, vira `null`. É só informativo (relógio do aparelho).

Respostas: 200 `{ "status": "claimed" }` ou `{ "status": "already_claimed" }`; 404 `invite_not_found`; 409 `invite_not_allowed` (`self`, só para a própria conta dona do código, ou `account_too_old`); 403 e 503 do `requireFan`. (implementação) A dona do código noutra conta, reconhecida pelo `ownerKey`, recebe 200 `claimed`, como qualquer outro claim, e não 409 `self` (20.4 e 20.6).

#### `POST /invites/visit`

Cabeçalho `Idempotency-Key`: `visit-<CODIGO>-<receivedAt>`. Corpo como o do claim, sem `via` e com `link` obrigatório:

```json
{
  "code": "K7P3M9QX",
  "link": { "path": "/artista/nettobrito" },
  "utm": {},
  "openedAt": "2026-10-05T14:02:11.000Z"
}
```

Responde sempre 200 `{ "status": "received" }`, conte ou não, e 404 `invite_not_found` quando o código não existe. O app não mostra nada. (implementação) O desenho anterior respondia `{ "counted": true | false }` (o marcador nasceu nesta chamada ou não), e com ele uma conta com o apelido de um e-mail descobria se aquela pessoa era dona do código ou já tinha passado pelo convite (20.6). O servidor continua calculando o `counted` (`recordInviteVisit`) para os testes e o seed: conta quando a pessoa vira visitante desse convidante pela primeira vez (o marcador nasce), pagando, batendo no limite de quem convidou ou valendo 0; não conta para o próprio dono (pelo uid ou pela chave do e-mail), para a pessoa que já visitou ou se cadastrou pelo convite desse convidante, com a conta de quem convidou excluída e acima do teto de quem visita. O ponto não depende de contar: a visita da mesma pessoa que antes bateu no limite ou valia 0 ainda paga, uma vez, sem contar de novo (20.5).

#### `PUT /me/invite/links/:linkId`

Sem corpo. O `linkId` segue `^(invite|agenda|post:[A-Za-z0-9_-]{1,128}|artist:[a-z0-9_]{3,30})$`, com o @ da central fora dos ids `__.*__`; fora disso, 400 `invalid_request` com `details.field: 'linkId'`. O app manda o id com `encodeURIComponent` (o `:` vira `%3A`). Responde `{ "linkId": "post:p-clipe", "created": true }`; o link que já existe, ou acima do teto de 30 novos por dia, responde `created: false`. Fã que ainda não tem código (nunca chamou o `GET /me/invite`): 404 `invite_not_found`, que o app ignora. (implementação) O link de uma central lê `artists/{@}` no mesmo `getAll` e só nasce com a central publicada: a que não existe, está em rascunho ou fora do ar responde `created: false`, fora do teto do dia e dos agregados (as centrais são reais desde o bloco 4, e sem isso um fã inflaria "links criados" e `byOrigin.kind.artist.links` com @ inventados). O post não é conferido, porque o mural ainda é de exemplo; o bloco 6 confere (21.2). A origem `artist` do claim e da visita (o caminho `/artista/<@>`) também não: conferir pediria uma leitura a mais na transação mais disputada do convite para um campo informativo, que o painel cruza com `artists` ao mostrar, e um @ inventado ali custa ao fraudador uma conta por cadastro (o claim é um por conta).

#### `GET /me/progress`

- `stats.linksCreated`: `count()` de `fanInvites/{uid}/inviteLinks`.
- `stats.peopleBrought`: `count()` de `referrals` com `inviterUid == uid`.
- As duas contagens saem em paralelo com a leitura da carteira. Custo: 2 agregações a mais, cada uma 1 leitura a cada 1.000 entradas. O resto da resposta fica como na seção 6.

### 20.3 Coleções e campos

```
inviteCodes/{code} {          // o código, em maiúsculas, é o id
  code: string
  kind: 'fan'                 // 'campaign' fica para o código de campanha, se a cliente quiser (20.14)
  uid: string                 // dono
  ownerKey: string            // a chave da pessoa do dono (decisão 4), do e-mail do token na criação
  createdAt: Timestamp
  schemaVersion: 1
}

fanInvites/{uid} {
  uid: string
  code: string
  createdAt: Timestamp
  schemaVersion: 1
}

fanInvites/{uid}/inviteLinks/{linkId} {
  uid: string
  linkId: string              // "invite", "agenda", "post:p-clipe", "artist:nettobrito"
  kind: 'invite' | 'agenda' | 'post' | 'artist'
  targetId: string | null     // o id do post ou da central (publicada quando o link nasceu)
  createdAt: Timestamp        // a primeira vez que o fã compartilhou
}

fanInvites/{uid}/inviteVisitors/{personKey} {   // uma pessoa que contou como visitante deste convidante
  via: 'visit' | 'claim'      // o que criou o marcador
  day: string                 // dia de São Paulo
  createdAt: Timestamp
}

referrals/{uid} {             // uid do convidado
  uid: string
  inviterUid: string | null   // null depois que a conta de quem convidou foi excluída, e no autoconvite pela mesma pessoa noutra conta
  code: string
  via: 'link' | 'code'
  link: {
    kind: 'invite' | 'post' | 'artist' | 'agenda' | 'other'
    targetId: string | null   // o id do post ou da central; null no invite, na agenda e no other
  } | null                    // null no código digitado
  utm: { source, medium, campaign }   // normalizados (abaixo), cada um texto ou null
  openedAt: Timestamp | null  // quando o app recebeu o link (relógio do aparelho)
  signupAt: Timestamp | null  // createdAt de users/{uid}
  claimedAt: Timestamp        // o "agora" do pedido
  day: string                 // dia de São Paulo do claim
  award: { visit: AwardStatus | 'self', signup: AwardStatus | 'self' }   // o que quem convidou recebeu; 'self' no autoconvite pela mesma pessoa noutra conta
  inviterRemovedAt: Timestamp | null
  schemaVersion: 1
}
```

- Os cinco nascem com `tx.create`. Ninguém grava pelo cliente.
- As subcoleções se chamam `inviteLinks` e `inviteVisitors`, e não `links` e `visitors`: uma consulta de grupo futura (o painel listando os links mais compartilhados) com um nome genérico alcançaria qualquer coleção com esse nome (a lição da regra de grupo de `centrals`, 19.10).
- O marcador `inviteVisitors` separa contar de pagar (decisão 3): nasce na primeira visita contada ou no claim da pessoa, nunca muda, e só ele soma visita no painel. O id é a chave da pessoa, então a conta excluída e recriada com o mesmo e-mail não conta de novo. Não guarda o uid de quem visitou.
- `classifyInvitePath(path)` (puro): `/` e `/c/<código>` são `invite`; `/post/<id>` é `post` (id em `^[A-Za-z0-9_-]{1,128}$`, fora os `__.*__` que o Firestore reserva, pelo `isContentId` desde o bloco 7: o claim e a visita leem o post para a missão de link, 22.4); `/artista/<id>` é `artist` (id no formato do @); `/agenda` é `agenda`; o resto, e id fora do formato, é `other` com `targetId: null`. O caminho em si não é guardado: o tipo e o id bastam para o painel, e um caminho `other` pode levar qualquer texto.
- `normalizeUtm` (puro), para `source`, `medium` e `campaign`: o valor com `@`, ou com 10 dígitos ou mais contados juntos (ignorando espaço e pontuação), vira `null` antes de tudo; senão, sem espaço nas pontas e em minúsculas; cada trecho fora de `[a-z0-9._~-]` vira um `-`; sem `-` nas pontas; até 100 caracteres; vazio vira `null`. (implementação) Os acentos saem antes da troca (`São João` vira `sao-joao`, e não `s-o-jo-o`), símbolos também entram na conta dos dígitos (o `+` do `+55`), e as pontas perdem também o `_`: o valor nunca é o `_none` dos recortes nem um `__x__`, que o Firestore reserva nos nomes de campo e derrubaria o claim. Os valores crus não são guardados. Motivo: o `.` fica para nomes como `v1.2`, então um e-mail colado (`joao.silva@gmail.com`) viraria `joao.silva-gmail.com`, ainda o e-mail, num documento que a equipe lê; e telefone com DDD (10 ou 11 dígitos) e CPF (11) caem no corte de dígitos, enquanto uma data como `2026-10-05` (8) passa.
- Carteira: `days[dia].count` ganha duas chaves que não rendem ponto, como o `central_entry` (o `DailyActionKey` de `points/model.ts`): `invite_visit_sent` (visitas que a conta mandou no dia) e `invite_link` (links novos no dia). As origens `invite_visit` e `invite_signup` já contam, na carteira de quem convidou, os eventos pagos.
- A chave da pessoa (`personKey`) fica só em ids (dos lançamentos e dos marcadores) e no `ownerKey` de `inviteCodes`, que ninguém lê pelo cliente. Como é HMAC com o segredo do servidor (decisão 4), quem lê o extrato não a liga a um e-mail.
- Contrato, no app e no `contract.ts`: `MyInvite` ganha `url?: string` e `linkBase?: string`. Novos: `InviteClaimBody`, `InviteClaimResult { status: 'claimed' | 'already_claimed' }`, `InviteVisitBody`, `InviteVisitResult { status: 'received' }` (implementação: era `{ counted: boolean }`, 20.2) e `InviteLinkResult { linkId: string; created: boolean }`.

### 20.4 Transações passo a passo

A ordem é a de sempre (seção 5): chave e fã (`runIdempotent`), leituras do domínio, `planAwards`, gravações do domínio. Depois, o `runIdempotent` grava o plano e a chave. O núcleo fica em `invites/service.ts`, usado pelas rotas e pelo seed.

`ensureInviteCode(db, { uid, email }, deps)`, do `GET /me/invite`, fora do `runIdempotent`:

1. Lê `fanInvites/{uid}` fora de transação. Existe: devolve o código.
2. Numa transação, com o `retryOnAlreadyExists`: lê `fanInvites/{uid}` e `users/{uid}`. Já existe (outra chamada criou no meio): devolve. Sem perfil: lê `staff/{uid}` e recusa como o `requireFan` (`not_fan` ou `profile_not_ready`).
3. Sorteia 5 códigos (o `random` das dependências, que os testes fixam) e lê os 5 `inviteCodes/{c}` num `getAll`. Fica com o primeiro livre. Os 5 tomados é erro (500), que na prática não acontece.
4. `tx.create` de `inviteCodes/{code}`, com o `ownerKey` (`personKey(email, uid, inviteKey)`), e de `fanInvites/{uid}`.

Dois `GET` ao mesmo tempo dão um código só: um repete e acha o `fanInvites` criado.

`claimInvite`, do `POST /invites/claim`:

1. O `runIdempotent` leu a chave, o perfil e a carteira do convidado e marcou a atividade.
2. Um `getAll`: `inviteCodes/{CODIGO}` e `referrals/{uid}`.
3. Código que não existe: `InviteError('invite_not_found')`. Nada foi gravado, e a chave não fica.
4. `referrals/{uid}` existe: responde `already_claimed`, sem plano (fica só a atividade).
5. A chave de quem chama, `personKey(email, uid, inviteKey)`, sai uma vez aqui. O dono do código é quem chama (o `uid` do código) ou a mesma pessoa noutra conta (o `ownerKey` do código igual a essa chave: `nome+1@gmail.com` ou `n.o.m.e@gmail.com` da dona de `nome@gmail.com`; `inviteOwnership`, em `invites/model.ts`). A própria conta dona do código: `invite_not_allowed` com `reason: 'self'`.
6. `fan.profileCreatedAt` nulo, ou mais de 7 dias antes do agora: `invite_not_allowed` com `reason: 'account_too_old'`.
7. (implementação) A mesma pessoa noutra conta: `tx.create` de `referrals/{uid}` com `inviterUid: null` e `award: { visit: 'self', signup: 'self' }`, sem plano, sem marcador e sem agregado, e responde `claimed`. A conta gasta o claim único, como num claim comum, e não entra em "pessoas trazidas" (a consulta é por `inviterUid`). O desenho anterior respondia 409 `self` também aqui, e a recusa, que não gastava o claim, deixava qualquer um testar se um e-mail é o dono de um código público criando uma conta com o apelido dele (20.6). A ordem conta: a janela de 7 dias vem antes, para a dona e a outra pessoa receberem a mesma recusa com uma conta antiga.
8. `tx.get` do marcador `fanInvites/{inviterUid}/inviteVisitors/{personKey}`. Fica fora do `getAll` do passo 2 porque o caminho depende do dono, que só se sabe depois de ler o código: é uma ida a mais dentro da transação.
9. `planAwards(tx, db, [{ uid, entries: [], fan }, { uid: inviterUid, entries }], award)`, com `{ kind: 'earn', source: 'invite_visit', eventId: personKey, subject: { type: 'invite', id: CODIGO } }` e o mesmo com `invite_signup`. O plano lê a temporada, o perfil e a carteira de quem convidou e os dois lançamentos no extrato dele. Quem convidou sem perfil (conta excluída no meio) sai `skipped` (seção 5, passo 3).
10. `tx.create` de `referrals/{uid}`, com o `award` tirado do `plan.results` (o status de cada lançamento de quem convidou).
11. Quem convidou tem perfil (os lançamentos não saíram `skipped`) e o marcador não existe: `tx.create` do marcador, com `via: 'claim'`.
12. `addInviteCounts(plan, ...)`, em `points/award.ts`, como o `addMembershipCounts`: um cadastro convidado, com o tipo, a `utm_source` e a `utm_campaign`, e uma visita, só pelo tipo, quando o marcador nasceu no passo 11 (20.7).
13. Responde `claimed` com o plano.

Custo: 11 leituras (chave, perfil, carteira, código, convite, marcador, temporada, perfil e carteira de quem convidou, dois lançamentos) e até 8 gravações (chave, `referrals`, marcador, carteira de quem convidou, dois lançamentos, shard e a carteira do convidado, pela atividade).

`recordInviteVisit`, do `POST /invites/visit`:

1. O `runIdempotent` leu a chave, o perfil e a carteira de quem visita.
2. `tx.get(inviteCodes/{CODIGO})`. Não existe: 404.
3. O dono do código é quem chama, pelo `uid` ou pelo `ownerKey` (como no passo 5 do claim): não conta, sem plano.
4. `fan.wallet.days[dia].count.invite_visit_sent` já em 20 (`INVITE_VISITS_SENT_PER_DAY`): não conta, sem plano. (implementação) O teto e o contador valem para o fã que chama; o sistema (seed, testes) não conta, como o `central_entry` do bloco 4. O mesmo vale para os links (`invite_link`).
5. `tx.get` do marcador `fanInvites/{inviterUid}/inviteVisitors/{personKey}`.
6. `planAwards` com quem chama sem lançamentos e quem convidou com o `invite_visit` (`eventId: personKey`). Roda também com o marcador já criado: a visita que antes saiu `capped` ou `zero` paga agora, e a que já pagou sai `duplicate`.
7. `addDailyCount(plan, fan, 'invite_visit_sent')`.
8. Quem convidou tem perfil e o marcador não existe: `tx.create` do marcador, com `via: 'visit'`, e o `addInviteCounts` soma uma visita pelo tipo. `counted` é o marcador ter nascido aqui.
9. A rota responde `{ status: 'received' }` em todos os casos, com o plano quando houve (implementação, 20.2): o `counted` fica no servidor.

Custo: 9 leituras (chave, perfil, carteira, código, marcador, temporada, perfil e carteira de quem convidou, o lançamento) e até 6 gravações (chave, as duas carteiras, o lançamento, o marcador e o shard).

`recordInviteLink`, do `PUT /me/invite/links/:linkId`:

1. Um `getAll`: `fanInvites/{uid}` e `fanInvites/{uid}/inviteLinks/{linkId}` e, no link de uma central, `artists/{@}` (implementação).
2. Sem `fanInvites`: 404 `invite_not_found`.
3. O link existe, a central não existe ou não está `published`, ou `days[dia].count.invite_link` já em 30 (`INVITE_LINKS_PER_DAY`): `created: false`, sem plano.
4. `planAwards` sem lançamentos (não lê nada), `tx.create` do link, `addDailyCount(plan, fan, 'invite_link')` e o `addInviteCounts` com um link do tipo dele.
5. Responde `created: true` com o plano.

Concorrência: muitos convidados do mesmo código ao mesmo tempo leem a carteira de quem convidou, e os que pagam gravam nela. Os limites diários seguram isso: depois de 20 cadastros e 50 visitas pagos no dia, o claim só lê a carteira de quem convidou, e leitura não trava leitura. Até lá, a disputa faz a transação repetir e, no pior caso, o claim responde 503 e o app tenta de novo depois, com o convite amarrado. O cadastro em si nunca cai por isso, porque não depende do claim. Os números do perfil (links e pessoas) não ficam em documento nenhum de quem convidou, então um link que viraliza não cria contador disputado. Dois claims da mesma conta ao mesmo tempo, com códigos diferentes, disputam o `referrals/{uid}`: um repete e responde `already_claimed`. O marcador é um documento por pessoa e convidante, então não cria disputa entre convidados; duas visitas da mesma pessoa ao mesmo tempo disputam o mesmo marcador, e a que repete (pela disputa ou pelo `ALREADY_EXISTS` do `tx.create`, que o `runIdempotent` repete uma vez) acha o marcador e não conta de novo.

### 20.5 Idempotência e o evento de pontos

- Pedido: a `Idempotency-Key` de sempre. No claim, é a chave do convite amarrado ao uid (20.11): a mesma em toda tentativa, e o convite sai do aparelho depois de sucesso ou recusa definitiva. Na visita, `visit-<CODIGO>-<receivedAt>`. No link, `createIdempotencyKey()` nas variáveis da mutação, a mesma nas novas tentativas dela.
- Negócio, em quatro camadas: `referrals/{uid}` é um por conta; `invite_signup:<personKey>` e `invite_visit:<personKey>` pagam uma vez na vida por par de quem convidou e pessoa, também depois de a conta ser excluída e recriada; o marcador `inviteVisitors/{personKey}` conta a visita no painel uma vez por par, pague ou não; o link é um por `linkId` e fã. O extrato não serve para contar: o lançamento `capped` ou `zero` não é gravado, e a trava pelo extrato só existe depois de pagar.
- Valores e limites de `config/points` (seção 4): `invite_visit` 2 por evento e 50 por dia, `invite_signup` 10 e 20 por dia, os dois contados na carteira de quem recebe. É o "limite diário por convidante".
- O cadastro que bateu no limite do dia não paga depois: o claim acontece uma vez por conta, e o `award` do `referrals` guarda `capped`. A visita que bateu no limite (ou valia 0) pode pagar depois, uma vez, se a mesma pessoa abrir um link desse convidante no app noutro dia (seção 5, limites diários); essa visita paga sem contar de novo, porque a pessoa já foi contada no painel.

### 20.6 Antifraude

| Risco                                     | Barreira                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autoconvite                               | a própria conta dona do código: 409 `self` no claim; a mesma pessoa noutra conta, pelo `ownerKey` do código (o apelido do e-mail da dona, com `+` ou com os pontos do Gmail, dá a mesma chave): o claim responde `claimed`, como qualquer outro, e grava o `referrals` sem quem convidou, com o `award` `self`, sem ponto, marcador nem agregado; na visita, nenhum dos dois conta |
| Mais de um claim por conta                | `referrals/{uid}` com `tx.create`; o segundo é `already_claimed`                                                                                                                                                                                                                                                                                                                   |
| Conta antiga virando convidada            | janela de 7 dias desde o `createdAt` do perfil                                                                                                                                                                                                                                                                                                                                     |
| Convidante fabricando contas              | limite diário de quem convidou (20 cadastros e 50 visitas pagos) e o perfil exigido                                                                                                                                                                                                                                                                                                |
| Conta excluída e recriada                 | o id do evento é a chave da pessoa, e o lançamento sai `duplicate`; o marcador da visita também é por pessoa, e ela não conta de novo no painel                                                                                                                                                                                                                                    |
| Visitas em massa                          | contadas uma vez por par pelo marcador e pagas uma vez por par pelo extrato, 20 por dia por conta que visita, só com perfil                                                                                                                                                                                                                                                        |
| Links inflados                            | um por destino, 30 novos por dia; o link de uma central só com ela publicada                                                                                                                                                                                                                                                                                                       |
| Chaves de campanha ao acaso nos agregados | `utm_source` e `utm_campaign` só nos cadastros (um claim por conta, de conta com perfil e de até 7 dias); visitas e links só pelo tipo, que é fechado; valor normalizado (20.3) e chave cortada em 40 caracteres                                                                                                                                                                   |
| E-mail testado contra o extrato           | a chave da pessoa é HMAC com segredo do servidor, e não sha256 (decisão 4)                                                                                                                                                                                                                                                                                                         |
| Sondagem do e-mail pelas respostas        | a visita responde sempre o mesmo corpo, e a dona do código noutra conta recebe no claim a resposta de um claim comum: uma conta com o apelido de um e-mail não descobre pela API se aquela pessoa é dona de um código nem se já passou por ele (implementação)                                                                                                                     |

Limites aceitos: e-mail diferente paga de novo (o Firebase não exige e-mail confirmado, e o app não tem a confirmação); uma pessoa pode ser convidada por um fã, excluir a conta e se cadastrar pelo código de outro.

(implementação) A chave da pessoa, tirada de um e-mail que ninguém confirma, é pseudônimo fraco: qualquer um cria uma conta com o apelido de um e-mail (`maria+1@gmail.com`) e passa a ter a chave daquela pessoa. A API não mostra o resultado da comparação (as duas barreiras de sondagem da tabela), mas os efeitos dela continuam à vista de dois lados: quem convidou vê o próprio saldo subir ou não quando visita o próprio link com o apelido de alguém (descobre se aquela pessoa já tinha passado por ele), e a equipe com `fans`, que lê qualquer carteira e qualquer extrato com os ids crus, consegue o HMAC de um e-mail pelo extrato da própria conta de fã e procura nos outros, ou vê um lançamento novo aparecer no extrato de outro fã depois de uma visita. O HMAC segura só quem lê os ids sem criar contas (um backup ou uma exportação). O `id` do `GET /me/ledger` continua o id do documento (`invite_visit:<chave>`): escondê-lo do fã não fecharia nada disso, porque o fã não lê o extrato de mais ninguém e a equipe lê os ids direto no Firestore; a tela do extrato é do bloco 7, que decide o que ela mostra. Fechar de vez pede o e-mail confirmado para o convite contar (pergunta 5 de 20.14). Os dois ficam dentro dos limites diários, e excluir a conta custa ao fraudador os pontos dela. Exigir e-mail confirmado para pagar o cadastro é pergunta para a cliente (20.14). Cada chave nova de `utm_source` ou `utm_campaign` nos shards custa ao fraudador uma conta nova com perfil; se os shards começarem a crescer por isso (o documento tem teto de 1 MiB e de 20 mil campos), o passo seguinte é só as campanhas cadastradas pela equipe virarem chave, e o resto cair em `_other`, o que combina com a resposta à pergunta 3 de 20.14. Sem App Check, como no bloco 1 (seção 5).

### 20.7 Agregados do painel e cadastros por dia

O `ShardDelta` (`points/stats.ts`) ganha:

```
signups: {
  total: number      // contas de fã criadas no dia (gatilho de cadastro)
  invited: number    // claims aceitos no dia (a conta entrou por convite; o dia é o do claim)
}
invites: {
  visits: number     // pessoas contadas como visitantes de um convidante (o marcador nasceu), do claim e do app
  links: number      // links novos registrados
}
byOrigin: {
  kind: { <invite|post|artist|agenda|other|code>: { signups, visits, links } }
  utmSource: { <utm_source ou "_none">: { signups } }
  utmCampaign: { <utm_campaign ou "_none">: { signups } }
}
```

- `addInviteToShard(delta, { event: 'signup' | 'visit' | 'link', kind, utmSource?, utmCampaign? })` soma 1 no total e no `kind`; os recortes de `utm_*` só no `signup`. O `addInviteCounts(plan, change)` cria o `plan.shard` quando ele veio `null`, como o `addMembershipCounts`. Continua uma gravação de shard por transação. Contador zerado não é gravado (`pruneZeros`).
- Por que os `utm_*` só nos cadastros: quem cria o link escolhe o valor, e cada valor novo é uma chave nova no shard. O claim é um por conta, de conta com perfil e de até 7 dias, então cada chave nova custa uma conta nova; a visita e o link custariam bem menos (20 visitas e 30 links por conta e dia). O `kind` é fechado (seis valores).
- Chave dos recortes: o valor normalizado (20.3) cortado em 40 caracteres; sem valor, `_none` (nunca `__x__`, que o Firestore reserva).
- São fluxo, como o resto do shard: a exclusão de conta não desconta nada (seção 12). O estoque (pessoas trazidas hoje) é o `count()` de `referrals`.
- Isenção de índice: `statsShards.byOrigin` (mapas com chaves soltas), como `bySource` e `byArtist`.
- **Cadastros no gatilho:** o `createProfile` (`functions/src/store.ts`) recebe o relógio e o sorteio do shard (injetáveis nos testes; implementação: `createProfile(db, user, random, { now, shardRandom })`) e, na mesma transação que cria o perfil, faz `tx.set(shardRef(db, dia, pickShard(random)), shardWrite(delta, dia, agora), { merge: true })`, com `signups.total: 1` no `delta`, e grava `signupCounted: true` no perfil novo (a marca que a carga abaixo usa). Só quando cria: a entrega repetida acha o perfil e não soma de novo. Conta da equipe não passa por aqui. A conta excluída nos milissegundos da criação (o `handleUserCreated` desfaz) fica contada: foi um cadastro. O dia é o do relógio da função, e o `createdAt` do perfil é o `serverTimestamp`; perto da meia-noite, os dois podem cair em dias diferentes por milissegundos, sem efeito prático. A marca não muda nada para o fã: o app lê só os campos que conhece (`toFanProfile`, em `profile/api.ts`), e a regra de edição do perfil olha só as chaves que o pedido muda (`diff().affectedKeys()`).
- **Retenção:** ativos da coorte C na semana S (seção 7) divididos pela soma de `signups.total` nos dias da semana C.
- **Parte dos cadastros que veio de convite:** `signups.invited` sobre `signups.total`, lida por semana ou período maior, nunca por dia. O `signups.invited` cai no dia do claim, que pode vir até 7 dias depois do cadastro (o convite amarrado que só foi aceito numa nova tentativa), e o `signups.total` no dia do cadastro: num dia só, a razão pode passar de 100%. Somar o claim no dia do cadastro foi descartado: pediria uma segunda gravação de shard, num dia que o fechamento (seção 7) pode já ter fechado, e o dia fechado não muda. O número exato por dia de cadastro sai do `signupAt` de cada `referrals`, na seção Fãs.
- **Carga dos cadastros de antes:** `scripts/backfill-signups.mjs`, no molde do `staff-bootstrap-invite.mjs`. Fora do emulador, pede `--project imagine-up-app` escrito. Lê todo `users` em páginas, conta os perfis sem `signupCounted` (os que nasceram antes do `createUserProfile` novo, ou por uma instância antiga durante a troca de versão do deploy), agrupa pelo dia de São Paulo do `createdAt` (o `dayKey` do build das funções) e soma em `statsDaily/{dia}/statsShards/backfill`: `{ day, signups: { total }, backfill: true, updatedAt }`. Sem `--before`: a marca separa o que o gatilho contou do que a carga conta, então nada conta duas vezes nem fica de fora na troca de versão, quando instâncias velhas e novas convivem. Mostra os dias e os totais antes de gravar. Não ganha entrada no `package.json`, para não mexer no fingerprint da EAS: roda com `node scripts/backfill-signups.mjs`. (implementação) A contagem e a gravação moram em `functions/src/points/backfill.ts` (`countUnmarkedSignups` e `writeSignupBackfill`), que o script carrega do build; `--dry-run` só mostra. Quem lê os shards lista a subcoleção, então o documento `backfill` entra na soma sem mudança.
- (implementação) A carga é só aditiva: em transações de até 200 perfis, relê cada perfil, grava `signupCounted: true` nos que seguem sem a marca e soma com `increment` (`set` com `merge`) no documento `backfill` do dia deles. Rodar de novo só soma os perfis que nasceram sem a marca desde a rodada anterior e nunca desconta: a conta excluída entre duas rodadas continua somada, como em todo agregado (seção 12), e o dia sem perfil novo fica como está. O primeiro desenho regravava cada dia com `set` a partir dos perfis que ainda existiam, e uma segunda rodada (a de 20.16, ou uma meses depois) descontava os fãs que tinham excluído a conta no meio, mudando o denominador da retenção conforme o dia em que a carga rodava. O perfil que sumiu entre a leitura e a transação não é recriado nem somado (`update`, só nos que a transação achou).
- Conta excluída antes da carga não entra, porque não está mais em `users` (nem no Auth). Nenhuma delas tem atividade contada nos shards: nenhuma build chama a API antes do bloco 10 (seção 13), e a carga roda junto com a publicação do bloco 5. A retenção das coortes antigas fica sobre as contas que existiam na carga.
- **Fechamento do dia** (seção 7, ainda não feito): a carga roda antes de o fechamento entrar no ar, senão os dias já fechados ficam sem ela, porque o dia fechado não muda. O fechamento soma também `signups`, `invites` e `byOrigin`, e lista a subcoleção inteira, com o documento `backfill`.

### 20.8 Efeitos no painel

- **Fãs** (bloco 11): de cada fã, o `referrals/{uid}` (quem trouxe, por qual link e campanha, e se pagou; `inviterUid` nulo com o `award` `self` é a dona do código numa segunda conta, e com o `inviterRemovedAt`, quem convidou excluiu a conta); de cada convidante, os convidados (`referrals` por `inviterUid`), o código e os links (`fanInvites/{uid}` e `inviteLinks`). Tudo com a seção `fans`, por `getDoc`, `getDocs` e `count()`, nunca com escuta em tempo real.
- **Visão geral e Crescimento** (bloco 11): cadastros por dia (`signups.total`), a parte que veio de convite (por semana ou mais, 20.7), visitas e links, e os comparativos por tipo de link (cadastros, visitas e links) e por `utm_source` e `utm_campaign` (só cadastros), da UP-39, lidos dos shards (seção 7).
- **Nenhuma mudança no código do painel** neste bloco, e as callables do painel não mudam. O `removeStaffMember` só chega à exclusão de conta pelo gatilho, que passa a limpar também o convite (20.10), sem mudar o que o painel vê.

### 20.9 Regras e índices

Acréscimo ao `firestore.rules`, antes do `match /{document=**}` final. Nenhuma regra existente muda.

```
    // Convite (bloco 5): o código de cada fã, os links que ele compartilhou e
    // quem trouxe quem, com a origem. Só o servidor grava (API). O fã não lê
    // nada disso direto, nem o próprio: chega pela API (/me/invite e
    // /me/progress). A equipe com a seção fans lê (seção Fãs do painel).
    match /inviteCodes/{code} {
      allow read, write: if false;
    }

    match /fanInvites/{uid} {
      allow read: if canSeeSection('fans');
      allow write: if false;

      match /inviteLinks/{linkId} {
        allow read: if canSeeSection('fans');
        allow write: if false;
      }

      // Quem já contou como visitante (o id é a chave da pessoa): só o servidor.
      match /inviteVisitors/{personKey} {
        allow read, write: if false;
      }
    }

    match /referrals/{uid} {
      allow read: if canSeeSection('fans');
      allow write: if false;
    }
```

O `inviteCodes` fica fechado até para a equipe: achar o dono de um código é `fanInvites` com `where('code', '==', ...)`, que a seção `fans` já lê, e o `ownerKey` não sai do servidor. O `inviteVisitors` também: o painel conta visitas pelos shards, e a lista de chaves não diz nada à equipe. O `match /{document=**}` final já negaria os dois; as regras explícitas deixam a intenção escrita e os testes presos a ela. Sem regra de grupo neste bloco.

Índices: só a isenção `{ "collectionGroup": "statsShards", "fieldPath": "byOrigin", "indexes": [] }` em `firestore.indexes.json`. A contagem de `referrals` por `inviterUid` e a busca de `fanInvites` por `code` usam os índices automáticos de campo único. Nenhuma consulta nova pede índice composto, então a publicação não espera índice montado (diferente do bloco 4).

### 20.10 Exclusão de conta

`deleteUserData` (`functions/src/store.ts`), na ordem nova:

1. Reservas de @, como hoje.
2. `users/{uid}` sozinho, como hoje (19.12). Daqui em diante nenhuma gravação da API passa.
3. Novo: `removeInviteData(db, uid)`, em `invites/service.ts`. Lê `fanInvites/{uid}` (e, por segurança, os `inviteCodes` com `uid == <uid>`, implementação); numa transação por código, relê `inviteCodes/{code}` e só o apaga se o `uid` dele for este (o código de outro fã nunca sai); depois, `recursiveDelete(fanInvites/{uid})`, que leva os links e os marcadores de visita. Daqui em diante o código responde 404, e o app de quem guardou o link esquece o código. Um claim ou uma visita que leu o código antes do passo 3 segura a leitura: ou grava o marcador antes de o código sair (e o `recursiveDelete` o leva), ou repete depois e responde 404, então nenhum marcador sobra debaixo de um convidante excluído.
4. `leaveAllCentrals`, como hoje.
5. `recursiveDelete(users/{uid})`, como hoje.
6. Novo: `referrals/{uid}` (o fã como convidado). Os pontos que ele rendeu ficam com quem convidou (decisão 5), e as "pessoas trazidas" de quem convidou caem 1.
7. Novo: `detachReferrals(db, uid, now)`. Consulta `referrals` com `inviterUid == uid` em páginas e faz `update({ inviterUid: null, inviterRemovedAt })` por página, até a consulta voltar vazia. (implementação) Páginas de 200, cada uma numa transação que relê os documentos: o convidado pode estar excluindo a conta ao mesmo tempo, e um `update` num lote sobre um documento que sumiu derrubaria a página inteira. O `update` tira o documento da consulta seguinte, como no `deleteIdempotencyKeys`.
8. Carteira, chaves de idempotência e `staff/{uid}`, como hoje.

Por que nessa ordem: um claim que leu o código antes do passo 3 segura a leitura e grava antes. Se ele achou o perfil de quem convidou já apagado (passo 2), os pontos saem `skipped`, e o `referrals` que ele criou entra na consulta do passo 7. Um claim do próprio fã depois do passo 2 é recusado pelo `requireFan`, então o passo 6 não deixa nada para trás. Repetir é seguro: cada passo relê ou consulta o que sobrou.

O que fica de propósito: no extrato de quem convidou, os lançamentos `invite_*:<personKey>` (a chave da pessoa, que impede pagar de novo), com o `actor` do convidado (um uid que não aponta mais para conta nenhuma); no `inviteVisitors` de quem convidou, o marcador do convidado (a mesma chave, que impede contar de novo no painel). O `referrals` de quem foi trazido por um fã excluído fica, sem o `inviterUid`. Os agregados não descontam.

O `functions/src/store.test.ts` prende a ordem nova, como hoje.

### 20.11 App

**Seletor e consultas**

- `SERVER_DOMAINS` ganha `invite`, no commit que entrega as rotas. Com o emulador, o código, o claim, a visita e os links vão ao servidor; nas builds, tudo fica nas fixtures, como hoje.
- `useMyInviteQuery` espalha `queryOptionsFor('invite')` (rede e disco, seção 13). O código não muda, então o cache salvo serve sem rede.
- `useMyProgressQuery` não muda: "links criados" e "pessoas trazidas" passam a ser os do servidor (seção 6 e 20.2). Nas fixtures, 63 e 418, como hoje.
- O `QUERY_CACHE_VERSION` não sobe: os campos novos do `MyInvite` são opcionais.

**Link recebido** (domínio `invites`, que continua sem API e sem Firebase, por causa do teste de guards)

- `normalizeInviteCode(raw)`, em `invites/link.ts` (puro), cópia do `normalizeInviteCode` do servidor (20.2): tira espaços e hífens, passa para maiúsculas e devolve `null` fora de `^[A-Z0-9_]{3,64}$`. É o único jeito de o app tratar um código: na captura do link, no campo do cadastro, na comparação do `bindPendingInvite`, no corpo do claim e da visita e nas chaves. Mudou um, mude o outro e os testes em tabela dos dois.
- `parseInviteLink` devolve `{ code, destination, utm }`. Todos os `utm_*` saem do destino da navegação, também no link curto (`/c/CODIGO?utm_source=whatsapp`); só `utm_source`, `utm_medium` e `utm_campaign` vão para `utm`, cada valor com até 200 caracteres, e os outros são descartados (decisão 8).
- `inviteRoute` leva os três `utm_*` como parâmetros da rota interna (`/convite/ABC?destino=...&utm_source=...`).
- `InviteCaptureScreen` normaliza o código com o `normalizeInviteCode` antes de guardar (fora do formato, só sai, como a seção 2 pedia) e chama `savePendingInvite(codigoNormalizado, { path: destino ?? '/', utm })`. Assim um `?ref=` em minúsculas ou com hífen guarda o mesmo código que o cadastro mostra. (implementação) Com uma tela de conta segurando o fã (`authHolds > 0`: entrar ou cadastrar no meio, ou o estágio "código recusado"), ela sai com `router.back()`, e não com o `dismissTo(entryRoute(gate))`: com a trava, o `entryRoute` dá a abertura, e o `dismissTo` tirava de baixo a tela que segurava. Hoje isso só acontece com o link `imagineup://` ou `exp://` (o `https` cai no site), e vira o caso comum com os links que abrem o app (bloco 13).
- `PendingInvite` vira `{ code, receivedAt, origin: { path, utm } }`, na chave `@imagineup/pending-invite/v2`, porque o formato mudou; a v1 é apagada na primeira leitura, sem migração: nenhuma build manda convite ao servidor antes de o `EXPO_PUBLIC_API_URL` entrar nas builds (depois do bloco 10, seção 13), e até lá qualquer convite v1 já passou dos 7 dias. O primeiro convite vale por 7 dias (`PENDING_INVITE_TTL_MS`, em `invites/consts.ts`); vencido, sai na leitura. `savePendingInvite` avisa quem assina (`subscribePendingInvite`), para a sincronização rodar na hora.
- Armazenamento novo, `@imagineup/invite-claims/v1`: `{ [uid]: BoundInvite }`, com `BoundInvite = { uid, code, via, origin, receivedAt, boundAt, idempotencyKey }`. Funções de armazenamento em `invites/storage.ts`: `bindPendingInvite(uid, typedCode)`, `readBoundInvite(uid)` e `clearBoundInvite(uid)`. No `bindPendingInvite`, código vazio descarta o pendente e devolve `null`; código igual ao do pendente (os dois pelo `normalizeInviteCode`) vira `via: 'link'`, com a origem e o `receivedAt` dele; código diferente vira `via: 'code'`, sem origem, com o `receivedAt` igual ao `boundAt`. A chave é `invite-<CODIGO>-<receivedAt>`, com o código normalizado, fixa enquanto o convite estiver amarrado. O convite amarrado vale por 7 dias desde o `boundAt` (`BOUND_INVITE_TTL_MS`).
- `inviteLinkId(target)`, em `invites/link.ts` (puro): `invite`, `agenda`, `post:<id>` ou `artist:<id>`.
- (implementação) `invitePathForServer(path)`, em `invites/link.ts`: o caminho guardado vai ao servidor sem a busca (ele a ignora), e vira `/` quando passa de 200 ou tem `//` (o servidor recusaria com 400, e o convite se perderia). Cada `utm_*` é cortado em 200 já no `parseInviteLink`, pelo mesmo motivo.
- (implementação) O convite amarrado nunca sai com o token de outra conta: o axios de `services/api` aceita `sessionUid` no pedido, e o interceptador recusa antes de mandar (`SessionChangedError`, que vira `ApiError('unknown')` sem status, incerto) quando a sessão do aparelho já é de outro uid. O claim manda o `sessionUid` do convite, e a visita, o da conta que visita. A rodada da sincronização também confere a sessão antes de cada passo e para se ela mudou.
- Tipos em `invites/types.ts` (novo): `InviteUtm`, `InviteOrigin`, `PendingInvite`, `BoundInvite` e os corpos e resultados de 20.3.

**Cadastro** (domínio `auth`)

- Campo novo "Código de convite (opcional)", depois da senha. O `signUpSchema` ganha `inviteCode`: vazio é "sem código"; senão, passa pelo `normalizeInviteCode` (de `@/domains/invites`), e o `null` dele recusa com a mensagem `validation.inviteCodeInvalid`. O campo usa `autoCapitalize="characters"`, `autoCorrect={false}`, `autoComplete="off"` e `textContentType="none"`. A senha passa o foco para ele no "próximo" do teclado, e ele envia no "ir". O `FIELD_ORDER` ganha o campo.
- O campo vem preenchido com o código do convite pendente, na montagem da tela, se ainda não foi tocado.
- `useSignUp`, na ordem: cria a conta; chama `bindPendingInvite(uid, inviteCode)` logo em seguida, ainda com o `holdAuth`; espera o perfil. Com `via: 'link'`, o cadastro não manda nada: a sincronização manda assim que o `holdAuth` solta. Com `via: 'code'`, o claim é esperado por até 8 s (`INVITE_CLAIM_WAIT_MS`, em `auth/consts.ts`). Recusa do código digitado, só com 404 `invite_not_found` ou 409 `invite_not_allowed`: a mutação resolve `{ status: 'inviteRejected', reason }` e não solta o `holdAuth` (a função que solta fica guardada no módulo do hook). As outras recusas definitivas da sincronização (`invalid_request`, `idempotency_key_required`, `not_fan` e `idempotency_key_reused`, abaixo) apagam o convite amarrado e seguem como hoje, sem o estágio: não é nada que o fã conserte digitando. Sucesso, falha de resultado incerto (a mesma regra da sincronização, inclusive o `unknown` sem status) ou o prazo: segue como hoje, e o convite incerto fica amarrado para a sincronização.
- Estágio "código recusado" da tela: nome, e-mail e senha ficam com os valores e `editable={false}`; o rodapé "Já tem conta?" sai; o lead vira `auth.signUp.inviteRejected.lead`; o campo do código mostra o erro (`notFound` ou `notAllowed`), recebe o foco, e o erro é anunciado; o botão principal vira "Continuar", com um `TextLink` "Continuar sem código" logo abaixo (irmãos, nenhum dentro do outro). "Continuar" chama `useFinishSignUp`: com código, amarra de novo (chave nova, porque a anterior foi recusada) e espera o claim; recusado de novo (404 ou 409, como acima), fica no estágio; sem código, ou com o claim aceito ou incerto, faz o `playAuthExit` e solta o `holdAuth`. (implementação) "Continuar" com o campo vazio é o mesmo que "Continuar sem código". O `useFinishSignUp` mora em `auth/hooks/use-sign-up.ts`, junto com o `useSignUp`, porque a função que solta o fã fica no módulo deles; a recusa do código digitado tira o convite amarrado na hora, e o app fechado no estágio não manda nada depois. O voltar fica preso no estágio (`useStayOnScreen`). App fechado no estágio: a conta já existe, e na volta o guard leva à 1l, sem convite. (implementação) O `useStayOnScreen` não segura navegação de fora (um link aberto no meio): a tela de cadastro solta o fã ao desmontar (`releaseHeldSignUp`, de `auth/hooks/use-sign-up.ts`), senão a trava ficava no módulo sem tela, a conta logada ficava presa nas telas de conta (nem entrar de novo soltava, porque o `useSignIn` solta só a trava dele) e a sincronização não rodava. A tela também assina `subscribePendingInvite`: o link que chega no estágio (o fã pediu o código certo a quem o convidou) põe o código no campo, no lugar do recusado e sem o erro, e o "Continuar" o amarra como `via: 'link'`, com a origem; fora do estágio, só com o campo ainda não tocado.
- Nas fixtures, o claim e a visita não chamam nada e o convite sai do aparelho, como hoje. O estágio de recusa não acontece.

**Sincronização** (`auth/hooks/use-invite-sync.ts`, chamado no `_layout.tsx` raiz logo depois do `useAuthListener`)

- Roda quando a sessão está confirmada (`status: 'signedIn'`) e ninguém segura as telas de conta (`authHolds === 0`); de novo quando a rede volta (`onlineManager`), quando um convite novo é guardado (`subscribePendingInvite`) e quando o app volta ao primeiro plano (`AppState` `active`). Uma rodada por vez.
- Primeiro, o convite amarrado ao uid da sessão. Vencido, sai sem envio; senão, vai o `sendInviteClaim`. Sucesso ou recusa definitiva: o convite sai do aparelho. Recusa definitiva é só o `ApiError` com um destes códigos no corpo: `invalid_request`, `idempotency_key_required` (400), `not_fan` (403), `invite_not_found` (404), `invite_not_allowed` (409) e `idempotency_key_reused` (422), em `isFinalInviteRejection`, de `auth/api.ts`. Todo o resto é incerto e fica para a próxima rodada: `status` nulo (`network`, `timeout` e o `unknown` sem status), 401, 429, 5xx e um 4xx sem um desses códigos (o `not_found` genérico de um servidor que ainda não tem a rota). O `isRetryable` não serve aqui: o interceptador de pedido do axios chama o `getIdToken`, que sem rede e com o token vencido (mais de 1 h) lança um `FirebaseError`, e o de resposta o transforma em `ApiError('unknown')` sem status, que não é `isRetryable`; o 429 também vira `unknown`. Pela regra do `isRetryable`, uma abertura do app com a rede instável apagaria o convite. O convite amarrado a outro uid nunca é enviado nem apagado por esta sessão.
- Falha incerta põe até 3 novas rodadas na mesma sessão (30 s, 2 min e 10 min, `INVITE_SYNC_RETRY_MS`), canceladas quando a sessão muda. O caso comum é o 503 `profile_not_ready` logo depois do cadastro (o perfil passou dos 20 s): sem elas, o convite só iria quando a rede voltasse, outro convite chegasse ou outra sessão começasse.
- Depois, o convite pendente, sem dono. Se a conta da sessão não tem convite amarrado neste aparelho, nasceu no `receivedAt` dele ou depois (`auth.currentUser.metadata.creationTime`), há até 7 dias, e ninguém entrou nela desde que nasceu (`lastSignInTime` até 1 min depois do `creationTime`: é a sessão que criou a conta, neste aparelho), a sincronização amarra o pendente a ela (`bindPendingInvite(uid, pendente.code)`, que dá `via: 'link'`) e manda o claim como acima. Cobre o app fechado entre `createUserWithEmailAndPassword` e o `bindPendingInvite` do cadastro (no meio há o `updateProfile`, uma ida e volta de rede) e a conta que nasce por um fluxo de entrar (Apple e Google, aprovados para depois), que nunca passa pelo `useSignUp`. A condição do `lastSignInTime` impede que uma conta criada noutro aparelho depois do link, e que entrou aqui, leve o convite. O relógio do aparelho adiantado (o `receivedAt` depois do `creationTime`) cai na visita: limite aceito. Conferir no SDK JS 12 que o `metadata` do usuário restaurado na abertura é o do servidor.
- Senão, o pendente sai do aparelho primeiro e, se chegou há menos de 24 h (`VISIT_FRESH_MS`), a visita vai (`sendInviteVisit`), sem esperar e sem nova tentativa. Mais velho que isso, sai sem visita: num aparelho dividido, pode ser de outra pessoa.
- Excluir a conta (`useDeleteAccount`, no sucesso) apaga o convite amarrado àquele uid. Sair da conta não apaga: ele volta a valer se a mesma conta entrar de novo dentro do prazo.

**Compartilhar**

- `sharePost`, `shareArtist` e `shareInvite` devolvem se a folha voltou com `Share.sharedAction`. No Android, o sistema sempre devolve essa ação; no iOS, cancelar devolve `dismissedAction`.
- `useRegisterInviteLinkMutation`, novo em `profile/queries.ts` e exportado pelo index, porque `posts`, `artist-page` e `invite-link` já importam o `useMyInviteQuery` de lá: `PUT /me/invite/links/<id>` com `{ linkId, idempotencyKey }` nas variáveis, `networkMode: 'always'`, `retry: 2`, sem fila offline e sem aviso na tela. Com `created: true`, invalida `profileKeys.progress()`.
- `registerInviteLink` (`profile/api.ts`), com `sourceOf('invite') === 'fixtures'`, devolve `{ linkId, created: false }` sem chamar nada: nas builds há o código de exemplo `CAMILA12`, e o `PUT` sairia com o `apiUrl` vazio. Os 63 links das fixtures não mudam.
- O "+N" do compartilhar do post (`PostActions` e o `ShareChips` de `post-row`, pelo `useSharePoints` de `posts/hooks/use-share-post.ts`; implementação: `null` ou 0 no post não rende) passa a ser o `pointsPerVisit` do `useMyInviteQuery`, o mesmo da sheet "Gerar meu link"; o `sharePointsPerVisit` do post de exemplo só decide se o compartilhar rende (`null` não rende) e vale enquanto o convite não carregou, até o bloco 6. Sem isso, o post mostraria o 2 fixo de `posts/fixtures.ts` e a sheet o valor da configuração, e os dois divergiriam quando a cliente mudasse o `invite_visit`.
- `useSharePost`, `useShareArtist` e a sheet "Gerar meu link" registram o link quando houve código e a folha voltou compartilhada: post é `post:<id>`, central é `artist:<id>`, o show do "Chamar amigos" é `agenda` e o atalho Convidar é `invite`.
- `buildInviteUrl(code, path, base = SHARE_LINK_BASE)` e `describeInviteLink(target, code, base?)`: a base vem do `linkBase` do `MyInvite` quando ele chegou.

**Textos** (`translations.json`)

- `invite.perVisit`: "por pessoa que abre o link no app". O texto de hoje promete pontos por qualquer abertura, o que não vale com a decisão 3. (implementação) O mesmo fim nos rótulos do compartilhar do post (`post.shareLabel` e `post.details.shareLabel`), que usam o mesmo `pointsPerVisit`: "Compartilhar o post, ganha N pontos por pessoa que abre o link no app".
- `auth.signUp.inviteCode`: "Código de convite (opcional)"; `auth.signUp.inviteCodeHint`: "Se alguém te convidou, o código vem no link que você recebeu."
- `validation.inviteCodeInvalid`: "Use só as letras e os números do código."
- `auth.signUp.inviteRejected.lead`: "Sua conta já foi criada. Confira o código de convite ou continue sem ele."
- `auth.signUp.inviteRejected.notFound`: "Não achamos esse código. Confira com quem te convidou."
- `auth.signUp.inviteRejected.notAllowed`: "Esse código não vale para esta conta."
- `auth.signUp.continue`: "Continuar"; `auth.signUp.skipInvite`: "Continuar sem código".

**O que é de verdade e o que é de exemplo** (desenvolvimento com emulador)

| Número ou dado                   | Telas                                               | Fonte no bloco 5                                                                      |
| -------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Código e link do fã              | sheet "Gerar meu link", compartilhar post e central | servidor                                                                              |
| Pontos por visita e por cadastro | sheet "Gerar meu link"                              | servidor (configuração)                                                               |
| "+N" do compartilhar do post     | mural e post                                        | servidor (o mesmo `pointsPerVisit`); o post de exemplo só diz se rende, até o bloco 6 |
| Pontos de convite                | carteira (1e, 1h)                                   | servidor                                                                              |
| Links criados e pessoas trazidas | 1e                                                  | servidor                                                                              |
| Missão de convite do card lima   | 1g, 1b                                              | exemplo, até o bloco 7                                                                |

**`CLAUDE.md` e `AGENTS.md`**

No mesmo commit: Navegação (o item Links: origem guardada, visita com conta e convite amarrado ao uid; o item Convite: a base do link e o registro do link), Dados (`invite` no seletor), Cloud Functions (`createUserProfile` soma o cadastro do dia e marca o perfil; `deleteUserData` com o convite; o secret `INVITE_KEY_SECRET` da `api`, no item da publicação e no do emulador), API do app e pontos (as rotas do bloco 5) e Pendências (sai o "Convite no cadastro (M2)", resolvido; entram as perguntas de 20.14 e o que fica fora do bloco, 20.15). O `AGENTS.md` recebe a mesma cópia, com o cabeçalho dele.

Nada disso entra no fingerprint da EAS: só JavaScript, regras e funções (o script de carga não entra no `package.json`).

### 20.12 Seed dos emuladores

`functions/src/invites/seed.ts` exporta `CAMILA_INVITE_CODE`, `EMULATOR_INVITE_KEY`, `SEED_INVITEES` (o e-mail e a origem de cada convidado), `seedCamilaInvite(db, { uid, email }, now)` e `seedInviteClaims(db, invitees, now)` (implementação: sem o `inviterUid`, que sai do código `CAMILA12`; cada convidado leva `{ uid, email, origin }`). O `scripts/seed-emulators.mjs` carrega `functions/lib/invites/index.js` como já carrega os pontos e as centrais.

- Chave do HMAC no emulador: o `scripts/functions-emulator-env.mjs` acrescenta `INVITE_KEY_SECRET` ao `functions/.secret.local` (como faz com o `EMAILJS_PRIVATE_KEY`, e também num arquivo que já existe sem ela), com o mesmo valor fixo de `EMULATOR_INVITE_KEY`, que o seed e os testes de emulador usam. Assim a `api` do emulador e o seed calculam a mesma chave da pessoa, sem um ramo pelo `FUNCTIONS_EMULATOR` no código que calcula a chave.
- Código da Camila: `CAMILA12`, o mesmo da fixture (`buildMyInviteFixture`), para a sheet mostrar o mesmo código nos dois modos. Ele tem vogais e não sai do sorteio, então não colide. O seed grava `inviteCodes/CAMILA12`, com o `ownerKey` do e-mail dela, e `fanInvites/{uid}` se não existirem.
- Links da Camila: `invite`, `post:p-clipe`, `artist:nettobrito` e `agenda`, pelo mesmo núcleo do `PUT`, sem marcar atividade.
- Três contas de teste novas, criadas como a Camila e o Alan (`accounts:signUp` no emulador do Auth, a espera do perfil e a cidade):

| Conta      | E-mail e senha                          | Como chegou                                                                                      |
| ---------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Bia Santos | `bia@teste.imagineup`, `fa-de-teste-3`  | link do post `p-clipe`, com `utm_source=instagram`, `utm_medium=story` e `utm_campaign=sao-joao` |
| Duda Lima  | `duda@teste.imagineup`, `fa-de-teste-4` | link da central `nettobrito`, sem utm                                                            |
| Enzo Rocha | `enzo@teste.imagineup`, `fa-de-teste-5` | código digitado no cadastro                                                                      |

- Os claims passam pelo mesmo `claimInvite` da rota (`runClaim`, numa transação com o `requireFan` sem marca de atividade, como o `runJoinCentrals`), com `actor` de sistema, o e-mail de cada conta e a configuração padrão com `invite_visit` e `invite_signup` em 0. Os lançamentos saem `zero`, e a carteira da Camila fica a do protótipo (12.480, 4.120 e "+840"). O `award` dos três `referrals` guarda `zero`. Os claims criam os três marcadores de visita da Camila. Os shards do dia somam 3 cadastros convidados e 3 visitas (por tipo: `post`, `artist` e `code`), e os recortes de `utm_*` só com o cadastro da Bia (`instagram` e `sao-joao`; os outros dois em `_none`).
- Resultado na 1e da Camila: 4 links criados e 3 pessoas trazidas. O Alan fica com 0 e 0, e ganha o código na primeira vez que abrir a sheet.
- Por que não os 63 e 418 do protótipo: 418 contas passariam, uma a uma, pela função de cadastro (com a espera do nome) a cada sessão do emulador; `referrals` sem conta seriam fãs que não existem na seção Fãs do painel, contra a regra de que todo convidado tem conta; e 63 links pediriam 63 destinos, quando o mural de exemplo tem 10 posts. Os números do protótipo seguem nas fixtures. A seção 14 muda junto.
- Para ver os pontos de verdade: com o Alan logado, abrir `imagineup://post/p-clipe?ref=CAMILA12` (no Expo Go, `exp://<host>:8081/--/post/p-clipe?ref=CAMILA12`) dá +2 à Camila uma vez; uma conta nova com `CAMILA12` no campo do cadastro dá +2 e +10.
- Rodar de novo não muda nada: o código, os links, os convites e as contas já existem.

### 20.13 Testes

Funções, testes puros (`vitest`, relógio fixo):

- `invites/model.test.ts` (tabela): o sorteio do código (8 caracteres, só o alfabeto, o mesmo com o `random` fixo); `normalizeInviteCode` (minúsculas, hífen e espaço viram o mesmo código; curto ou com caractere fora vira `null`), na mesma tabela do teste do app; `personKey` (maiúsculas, `+` em qualquer domínio, pontos só no Gmail, `googlemail.com` igual a `gmail.com`, sem e-mail usa o uid, o formato do `eventId`, a mesma chave com o mesmo segredo e outra com outro segredo); `classifyInvitePath` (cada tipo, id fora do formato vira `other`, busca ignorada); `normalizeUtm` (o e-mail colado vira `null`, também com `.` na parte local; telefone com DDD e CPF viram `null`; `2026-10-05` passa) e a chave dos recortes (40 caracteres, `_none`); `parseClaimBody` e `parseVisitBody` (sem código, código em minúsculas e com hífen normalizado, `via` desconhecido, `link` com `via: 'code'`, `openedAt` com `via: 'code'` vira `null`, utm longo, `utm_content`, `utm_term` e `utm_id` ignorados, `openedAt` fora da faixa vira `null`, chave desconhecida ignorada); `parseLinkId` (cada formato, `artist:__x__`, id longo); a janela de 7 dias; os tetos de visitas e de links.
- `points/stats.test.ts`: `addInviteToShard` nos três eventos, os `utm_*` só no `signup`, o `_none` e o `pruneZeros` dos campos novos; o shard do cadastro (`signups.total`).
- `points/award.test.ts`: `addInviteCounts` com o `plan.shard` nulo; `addDailyCount` com as chaves novas.
- `api/router.test.ts`: `GET /me/invite/links/x` é 405 com `Allow: PUT`; `GET /invites/claim` é 405; `/me/invite` e `/me/invite/links/:linkId` não se confundem.
- `api/index.test.ts`: `InviteError` vira 404 e 409 com `details.reason`; `linkId` malformado é 400; o `email` do contexto vem do token, nunca do corpo; o `inviteKey` vem das dependências.
- `store.test.ts`: a ordem nova do `deleteUserData` (20.10); o `createProfile` grava o shard e a marca `signupCounted` só quando cria.

Funções nos emuladores (`functions/test/invites.emulator.test.ts`, com a `api` de verdade por HTTP e tokens do emulador de Auth):

- `GET /me/invite`: cria o código no formato, com o `ownerKey` do e-mail do token, e devolve o mesmo nas chamadas seguintes; dez chamadas em paralelo dão um código só; sem perfil, 503; conta só da equipe, 403; os valores vêm da configuração (com a fonte injetada).
- Claim: paga 2 e 10 a quem convidou, com `invite_visit:<chave>` e `invite_signup:<chave>` no extrato dele, o `referrals` com a origem normalizada (sem caminho e só com os três `utm_*`) e o `award`, o marcador com `via: 'claim'` e os shards do dia (`signups.invited`, `invites.visits` e os recortes); a mesma chave devolve a resposta guardada; outro código depois é `already_claimed`, sem efeito; o próprio código é 409 `self` na própria conta, e uma segunda conta da dona com `nome+1@gmail.com` ou com `n.o.m.e@gmail.com` recebe `claimed`, com o `referrals` sem quem convidou e o `award` `self`, sem lançamento, marcador, "pessoas trazidas" nem agregado, e gasta o claim (implementação); a sondagem pelo apelido do e-mail da dona, de quem já visitou e de quem nunca passou recebe as mesmas respostas na visita e no claim (implementação); conta com o perfil de 8 dias atrás (o `createdAt` regravado no teste) é 409 `account_too_old`; código que não existe é 404 e não grava a chave; o 21º cadastro do dia do mesmo convidante sai `capped`, com o `referrals` gravado; conta excluída e recriada com o mesmo e-mail registra o convite e não paga (`duplicate`) nem soma visita (o marcador já existe), e com `nome+1@gmail.com` também não; claim de quem antes visitou soma o cadastro e não a visita; quem convidou excluído no meio sai `skipped`, sem marcador.
- Visita (implementação: a resposta é sempre `{ status: 'received' }`, e o teste confere o marcador e os shards): paga 2 uma vez por par, com o marcador; a segunda visita da mesma pessoa não soma no shard; o dono não conta, nem por uma segunda conta com o apelido do e-mail; a 21ª visita do dia da mesma conta não conta nem grava lançamento; código que não existe é 404. Limite e valor zero, com repetição: com quem convidou já nas 50 visitas pagas do dia, a visita sai `capped`, com o marcador e uma visita no shard, e a mesma pessoa de novo, no mesmo dia, não soma visita no shard nem grava lançamento; no dia seguinte, a mesma pessoa paga 2 sem contar de novo; com `invite_visit` em 0 na configuração, a primeira visita cria o marcador e as seguintes da mesma pessoa não somam, com uma visita só no shard.
- Links: cria uma vez; o segundo `PUT` é `created: false`, e o 31º novo do dia também; a central que não existe, em rascunho ou fora do ar é `created: false`, fora do teto e dos agregados (implementação); sem código é 404; o `/me/progress` conta os links e as pessoas trazidas.
- Concorrência: dez contas novas fazendo claim do mesmo código ao mesmo tempo deixam dez `referrals`, dez marcadores, a carteira de quem convidou com 120 e vinte lançamentos, e os shards somando 10 cadastros e 10 visitas.
- Exclusão: convidado excluído some de `referrals`, o número de quem convidou cai, e os pontos e o marcador ficam; convidante excluído: o código responde 404, `fanInvites`, os links e os marcadores somem, e os `referrals` dos convidados ficam com `inviterUid: null`; rodar de novo não muda nada.
- Cadastro (`functions/test/profile.emulator.test.ts`): a conta nova soma 1 em `signups.total` do dia e nasce com `signupCounted: true`; a entrega repetida não soma de novo; conta da equipe não soma.
- Seed: o código da Camila com o `ownerKey`, os links, os três convidados com as origens e os marcadores, a carteira dela sem mudar, e rodar de novo não muda nada; a conta da Bia excluída e recriada com o mesmo e-mail, com claim pela `api` do emulador, não cria marcador de visita novo e não soma visita (prova que o seed e a `api` usam a mesma chave). (implementação) Os lançamentos dela não saem `duplicate`: no seed o convite vale 0, e o lançamento `zero` não grava extrato; a conta recriada paga uma vez, como a visita que antes valia 0 (20.5).
- Carga: o `backfill-signups.mjs` no emulador soma, por dia, só os perfis sem a marca (gravados pelo Admin SDK sem ela, como perfis de antes, e um criado pelo gatilho, com ela) e marca cada um; o `--dry-run` não grava; com um perfil contado excluído e outro sem a marca criado entre duas rodadas, a segunda soma só o novo e o total do dia não cai; uma terceira rodada não muda nada (implementação).

Regras, `tests/invites-rules.test.ts` (novo, no molde de `tests/centrals-rules.test.ts`, com os mesmos membros de exemplo):

- `inviteCodes` e `fanInvites/{uid}/inviteVisitors`: ninguém lê nem grava, nem admin.
- `fanInvites`, `inviteLinks` e `referrals`: o próprio fã não lê (`get` e `list`), e outro fã também não; a equipe ativa com `fans` e admin leem, inclusive `referrals` com `where('inviterUid', '==', ...)` e `fanInvites` com `where('code', '==', ...)`; sem `fans`, desativada, pendente ou com sessão de antes do `authValidAfter`, não lê; ninguém grava.
- Os arquivos de teste que já existem passam sem mudança.

App:

- `invites/__tests__/link.test.ts`: `normalizeInviteCode`, na mesma tabela do teste do servidor.
- `invites/__tests__/deep-link.test.ts`: os `utm_*` saem do destino, também no link curto, e só os três ficam em `utm`; o `inviteRoute` leva os três; o resto como hoje.
- `invites/__tests__/storage.test.ts` (novo): o primeiro convite vale; o vencido sai; `bindPendingInvite` com o mesmo código (`link`, com a origem), com o mesmo código digitado em minúsculas ou com hífen (`link`), com outro (`code`, sem origem) e vazio (descarta); o convite amarrado a um uid não aparece para outro; a chave fica a mesma; a v1 é apagada.
- Navegação (`src/navigation/__tests__`): a rota `/convite/[codigo]` com código fora do formato não guarda nada e segue; `?ref=k7p3m9qx` guarda `K7P3M9QX`.
- `auth/__tests__/invite-sync.test.tsx` (novo): o convite amarrado vai só para o uid dele, com a chave dele; cada código de recusa definitiva apaga; a falha incerta guarda, inclusive o `ApiError('unknown')` sem status (o `getIdToken` que falha no interceptador), o 429 e o 404 sem código; a falha incerta tenta de novo pelo relógio (relógio falso) e quando o app volta ao primeiro plano; outra conta entrando no mesmo aparelho manda a visita do pendente e nunca o convite amarrado de outro; a conta que nasceu depois do link, sem convite amarrado e sem entrada desde a criação (o app fechou antes do `bindPendingInvite`), recebe o claim com `via: 'link'`; a conta criada depois do link noutro aparelho, que entrou aqui (`lastSignInTime` longe do `creationTime`), manda a visita; nada roda com `authHolds > 0`; o pendente com mais de 24 h sai sem visita.
- `auth/__tests__/sign-up.test.tsx`: o campo vem preenchido com o código pendente; formato inválido mostra o erro; código digitado recusado (404 ou 409) deixa a tela no estágio, com os campos travados, e "Continuar sem código" segue para a 1l; o `unknown` sem status no claim do código digitado não leva ao estágio e deixa o convite amarrado; código do link recusado não para o cadastro.
- (implementação) `src/navigation/__tests__/auth.test.tsx`: no estágio, o link `/convite/OUTRO123` aberto por fora volta ao cadastro, com o fã ainda seguro e o código novo no campo, e o "Continuar" o manda como `via: 'link'`; a tela de cadastro que sai no estágio sem os botões solta o fã.
- (implementação) `src/services/api/__tests__/client.test.ts`: o interceptador de verdade, com o Firebase trocado e um adaptador falso do axios. Com o `sessionUid` da sessão, o pedido sai com o token dela; com outra conta ou sem ninguém na sessão, recusa antes de sair (`ApiError('unknown')` sem status) e o adaptador não é chamado; o `getIdToken` que falha vira o mesmo erro incerto; o 401 renova uma vez e repete com o token novo; com a sessão trocada no meio, não repete; a renovação que falha não repete.
- `auth/__tests__/api.test.ts`: o corpo do claim e da visita no modo API, com o código normalizado e o `openedAt` nulo com `via: 'code'`; nas fixtures, nenhuma chamada; `isFinalInviteRejection` em tabela.
- `posts`, `artist-page` e `invite-link`: o link é registrado depois de `sharedAction`, com o id certo, e não sem código nem com `dismissedAction`. `posts`: o "+N" do compartilhar vem do `pointsPerVisit` do convite, e o post com `sharePointsPerVisit: null` não promete pontos.
- `src/config/__tests__/data-source.test.ts`: `invite` na API com o emulador.
- `profile/__tests__/api.test.ts`: `fetchMyInvite` com `url` e `linkBase`; `registerInviteLink` nas fixtures devolve `created: false` sem chamar a API; `invite-link/__tests__/describe-link.test.ts`: a base do servidor no link.

### 20.14 Perguntas

Para a cliente (UP-16, UP-20, UP-33 e UP-39):

1. O que conta como visita? Proposta: pessoa com conta que abre o link no app, uma vez por pessoa, e quem se cadastra pelo link. O clique no site não conta, porque não dá para separar pessoa de robô.
2. Quem se cadastra pelo link rende a visita também (2 mais 10) ou só o cadastro (10)? Proposta: os dois.
3. O que é uma campanha? Opções: (a) o `utm_campaign` que a equipe põe nos links que publica; (b) cada link de fã (post, artista, agenda), que já sai separado por tipo; (c) um código próprio de campanha ou de artista, para cartaz, show ou post da equipe, no link (`?ref=`) ou digitado no cadastro, sem pontos para fã (`inviteCodes` com `kind: 'campaign'`, criado pelo painel). A (a) sozinha não funciona com este bloco: o app só guarda a origem de um link com código (`parseInviteLink` devolve nada sem `ref`), o claim exige um código que existe, a conta da equipe não tem código (o `GET /me/invite` responde 403) e o link do fã não leva `utm_*`. Para a (a) existir, ou ela vem com a (c) (`?ref=CAMPANHA&utm_source=instagram&utm_campaign=sao-joao`, que já cai nos recortes de 20.7), ou o app passa a guardar a origem sem código: `PendingInvite.code` nulo quando o link só tem `utm_*`, claim com `code: null` só com `via: 'link'`, `referrals` sem quem convidou e sem pontos, um contador `signups.attributed` e uma regra para o link com código vencer o que veio sem. Proposta: (b) agora; (c) se ela quiser comparar as campanhas da equipe ou fazer ação fora da internet, com a (a) dentro dela. A origem sem código fica registrada, e não entra antes da resposta: muda o contrato do claim para uma resposta que ainda não veio, e não traz dado nenhum até os links abrirem o app (bloco 13) ou o Install Referrer (bloco 3).
4. Por quanto tempo o convite vale? Proposta: 7 dias depois de aberto no app, e só para conta criada há até 7 dias.
5. O cadastro só paga com e-mail confirmado? Proposta: não agora, porque o app não tem a confirmação; os limites diários seguram. Sem a confirmação, a chave da pessoa é pseudônimo fraco (20.6).

Para o dono:

6. "Links criados" como os links diferentes que o fã compartilhou (um por página), contados quando a folha de compartilhar volta compartilhada (decisão 7).
7. Pontos do convite fora das centrais (decisão 11).
8. Guardar a chave do e-mail do convidado excluído no extrato e no marcador de visita de quem convidou, para não pagar nem contar de novo (decisão 4): levar à revisão jurídica (UP-45) e citar na política de privacidade. A chave já nasce como HMAC com um segredo do servidor (`INVITE_KEY_SECRET`, no Secret Manager), então quem lê o extrato não a liga a um e-mail sem o segredo; ela continua sendo dado pseudonimizado, e não anônimo, e fraco enquanto o e-mail não for confirmado (20.6). Se a revisão pedir que nada fique depois da exclusão, a trava contra a conta recriada sai, e a conta recriada com o mesmo e-mail volta a pagar, dentro dos limites diários.
9. O `GET /me/invite` que cria o código, exceção à regra do GET (decisão 1).

### 20.15 Fora deste bloco (só documentado)

- **Site** (repositório `imagineup-LP`, depende do ok da UP-49): o `vercel.json` manda `/post/:id/`, `/artista/:id/` e `/agenda/` para `/baixar/`, mantendo o caminho e o `?ref=` para os App Links. O `/baixar/` e uma página `/c/:codigo/` podem mostrar o código, com um botão de copiar, para quem instala pelo iPhone digitar no cadastro (o plano B do iOS na UP-16).
- **Install Referrer do Android** (bloco 3): na primeira abertura depois de instalar pela Play Store, o app lê o `referrer` da instalação, que carrega o `ref` e os `utm_*`, e guarda o convite pendente com `via: 'install'`. O servidor passa a aceitar esse `via` no mesmo commit. Conferir na doc da SDK 57 se o `expo-application` (`getInstallReferrerAsync`) resolve sem código nativo próprio; ele não está no projeto, e só dá para testar com o app instalado pela Play Store.
- **Links que abrem direto no app** (bloco 13, depende do domínio, UP-46): `associatedDomains` e `intentFilters`. É com eles que a visita no app passa a acontecer de verdade, e o link do fã deixa de cair no site para quem tem o app. A troca de domínio muda o `INVITE_LINK_BASE` das funções (os links compartilhados mudam sem build, pelo `linkBase`) e o `SHARE_LINK_BASE` do app (o padrão de quem ainda não carregou o convite).

### 20.16 Publicação

Só com o ok do dono, nesta ordem: o secret do HMAC, criado uma vez pelo dono com um valor aleatório que não passa pelo repositório nem pelo chat (`npx --yes firebase-tools@15.32.0 functions:secrets:set INVITE_KEY_SECRET --project imagine-up-app`, com, por exemplo, 32 bytes aleatórios em base64; sem ele, o deploy da `api` para e pergunta); regras e índices (`deploy --only firestore:rules,firestore:indexes`); depois todas as funções (`npm run functions:deploy`), que levam a `api` com as rotas novas e o secret, o `createUserProfile` que soma e marca o cadastro do dia e o `deleteUserData` novo, usado pela `deleteUserProfile` e pela `createUserProfile`. Não há índice composto novo, então não é preciso esperar índice montado. Depois, a carga dos cadastros antigos (`node scripts/backfill-signups.mjs --project imagine-up-app`), quando a troca de versão do `createUserProfile` terminar, e de novo uns minutos depois, para pegar o perfil que uma instância antiga criou sem a marca; tem de rodar antes de o fechamento do dia entrar no ar (20.7). O `EXPO_PUBLIC_API_URL` segue a regra da seção 13.

### 20.17 Armadilhas do bloco 5

- O id dos lançamentos de convite é a chave da pessoa, e não o uid: é o que impede pagar de novo a conta excluída e recriada. Não troque por uid.
- A chave da pessoa é HMAC com o `INVITE_KEY_SECRET`. Nunca troque o segredo: cada pessoa já convidada pagaria e contaria de novo uma vez, e o autoconvite pelo apelido passaria nos códigos antigos (o `ownerKey` deles é da chave velha).
- O e-mail da chave sai do token, nunca do corpo do pedido.
- O autoconvite compara o `uid` e o `ownerKey` do código. Só o `uid` deixa passar a segunda conta da dona com o apelido do e-mail.
- Só a própria conta dona do código ouve o 409 `self`. A mesma pessoa noutra conta recebe `claimed`, e a visita responde sempre o mesmo corpo: uma resposta que mude com o `ownerKey` ou com o marcador vira teste do e-mail de qualquer pessoa, porque o Firebase não confere o e-mail de quem cria a conta.
- O link de uma central só nasce com a central publicada (o `getAll` lê `artists/{@}`).
- A carga dos cadastros antigos é só aditiva: marca o perfil e soma com `increment`. Nunca regrave o dia com `set`, que desconta as contas excluídas entre duas rodadas.
- O `GET /me/invite` cria o código na primeira chamada: é a única leitura que cria, e por isso exige o perfil.
- O claim vale uma vez por conta (`referrals/{uid}`) e só para conta de até 7 dias. Recusa definitiva não guarda a chave, e o app esquece o código.
- A visita conta no painel pelo marcador `inviteVisitors`, nunca pelo status do lançamento: `capped` e `zero` não gravam no extrato, e a mesma pessoa contaria a cada visita.
- Os limites diários do convite são de quem convidou (`days` da carteira dele). Os tetos de visitas mandadas e de links novos são de quem chama.
- A visita só conta no app e de conta logada. O site não conta.
- O convite pendente é do aparelho; o amarrado é do uid. Só a sessão confirmada daquele uid envia o amarrado, e nunca com as telas de conta seguradas. A sincronização só amarra sozinha o pendente à conta que nasceu neste aparelho depois do link e em que ninguém entrou desde então.
- No app, recusa definitiva do convite é pela lista de códigos de `isFinalInviteRejection`, e não pelo `isRetryable`: o `unknown` sem status (o `getIdToken` que falhou antes do pedido) e o 429 não são recusa.
- O código de convite passa sempre pelo `normalizeInviteCode`, no app e no servidor, com a mesma tabela de testes.
- Os `utm_*` crus nunca são guardados, só `source`, `medium` e `campaign` normalizados, sem e-mail e sem número de telefone ou documento.
- O `byOrigin` tem chaves soltas: isenção de índice, chave de até 40 caracteres e `_none` para o vazio. Os `utm_*` entram só nos cadastros; visita e link, só pelo tipo.
- O `signups.total` soma na transação que cria o perfil, e só quando cria, com a marca `signupCounted` no perfil. A carga dos cadastros antigos conta só os perfis sem a marca e roda antes do fechamento do dia.
- O `signups.invited` é do dia do claim: a parte dos cadastros que veio de convite se lê por semana ou mais.
- Na exclusão, o código sai logo depois do perfil, e os `referrals` de quem foi trazido ficam, sem o `inviterUid`.
- `inviteLinks` e `inviteVisitors`, e não `links` e `visitors`: subcoleção com nome genérico cai na regra de grupo de outra.

## 21. Bloco 6: mural e agenda com conteúdo real

O mural e a agenda passam a vir do servidor. A equipe publica posts e shows pelo painel, o fã curte, comenta e confirma presença de verdade, e o app ganha a moderação mínima que as lojas pedem para conteúdo de usuário. Esta seção é o contrato do bloco 6: rotas, coleções, transações, contagens, moderação, callables do painel, regras, efeitos no painel, exclusão de conta, mudanças no app, seed e testes. Ela segue os padrões dos blocos 1, 4 e 5 (seções 1 a 20) e só diz o que muda ou acrescenta.

Origem: o levantamento de 05/10/2026 (bloco 6) e o pedido do dono de 05/10/2026. Decisão provisória do dono até a UP-9: quem publica no mural e na agenda é a equipe, pelo painel, porque o artista não tem conta. As telas do painel para isso são do bloco 11 (projeto `imagineup-admin`); este bloco entrega as callables e deixa o contrato delas em 21.9. A build sem emulador continua nas fixtures, e o `EXPO_PUBLIC_API_URL` segue a regra da seção 13.

Estado: implementado em 05/10/2026 no app e nas funções, sem deploy (ordem da publicação em 21.17). Onde o código detalhou ou desviou desta seção, o texto abaixo já diz como ficou, marcado com "(implementação)", como nas seções 19 e 20.

Como era antes do bloco: posts, comentários, curtidas, shows e o "Eu vou" moravam nas fixtures (`src/domains/posts/fixtures.ts` e `src/domains/agenda/fixtures.ts`), com as rotas que os `api.ts` já chamavam e que ninguém respondia. O "N posts" da 1d contava os posts de exemplo da central (`countArtistPostsFixture`), o mural de exemplo mostrava as mesmas centrais para qualquer fã, e o comentário não tinha como ser denunciado nem o autor bloqueado.

### 21.1 Decisões

Cada item traz a recomendação e o motivo. As perguntas para a cliente e para o dono estão em 21.16, e o código já nasce com o padrão daqui, fácil de trocar.

1. **Quem publica é a equipe, pelo painel, com a seção `artists`.** Admin, ou editor com `artists`, cria, edita, publica e tira do ar posts e shows, e apaga o rascunho que nunca foi ao ar (decisão 4); o leitor com `artists` só vê. Sem seção nova nos `SECTION_IDS`: o conteúdo é da central, e uma seção nova mexeria em papéis, convites e regras do painel. Se a cliente quiser separar quem cuida das centrais de quem publica, uma seção própria entra depois, trocando a seção em três lugares: o `PANEL_CONTENT_SECTION` das funções novas, o `firestore.rules` (a leitura de `posts`, `events` e `postComments`) e o `storage.rules` (o envio da mídia). Provisório até a UP-9.
2. **Post em `posts/{postId}`, na raiz, com id automático.** O mural junta várias centrais numa consulta (`artistId in [...]`), e a raiz dispensa o grupo de coleção. O id automático (20 caracteres) cabe no `post:<id>` do convite (`[A-Za-z0-9_-]{1,128}`) e no `eventId` do extrato. O seed usa os ids das fixtures (`p-clipe`, `p-show`...), que cabem nos dois.
3. **A mídia sobe do navegador para `posts/{postId}/`, e a função confere, como as fotos das centrais.** Post de foto: duas versões da foto (a do detalhe e a miniatura). Post de vídeo: a capa em duas versões, obrigatória, e o arquivo `video/mp4` opcional, até 50 MB. O app não toca vídeo (mostra a capa com a marca de vídeo, como hoje); o arquivo fica guardado para quando tocar. Guardar o mp4 é pergunta para o dono (21.16).
4. **Rascunho, no ar e fora do ar; apagar só o que nunca foi ao ar.** Post e show nascem rascunho, como a central: o `storage.rules` só aceita mídia de um documento que já existe. O que já foi publicado uma vez (`publishedAt` preenchido) não se apaga: pediria limpar curtidas, comentários, denúncias, presenças, links de convite e arquivos, e tirar do ar já some com o conteúdo do app. O rascunho que nunca foi ao ar se apaga (`deletePost` e `deleteEvent`, 21.9): nenhuma rota aceita curtida, comentário, presença ou link de conteúdo que não está no ar, então ele só tem o documento e os arquivos. Sem isso, um rascunho criado por engano prenderia a central para sempre (o `has-content` da decisão 23), e um show rascunho prenderia todas as centrais dele.
5. **O que o fã vê.** Post no ar de central no ar. O mural (`/feed`) mostra só as centrais do fã; a grade da 1d e o detalhe mostram para qualquer fã logado, porque o link compartilhado abre para quem ainda não é membro. Fã sem central vê o mural vazio, com o texto de hoje ("O mural dos seus artistas aparece aqui."). Motivo: é o "Do seu fandom" do protótipo, e a frase da sheet de sair volta a ser verdade.
6. **Curtidas e comentários contados em shards e copiados para o post por uma fila, como o `fanCount`.** 16 shards em `postStats/{postId}/countShards/{n}`; a fila `syncPostCounts` copia `likeCount` e `commentCount` para `posts/{postId}` no máximo uma vez a cada 10 s por post. Motivo: um post popular recebe curtidas de muitos fãs ao mesmo tempo, e somar no documento do post o deixaria disputado (perto de 1 gravação por segundo). Para quem acabou de curtir ou comentar, a leitura soma o que a cópia ainda não viu (21.6).
7. **`postCount` da central por `count()` na leitura**, como o "PTS DA CENTRAL" (19.7). Exato e na hora, sem campo novo em `artists/{id}` disputado pela equipe e pela API. Custo: 1 leitura a cada 1.000 posts no ar da central, por abertura da 1d.
8. **Curtida e presença ficam com o fã; comentário fica com o post.** `users/{uid}/postLikes/{postId}`, `users/{uid}/eventRsvps/{eventId}` e `posts/{postId}/postComments/{commentId}`. Motivo: curtida e presença são do fã, como o vínculo do bloco 4, e o `likedByMe` e o `/me/rsvps` leem só os documentos dele; o comentário é listado por post. Os nomes são específicos (`postLikes`, e não `likes`) pela lição da regra de grupo de `centrals` (19.10). Desfazer não apaga o documento: ele fica com o estado (`liked: false`, `going: false`) e com o instante da primeira vez (`firstLikedAt`, `firstGoingAt`). Motivo: curtir rende 0 hoje e não grava extrato, e sem o documento nada diria que o fã já curtiu aquele post; o bloco 7 conta só a primeira curtida de cada post e a primeira presença de cada show (a regra das fixtures), e lê esse registro na transação (seção 5, exemplo da curtida que conclui missão). Apagar no desfazer deixaria descurtir e curtir de novo andar a missão outra vez, até o teto do dia. `likedByMe`, `/me/rsvps`, as contagens e a seção Fãs leem só o estado ativo, e o shard e o teto do dia só mexem na troca de estado. A exclusão de conta apaga tudo (21.12).
9. **Nome e foto do autor copiados no comentário.** O comentário guarda `authorName` e `authorPhotoURL` do perfil na hora em que foi escrito. Motivo: uma página de 20 comentários não lê 20 perfis. Limite aceito: quem troca de nome continua com o nome antigo nos comentários antigos.
10. **Pontos pelo núcleo, com o id do evento.** `like:<postId>` paga no máximo uma vez na vida, e descurtir não tira; `comment:<commentId>` paga cada comentário dentro do limite diário de `comment`; `rsvp:<eventId>` paga uma vez por show. Valores de `config/points`, hoje provisórios (UP-9): curtir 0, comentar 2 e "Eu vou" 0. O evento que rendeu 0 ou bateu no limite não grava extrato e pode pagar depois, uma vez (seção 5). A presença paga na primeira central do show que está no ar (na ordem do painel, a primeira é a principal), lida na transação, e soma os agregados só nas centrais do show que estão no ar: central em rascunho ou fora do ar não recebe `centralPoints` nem fluxo. Show sem central no ar paga sem central, como o convite. Curtir e comentar só acontecem em post de central no ar (21.2), então pagam numa central publicada. Os três pagam na central mesmo quando o fã não é membro dela: se esse ponto conta no ranking da central é pergunta para o bloco 8 (21.16).
11. **Tetos do dia por fã para as ações que gravam, além dos limites de pontos.** Curtidas 300 (cada troca para curtido, também a de quem curte de novo depois de descurtir), comentários 100, presenças 50 (cada troca para "Eu vou"), denúncias 30 e bloqueios 30 por dia de São Paulo; acima, 429 `too_many_requests` com `Retry-After` até a meia-noite, antes de gravar. Desfazer (descurtir, desfazer o "Eu vou", desbloquear) nunca é recusado. Motivo: o mesmo do teto de entradas do bloco 4 (19.5). Curtir e descurtir sem parar, com chaves novas, gravaria sem teto, dispararia a fila e inflaria os fluxos do painel.
12. **Show com data e hora no fuso do lugar.** O painel manda a data e a hora locais e o fuso IANA (sugerido pela UF); o servidor guarda o instante (`startsAt`), o fuso e o texto local. O app continua mostrando no fuso do aparelho, como hoje: quase todos os shows e fãs estão em UTC-3. Mostrar no fuso do lugar é pergunta (21.16).
13. **Destaque da agenda: marca `featured` no show, e vale o próximo show marcado.** Mais de um marcado não é erro: o topo mostra o mais próximo, e o seguinte assume quando ele passar. Sem marcado à frente, `featured: null`, e o app usa o próximo show, como hoje. Motivo: a callable não precisa desmarcar os outros numa transação, e a equipe pode deixar os destaques da temporada marcados de uma vez.
14. **Um corte só para o que "já passou": o começo do dia de hoje em São Paulo** (`agendaCutoff(now)`, em `agenda/model.ts`, que é o `nextDayStart(now - 24 h)` de `points/model.ts`). Vale para a lista da agenda, para o destaque, para o show estar aberto (`isEventOpen`: o `event` do post de show, o "Eu vou" e o `/me/rsvps`). É a regra do app (`isUpcoming`, em `agenda/group-by-month.ts`: o show de hoje fica até o dia virar, porque a hora de começo não diz quando ele acaba), no fuso de quase todos os fãs. Motivo: o app descarta o destaque que começou antes de `startOfDay(now)` e cai no próximo show, e não no próximo destaque; com o corte de 24 h, da meia-noite até 24 h depois do começo, o topo mostrava o show errado, e o post de show oferecia "Eu vou" num show de ontem que a agenda já escondia. Limite aceito: o aparelho fora do UTC-3 vira o dia em outra hora. No Acre e no Amazonas, o show de hoje sai da agenda e do "Eu vou" uma ou duas horas antes da meia-noite deles, e um destaque que começa nas duas primeiras horas do dia de São Paulo é trocado pelo próximo show no topo; em Noronha, um show que começa na primeira hora do dia deles some uma hora antes. Agenda em ordem de data, 20 por página. "Por mês" é o agrupamento que o app já faz (`groupByMonth`); o servidor não filtra por mês, porque o app não pede. Não há rota de detalhe do show: o app não tem tela de um show só (`useAgendaEvent` procura nas páginas carregadas). Ela entra com a tela, no formato `AgendaEvent`.
15. **Post de show aponta para o show da agenda, e o "Eu vou" é um só.** O post guarda `eventId`, e a resposta monta o `event` a partir do show, na hora. Show fora do ar ou encerrado (começou antes do corte da decisão 14) volta `event: null`: o post continua, sem a linha do show e sem o "Eu vou". O "Eu vou" só vale em show no ar e não encerrado; desfazer vale sempre. O show do post sempre tem a central do post entre os artistas: o `createPost` e o `updatePost` conferem, e o `updateEvent` não tira a central de um post que aponta para ele (21.9).
16. **Moderação mínima e provisória (UP-48).** Denunciar o comentário de outro fã, com motivo opcional de uma lista fechada (sem texto livre, que seria mais conteúdo de usuário para moderar), uma vez por fã e comentário; a fila da seção Moderação junta as denúncias por comentário. Bloquear um fã: os comentários dele somem para quem bloqueou, em todos os posts, e ele não fica sabendo. A equipe com `moderation` oculta, reexibe ou arquiva pela callable `moderateComment`. Nada é ocultado sozinho por número de denúncias até a cliente responder. É o mínimo que a App Store (diretriz 1.2) e o Google Play pedem para conteúdo de usuário: denunciar, bloquear e a equipe agir.
17. **O fã continua sem apagar o próprio comentário (decisão de 30/09).** Nada aqui pede mudar: as lojas não exigem, e apagar abriria comentar, ganhar os pontos e apagar, além de sumir com a prova de uma denúncia. Quem quer um comentário fora pede à equipe (que oculta pela Moderação) ou exclui a conta.
18. **A exclusão de conta apaga os comentários do fã** (decisão do dono em 05/10/2026), descontando as contagens sem deixar negativo. Anonimizar ("Fã excluído") guardaria um texto que pode ter dado pessoal. Saem também as curtidas (com desconto), as presenças, as denúncias que ele fez (descontadas da fila), a lista de bloqueios dele e o uid dele nas listas dos outros. Os agregados do painel não descontam (seção 12).
19. **Mural de exemplo filtrado pelas centrais seguidas.** Nas fixtures, o mural mostra só as centrais do `followFixture` (de início, as três do protótipo, as mesmas de todos os posts de exemplo: a demonstração não muda), e a sheet "Sair da central" volta a dizer que os posts saem do mural, verdade nos dois modos.
20. **Texto do comentário limpo e validado igual no app e no servidor** (`cleanMultiline`, nos dois lados, nesta ordem): tira os isolantes bidi colados (U+2066 a U+2069); normaliza em NFC; troca `\r\n` e `\r` por `\n`; tira os espaços das pontas de cada linha; junta as linhas vazias seguidas numa e tira as das pontas. Depois, cada linha não vazia precisa ser visível (`isVisibleLine`), e o texto tem de 1 a 500 unidades de UTF-16, como o `maxLength` do campo. É a regra da bio das centrais (`parseBio`, que já faz o NFC e a troca do `\r`), com a limpeza dos isolantes do `cleanLine`. Sem o NFC e a troca do `\r`, o app e o servidor contariam tamanho e acentos de forma diferente, e um `\r` colado viraria `invisible`.
21. **Link de convite de um post só nasce com o post visível** (fecha o pendente de 20.2): o `PUT /me/invite/links/post:<id>` passa a ler o post e a central dele, como já lê a central no link `artist:<id>`.
22. **Quem lê pelo painel.** Posts e shows: as seções `artists` (quem publica), `moderation` (a fila mostra o post do comentário) e `fans` (as curtidas e presenças de um fã e quem vai a um show mostram o texto do post e o título do show). É conteúdo que o app mostra a qualquer fã logado; só os rascunhos ficam à vista dessas seções a mais. Comentários: `artists` ou `moderation`. Denúncias e fila: `moderation`. Curtidas e presenças, que dizem o que cada fã fez: `fans`, como o vínculo do bloco 4. Listas de bloqueio: ninguém pelo cliente, nem a equipe: dizem quem bloqueou quem, e nenhuma tela do painel as usa (se a Moderação precisar, abre com a tela e o teste). Shards das contagens: ninguém pelo cliente.
23. **`deleteArtist` recusa central com post ou show (`has-content`).** Única mudança de comportamento numa callable que já existe. Sem ela, apagar uma central sem fãs deixaria posts e shows apontando para um @ que outra central pode tomar depois, e a central nova herdaria a grade da antiga. A equipe tira do ar em vez de apagar, como já faz com `has-fans`. O rascunho que nunca foi ao ar não prende a central: a equipe o apaga antes (`deletePost`, `deleteEvent`) ou tira a central do show (`updateEvent`). Os testes de hoje do `deleteArtist` seguem verdes (eles não criam posts).

### 21.2 Rotas

| Método e caminho                                 | Grava | Função do app                                       | Resposta                     |
| ------------------------------------------------ | ----- | --------------------------------------------------- | ---------------------------- |
| `GET /feed`                                      | não   | `posts/api.ts` `fetchFeed`                          | `Page<Post>`                 |
| `GET /artists/:artistId/posts`                   | não   | `posts/api.ts` `fetchArtistPosts`                   | `Page<Post>`                 |
| `GET /posts/:postId`                             | não   | `posts/api.ts` `fetchPost`                          | `Post`                       |
| `GET /posts/:postId/comments`                    | não   | `posts/api.ts` `fetchComments`                      | `Page<PostComment>`          |
| `POST /posts/:postId/comments`                   | sim   | `posts/api.ts` `addComment`                         | `AddCommentResult`           |
| `PUT /posts/:postId/like`                        | sim   | `posts/api.ts` `setPostLike` (`liked: true`)        | `PointsAward`                |
| `DELETE /posts/:postId/like`                     | sim   | `posts/api.ts` `setPostLike` (`liked: false`)       | `PointsAward`                |
| `POST /posts/:postId/comments/:commentId/report` | sim   | `posts/api.ts` `reportComment` (novo)               | `ReportCommentResult` (novo) |
| `PUT /me/blocks/:fanId`                          | sim   | `posts/api.ts` `blockFan` (novo)                    | `BlockFanResult` (novo)      |
| `DELETE /me/blocks/:fanId`                       | sim   | nenhuma ainda (a tela de desbloquear é pergunta)    | `BlockFanResult`             |
| `GET /agenda` (com `artistId` opcional)          | não   | `agenda/api.ts` `fetchAgenda` e `fetchArtistAgenda` | `AgendaPage`                 |
| `GET /me/rsvps`                                  | não   | `agenda/api.ts` `fetchMyRsvps`                      | `MyRsvps`                    |
| `PUT /events/:eventId/rsvp`                      | sim   | `agenda/api.ts` `setEventRsvp` (`going: true`)      | `RsvpResult`                 |
| `DELETE /events/:eventId/rsvp`                   | sim   | `agenda/api.ts` `setEventRsvp` (`going: false`)     | `RsvpResult`                 |
| `GET /artists/:artistId` (bloco 4)               | não   | `artists/api.ts` `fetchArtist`                      | `postCount` de verdade       |
| `PUT /me/invite/links/:linkId` (bloco 5)         | sim   | `profile/api.ts` `registerInviteLink`               | `post:<id>` conferido        |

Arquivos: `functions/src/api/routes/posts.ts` (`postRoutes`), `routes/agenda.ts` (`agendaRoutes`) e `routes/moderation.ts` (`moderationRoutes`), somadas ao `API_ROUTES` depois de `inviteRoutes`. Os domínios, no molde de `functions/src/centrals` e `functions/src/artists`:

- `functions/src/posts/`: `model.ts` (puro, com teste em tabela: textos, visões, cursores, correção das contagens, janela da fila, constantes e o `PostError`), `service.ts` (Firestore: leituras das rotas, curtir, comentar, `removeFanEngagement` da exclusão), `sync.ts` (gatilho e tarefa da fila), `panel.ts` (as callables de posts), `errors.ts` (`HttpsError` com `details.reason`), `seed.ts` e `index.ts`.
- `functions/src/agenda/`: `model.ts` (fuso, visão do show, destaque, o corte `agendaCutoff` e `isEventOpen`, a central que paga a presença, `RSVP_READ_MAX`, `AgendaError`), `service.ts` (leituras, "Eu vou"), `panel.ts` (as callables de shows), `errors.ts`, `seed.ts` e `index.ts`.
- `functions/src/moderation/`: `model.ts` (motivos, tetos, filtro de bloqueados, `ModerationError`), `service.ts` (denunciar, bloquear, desbloquear, a fila), `panel.ts` (`moderateComment`), `errors.ts` e `index.ts`.
- `functions/src/staff/panel-actor.ts` (novo): `readPanelActor(read, db, caller, section, need)`, a leitura de `staff/{uid}` que o `artists/service.ts` faz no `readActor`, para uma seção qualquer. As callables novas usam este; o `readActor` dos artistas fica como está (migrar depois, sem pressa).
- (Implementação) Para não fechar ciclo de import entre os domínios: os caminhos e a leitura do post visível moram em `posts/store.ts` (`readVisiblePost`, que a moderação, o convite e o mural usam), os dos shows e presenças em `agenda/store.ts`, os da moderação em `moderation/store.ts`, e os tetos do dia sobre a carteira em `moderation/caps.ts` (`enforceDailyCap` e `countDailyAction`). O cursor das listas (`page-cursor.ts`) e a janela das filas (`window-task.ts`, `windowTask`, que o `fanCountSyncTask` do bloco 4 passou a usar) ficam na raiz de `functions/src`. A transação de uma ação de fã fora da API, que os seeds do bloco usam, é o `runAsFan` de `points/award.ts`. O `readArtistDetails` das centrais recebe o contador de posts de fora (a rota passa o `countArtistPosts` do mural), porque o mural importa das centrais. A seção que publica (`PANEL_CONTENT_SECTION`) e o `ContentDeps` das callables de conteúdo moram em `posts/panel.ts`.

Os tipos das respostas entram em `api/contract.ts`, espelho de `src/domains/posts/types.ts` e `src/domains/agenda/types.ts`. O `toApiHttpError` traduz `PostError`, `AgendaError` e `ModerationError`, como faz com o `CentralError`.

**Parâmetros comuns.** `cursor` opaco e `limit` de 1 a 50; sem `limit`, o padrão da rota: mural 10, posts da central 12 (quatro linhas da grade), comentários 20, agenda 20. O app não manda `limit`. Fora da faixa, 400 `invalid_request` com `details.field: 'limit'`. Cursor que não decodifica, com instante acima do maior `Timestamp` ou com id fora do formato, é 400 `invalid_request` com `details.field: 'cursor'`, como o do extrato (seção 6). O cursor é o base64url de `[instanteEmMs, id]`: `publishedAt` nos posts, `createdAt` nos comentários e `startsAt` na agenda.

**Ids na rota.** `postId`, `eventId` e `commentId` seguem `^[A-Za-z0-9_-]{1,128}$`, fora dos ids `__.*__`. Fora disso, o recurso não existe: 404 `post_not_found`, `event_not_found` ou `comment_not_found`, como o `artistParam` do bloco 4. `fanId` segue `^[A-Za-z0-9]{1,128}$` (o uid do Auth); fora disso, 404 `fan_not_found`.

**Códigos novos** (já na tabela da seção 1): `post_not_found` 404 "Post não encontrado."; `event_not_found` 404 "Show não encontrado."; `comment_not_found` 404 "Comentário não encontrado."; `fan_not_found` 404 "Fã não encontrado."; `comment_invalid` 400 "Comentário vazio, longo demais ou com caracteres invisíveis.", com `details.reason` `empty`, `too_long` ou `invisible`; `block_list_full` 409 "Você chegou ao limite de fãs bloqueados.". O 429 `too_many_requests` passa a valer também para os tetos de 21.7, com `details: { limit, action }`.

#### `GET /feed`

1. Lista `users/{uid}/centrals` (até 240) e, num `getAll`, os `artists/{id}` dessas centrais. Ficam as publicadas. Nenhuma: `{ "items": [], "nextCursor": null }`.
2. Em blocos de 30 centrais (o teto do `in`), em paralelo: `posts` com `status == 'published'`, `artistId in [bloco]`, `orderBy('publishedAt', 'desc')`, `orderBy(FieldPath.documentId(), 'desc')`, `startAfter` do cursor e `limit(limit + 1)`.
3. Junta os blocos na mesma ordem (instante decrescente, depois o id decrescente) e fica com os `limit` primeiros. Sobrou algum: `nextCursor` é o do último que ficou. Como cada bloco traz os `limit + 1` primeiros dele, a junção dá os primeiros do todo.
4. Num `getAll`: `users/{uid}/postLikes/{postId}` de cada post e `events/{eventId}` dos posts de show.
5. Monta cada `Post` (abaixo). As centrais já foram lidas no passo 1.

Custo, com um fã de 10 centrais: 10 vínculos, 10 centrais, até 11 posts, 10 curtidas e os shows dos posts de show, perto de 45 leituras por página. A leitura não exige o perfil (seção 1).

#### `GET /artists/:artistId/posts`

Central que não existe ou não está no ar: 404 `artist_not_found`. Senão, `posts` com `artistId == id`, `status == 'published'`, a mesma ordem e o mesmo cursor, `limit + 1`; depois as curtidas do fã e os shows, num `getAll`. Não exige ser membro.

#### `GET /posts/:postId`

Lê o post; depois, num `getAll`, a central dele, a curtida do fã e o show (post de show). Post que não existe, que não está no ar ou de central fora do ar: 404 `post_not_found`. Para o `commentCount` do detalhe, lê também os comentários do próprio fã nesse post (`authorUid == uid`, `orderBy('createdAt', 'desc')`, `limit(5)`) e soma os visíveis mais novos que a cópia (21.6). Não exige ser membro.

O `Post`, igual nas três rotas:

```json
{
  "id": "p-clipe",
  "kind": "video",
  "artist": {
    "id": "nettobrito",
    "name": "Netto Brito",
    "verified": true,
    "photoURL": "https://.../thumb-...-480.webp?alt=media&token=..."
  },
  "text": "Saiu o clipe de “Sonho de Amor”, gravado no São João de Irará.",
  "media": {
    "url": null,
    "thumbnailUrl": null,
    "width": 1920,
    "height": 1080
  },
  "event": null,
  "createdAt": "2026-10-05T13:00:00.000Z",
  "likeCount": 3,
  "commentCount": 4,
  "likedByMe": false,
  "sharePointsPerVisit": 2
}
```

- `artist`: `name` e `verified` de `artists/{id}`; `photoURL` é o `thumb.url` ou `null`.
- `media`: foto, `{ url: photo.url, thumbnailUrl: thumb.url, width: photo.width, height: photo.height }`; vídeo, o mesmo com a capa e `url` do mp4 (ou `null` sem o arquivo); texto e show, `null`. Foto ou vídeo sem mídia gravada (só o seed publica assim, como o clipe do exemplo acima) responde `{ url: null, thumbnailUrl: null, width, height }` com as medidas padrão das callables (foto 1080x1350, vídeo 1920x1080), o mesmo formato das fixtures (`mediaOf` em `posts/fixtures.ts`), e nunca `null`: o app decide a miniatura pela mídia (`withThumbnail` da `PostRow`, a mídia e a marca de vídeo da `PostContent`, o play da `PostGridRow`) e mostra o placeholder da marca pelo id quando a URL é nula. Com `media: null`, o clipe do seed sairia sem miniatura na 1b e como texto na grade da 1d.
- `event`: só no post de show, com o show no ar e não encerrado: `{ id, title, startsAt, city: "<cidade>, <UF>" }` (o `PostEvent` do app, que mostra "Aracaju, SE"). Senão, `null`.
- `createdAt`: o `publishedAt` (o "há 2 h" do mural é desde a publicação).
- `likeCount` e `commentCount`: as cópias, com a correção de quem chama (21.6).
- `likedByMe`: a curtida do fã existe e está ativa (`liked: true`).
- `sharePointsPerVisit`: `values.invite_visit` da configuração (cache de 60 s), ou `null` quando é 0. O app usa o `pointsPerVisit` do convite para o "+N" e este campo só para saber se o compartilhar rende (20.11).

#### `GET /posts/:postId/comments`

1. Lê o post e a central, como no detalhe (404 `post_not_found`).
2. Lê `blockLists/{uid}` (uma leitura).
3. `posts/{postId}/postComments` com `status == 'visible'`, `orderBy('createdAt', 'desc')`, `orderBy(FieldPath.documentId(), 'desc')`, `startAfter` do cursor e `limit(limit + 1)`. Tira os de autores bloqueados. Faltando para encher a página, busca de novo a partir do último lido, até 5 rodadas. `nextCursor` é o do último comentário lido (mostrado ou não) quando ainda há mais, senão `null`. A página pode sair menor que o `limit` e, com muitos comentários seguidos de bloqueados, até vazia com `nextCursor`: o app pede a seguinte sozinho nesse caso (21.13), porque a lista não cresceu e o fim dela não dispara de novo.

```json
{
  "items": [
    {
      "id": "seed-c-clipe-bia",
      "postId": "p-clipe",
      "authorId": "<uid da Bia>",
      "authorName": "Bia Santos",
      "authorAvatarUrl": null,
      "authorIsArtist": false,
      "text": "Já mandei pro grupo da família inteira, Irará em peso! 💃",
      "createdAt": "2026-10-05T14:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

`authorId` é o uid de quem escreveu: o app compara com o uid da sessão ("Você") e o usa como semente do avatar e no bloqueio. `authorIsArtist` é sempre `false` neste bloco (a resposta do artista pelo painel é pergunta, 21.16).

#### `POST /posts/:postId/comments`

Corpo `{ "text": "..." }`. O `validate` da rota limpa e confere o texto (`parseCommentText`, 21.1 decisão 20): sem texto depois da limpeza, 400 `comment_invalid` com `reason: 'empty'`; acima de 500, `too_long`; linha com invisível ou controle, `invisible`. Responde o comentário gravado, no formato da lista, com `pointsAwarded` (o `AddCommentResult` do app). O nome e a foto saem do perfil do fã, lido na transação, e nunca do corpo; perfil sem nome grava `authorName: 'Fã'`, o mesmo `post.comments.fallbackName` do app.

#### `PUT` e `DELETE /posts/:postId/like`

Sem corpo. Respondem `{ "pointsAwarded": 0 }` (o `PointsAward`). Curtir o que já está curtido e descurtir o que não está (sem documento, ou com `liked: false`) são sucesso sem efeito. Curtir post invisível: 404 `post_not_found`. Descurtir vale em qualquer status do post.

#### `POST /posts/:postId/comments/:commentId/report`

Corpo `{ "reason": "spam" }`, com `reason` em `spam`, `offensive`, `harassment` e `other`, ou `null` (ausente vale `null`). Outro valor: 400 `invalid_request` com `details.field: 'reason'`. Responde `{ "commentId": "...", "status": "reported" }`, ou `"already_reported"` quando o fã já denunciou este comentário (sem efeito). Comentário que não existe, oculto ou de post invisível: 404 `comment_not_found`. O próprio comentário: 400 `invalid_request` com `details.reason: 'own_comment'` (o app nunca mostra a opção nele).

#### `PUT` e `DELETE /me/blocks/:fanId`

Sem corpo. Respondem `{ "fanId": "...", "blocked": true }` (ou `false` no `DELETE`). Bloquear quem já está bloqueado e desbloquear quem não está são sucesso sem efeito. O próprio uid: 400 `invalid_request` com `details.reason: 'self'`. Fã sem `users/{fanId}`: 404 `fan_not_found` (o desbloqueio não confere, para tirar da lista uma conta excluída). Lista cheia (1.000): 409 `block_list_full`.

#### `GET /agenda`

Sem `artistId`: `events` com `status == 'published'`, `startsAt >= agendaCutoff(agora)` (o começo do dia de hoje em São Paulo, 21.1 decisão 14), `orderBy('startsAt')`, `orderBy(FieldPath.documentId())`, `startAfter` do cursor e `limit + 1`. Na primeira página (sem cursor), também o destaque: a mesma consulta, com o mesmo corte, `featured == true` e `limit(1)`; assim o destaque que o servidor manda nunca é um que o app já considera passado. Com `artistId`: central que não existe ou fora do ar dá 404 `artist_not_found`; a consulta ganha `artistIds array-contains <id>`, e `featured` é sempre `null` (é o que a aba Agenda da 1d já espera). Depois, num `getAll`, as centrais citadas na página e no destaque.

```json
{
  "featured": {
    "id": "sao-joao-irara",
    "title": "São João de Irará",
    "artists": [
      { "id": "nettobrito", "name": "Netto Brito" },
      { "id": "nenho", "name": "Nenho" }
    ],
    "city": "Irará",
    "state": "BA",
    "startsAt": "2026-11-22T01:00:00.000Z",
    "imageUrl": null,
    "invitePointsPerSignup": 10,
    "venue": null
  },
  "items": [],
  "nextCursor": null
}
```

- `artists`: só as centrais no ar, na ordem do show, com o `name` delas. Show sem central no ar sai com `[]`, e o app já tem o texto sem artistas (`agenda.metaNoArtists`).
- `imageUrl`: o `photo.url` do show, ou `null` (o app mostra o bloco ciano).
- `invitePointsPerSignup`: `values.invite_signup` da configuração, ou `null` quando é 0.
- `venue`: o local, ou `null`. Campo novo, opcional no app, guardado mas ainda não mostrado (pergunta 5 de 21.16).
- O destaque pode vir também em `items`, na data dele; a tela não o repete (como hoje).

#### `GET /me/rsvps`

Lê `users/{uid}/eventRsvps` até o fim, com o teto alto `RSVP_READ_MAX` (1.000 documentos, em `agenda/model.ts`), em `orderBy('updatedAt', 'desc')` (o índice automático), fica com os de `going: true` e, num `getAll`, lê os shows deles. Responde `{ "eventIds": [...] }` só com os shows no ar e não encerrados. Fã sem presença: `{ "eventIds": [] }`. Um corte menor (o `limit(100)` do primeiro desenho) perdia a presença de um show distante confirmada há tempo, e o app mostrava o "Eu vou" desligado enquanto o servidor respondia "já confirmado" sem efeito. Limite aceito: só um fã com mais de 1.000 trocas de presença depois de confirmar um show perde aquela presença na resposta (os shows vão até 2 anos à frente, e o teto é 50 por dia); a presença continua gravada, e o "Eu vou" do servidor continua certo. Guardar o `startsAt` na presença e consultar por ele foi descartado: o `updateEvent` teria de reescrever todas as presenças do show a cada troca de data.

#### `PUT` e `DELETE /events/:eventId/rsvp`

Sem corpo. Respondem o `RsvpResult`: `{ "eventId": "...", "going": true, "pointsAwarded": 0 }` (ou `going: false` e 0 no `DELETE`). Confirmar o que já está confirmado e desfazer o que não está (sem documento, ou com `going: false`) são sucesso sem efeito. Confirmar show que não existe, fora do ar ou encerrado (começou antes do corte de 21.1, decisão 14): 404 `event_not_found`, com `details.reason` `missing` ou `ended`. Desfazer vale em qualquer status do show.

#### `GET /artists/:artistId` e `PUT /me/invite/links/:linkId`

- `postCount` passa a ser o `count()` dos posts no ar da central (`artistId == id`, `status == 'published'`), lido em paralelo com o resto (`countArtistPosts`, em `posts/service.ts`). Sem o índice (só em produção), a contagem falha com o código 9: vale 0, com `logger.error` e a mensagem do link do índice, como a soma do "PTS DA CENTRAL" (19.7).
- O link `post:<id>` lê o post no mesmo `getAll` do `recordInviteLink` e, numa segunda leitura, a central dele; post invisível responde `created: false`, fora do teto do dia e dos agregados, como a central fora do ar no link `artist:<id>`. A origem `post` do claim e da visita continua sem conferência (20.2).

Todas as que gravam exigem `Idempotency-Key`, rodam no `runIdempotent` com o `requireFan` (perfil exigido, atividade marcada) e respondem 200.

### 21.3 Coleções e campos

```
posts/{postId} {
  artistId: string                   // a central (o @); não muda depois de criado
  kind: 'photo' | 'video' | 'text' | 'event'   // não muda depois de criado
  text: string                       // a legenda, várias linhas visíveis: 1 a 2.000 no texto e no show,
                                     // 0 a 2.000 na foto e no vídeo (foto sem legenda)
  media: {
    photo: { url, path, width, height }   // foto, ou a capa do vídeo
    thumb: { url, path, width, height }   // miniatura do mural e da grade
    video: { url, path, size } | null     // só no vídeo; video/mp4
  } | null                           // null em texto e show, e na foto ou vídeo ainda sem mídia
  eventId: string | null             // só no show; um show que tem a central do post
  status: 'draft' | 'published' | 'unpublished'
  publishedAt: Timestamp | null      // primeira publicação; a ordem do mural. Nulo: nunca foi ao ar
                                     // (só esse se apaga, deletePost)
  likeCount: number                  // cópia da soma dos shards (fila syncPostCounts)
  commentCount: number               // cópia, só os visíveis
  countsAt: Timestamp | null         // o instante da leitura dos shards copiada
  createdAt: Timestamp
  updatedAt: Timestamp               // edições da equipe; a fila não mexe
  createdBy: string                  // uid da equipe; o fã nunca lê este documento
  updatedBy: string
  schemaVersion: 1
}

posts/{postId}/postComments/{commentId} {
  postId: string
  artistId: string                   // cópia do post, para os agregados e o painel
  authorUid: string
  authorName: string                 // cópia do perfil na hora (21.1, decisão 9)
  authorPhotoURL: string | null
  text: string                       // já limpo (21.1, decisão 20)
  status: 'visible' | 'hidden'       // hidden: ocultado pela equipe (Moderação)
  createdAt: Timestamp               // o "agora" do pedido
  countedAt: Timestamp               // (implementação) serverTimestamp do commit que o pôs na contagem
                                     // (comentar, ou o restore da equipe); compara com o countsAt (21.6)
  hiddenAt: Timestamp | null
  hiddenBy: string | null            // uid da equipe
  schemaVersion: 1
}

postStats/{postId}/countShards/{0..15} {
  likes: number                      // soma de +1 e -1; um shard sozinho pode ficar negativo
  comments: number
  updatedAt: Timestamp
}

events/{eventId} {
  title: string                      // 1 a 80, uma linha visível
  artistIds: string[]                // 1 a 6 centrais, sem repetir; a primeira é a principal
  city: string                       // 1 a 60, uma linha visível
  state: string                      // UF, uma das 27 (BRAZIL_STATE_NAMES do app)
  venue: string | null               // o local, 1 a 80, uma linha visível
  startsAt: Timestamp                // o instante do começo
  startsAtLocal: string              // "2026-11-21T22:00", como a equipe digitou
  timeZone: string                   // "America/Bahia", um de BRAZIL_TIME_ZONES
  photo: { url, path, width, height } | null
  featured: boolean
  status: 'draft' | 'published' | 'unpublished'
  publishedAt: Timestamp | null      // nulo: nunca foi ao ar (só esse se apaga, deleteEvent)
  createdAt, updatedAt: Timestamp
  createdBy, updatedBy: string
  schemaVersion: 1
}

users/{uid}/postLikes/{postId} {     // nasce na primeira curtida e fica (21.1, decisão 8)
  uid: string
  postId: string
  artistId: string
  liked: boolean                     // o estado de agora; descurtir grava false
  firstLikedAt: Timestamp            // a primeira curtida (o bloco 7 conta a troca, 22.1)
  updatedAt: Timestamp               // a última troca de estado (o "agora" do pedido)
  countedAt: Timestamp               // (implementação) serverTimestamp do commit da última troca;
                                     // compara com o countsAt (21.6)
  schemaVersion: 1
}

users/{uid}/eventRsvps/{eventId} {   // nasce no primeiro "Eu vou" e fica
  uid: string
  eventId: string
  going: boolean                     // o estado de agora; desfazer grava false
  artistIds: string[]                // as centrais no ar do show na última confirmação, para os
                                     // agregados do desfazer
  firstGoingAt: Timestamp            // a primeira confirmação (o bloco 7 conta a troca, 22.1)
  updatedAt: Timestamp               // a última troca de estado
  schemaVersion: 1
}

commentReports/{commentId}_{reporterUid} {
  commentId: string
  postId: string
  artistId: string
  commentAuthorUid: string
  reporterUid: string
  reason: 'spam' | 'offensive' | 'harassment' | 'other' | null
  day: string                        // dia de São Paulo
  createdAt: Timestamp
  schemaVersion: 1
}

moderationQueue/{commentId} {        // um item por comentário denunciado
  commentId: string
  postId: string
  artistId: string
  authorUid: string
  commentText: string | null         // cópia na primeira denúncia; null depois que o autor excluiu a conta
  commentCreatedAt: Timestamp
  reportCount: number                // denúncias que existem (a exclusão de quem denunciou desconta)
  reasons: { spam, offensive, harassment, other, none }   // contagem por motivo
  status: 'open' | 'resolved'
  resolution: 'hidden' | 'kept' | 'author_deleted' | 'withdrawn' | null
                                     // withdrawn: aberto e sem denúncia, depois que quem denunciou
                                     // excluiu a conta (21.12)
  firstReportedAt: Timestamp
  lastReportedAt: Timestamp
  resolvedAt: Timestamp | null
  resolvedBy: { uid: string, name: string } | null
  schemaVersion: 1
}

blockLists/{uid} {                   // quem este fã bloqueou; só o servidor lê
  uid: string
  blocked: string[]                  // uids, até 1.000 (BLOCK_LIST_MAX)
  updatedAt: Timestamp
  schemaVersion: 1
}
```

- Ninguém grava nada disso pelo cliente. Post, show e o status do comentário mudam só pelas callables (21.9); o resto, só pela API e pela exclusão de conta.
- Ids do comentário: automáticos (`posts/{postId}/postComments` com `doc()`), novos a cada tentativa da transação, e únicos no banco todo. O seed usa ids fixos com o prefixo `seed-c-`. Por isso a fila e a denúncia usam só o `commentId`.
- `FanContext` (seção 5) ganha `displayName: string | null` e `photoURL: string | null`, tirados do perfil que o `requireFan` já leu: o comentário não lê o perfil de novo.
- Carteira: `days[dia].count` ganha as chaves que não rendem ponto dos tetos de 21.7 (`DailyActionKey` de `points/model.ts`): `like_set`, `comment_sent`, `rsvp_set`, `comment_report` e `fan_block`. Contam só com o fã como ator; o seed (sistema) não conta.
- Agregados: o `ShardDelta` (`points/stats.ts`) ganha em `totals` e em cada `byArtist[id]` os fluxos `likes`, `unlikes`, `comments`, `rsvps`, `rsvpsUndone` e `reports`, e só em `totals` o `blocks` (21.10).
- Contrato, no app e no `contract.ts`: `Post`, `PostComment` (sem `status` e `localId`, que são só do app), `Page`, `PointsAward`, `AddCommentResult`, `AgendaEvent` (com `venue?: string | null`, novo e opcional), `AgendaPage`, `MyRsvps` e `RsvpResult`, como estão. Novos: `CommentReportReason = 'spam' | 'offensive' | 'harassment' | 'other'`, `ReportCommentBody { reason: CommentReportReason | null }`, `ReportCommentResult { commentId: string; status: 'reported' | 'already_reported' }` e `BlockFanResult { fanId: string; blocked: boolean }`. O comentário do topo de `posts/types.ts` e de `agenda/types.ts` deixa de chamar o contrato de provisório.

### 21.4 Transações passo a passo

A ordem é a de sempre (seção 5): chave e fã (`runIdempotent`), leituras do domínio, `planAwards`, gravações do domínio. Depois, o `runIdempotent` grava o plano e a chave. O shard das contagens do post é `award.shard % 16` (`POST_SHARD_COUNT`), o mesmo sorteio do shard do painel, de novo a cada tentativa, como o do `fanCount`. Gravação sem leitura: `tx.set(ref, { likes: FieldValue.increment(±1), updatedAt }, { merge: true })`.

O núcleo de cada ação mora no `service.ts` do domínio e recebe `(tx, db, { fan, award, ... })`, para as rotas e o seed usarem o mesmo caminho (`runLikePost`, `runComment`, `runRsvp` e `runReport` abrem a transação fora da API, com o `requireFan` sem marca de atividade, como o `runJoinCentrals`).

**Curtir** (`likePost`):

1. `getAll`: `posts/{postId}` e `users/{uid}/postLikes/{postId}`. Depois, `artists/{artistId}` do post.
2. Post invisível (não existe, não está no ar ou a central não está no ar): `PostError('post_not_found')`.
3. Já curtido (`liked: true`): `planAwards` sem lançamentos (só a atividade) e responde 0.
4. Teto: com o fã como ator e `days[hoje].count.like_set` em 300 (`LIKES_PER_DAY`), `DailyCapError('like', LIKES_PER_DAY, segundos até a meia-noite)`, que o `toApiHttpError` traduz para 429 com `details: { limit, action }` e `Retry-After`, como o `too_many_entries` do bloco 4. Os outros tetos usam o mesmo erro.
5. `planAwards` com `{ kind: 'earn', source: 'like', eventId: postId, artistId, subject: { type: 'post', id: postId } }`. Na curtida de novo (documento com `liked: false`), o mesmo: o extrato `like:<postId>` impede pagar duas vezes (21.5).
6. Sem documento, `tx.create` da curtida (`liked: true`, `firstLikedAt` e `updatedAt` com o `award.now`, e `countedAt` com o `serverTimestamp`); com `liked: false`, `tx.update` de `liked: true`, `updatedAt` e `countedAt` (o `firstLikedAt` fica). Nos dois, `+1` em `likes` no shard do post; `addEngagementCounts(plan, [{ kind: 'like', artistIds: [artistId] }])`; `addDailyCount(plan, fan, 'like_set')`.
7. Responde `{ pointsAwarded: plan.pointsAwarded }`.

**Descurtir** (`unlikePost`): lê a curtida; `planAwards` vazio; com `liked: true`, `tx.update` de `liked: false`, `updatedAt` e `countedAt`, `-1` em `likes` no shard e `unlike` nos agregados, com o `artistId` da própria curtida. Sem documento ou com `liked: false`, nada além da atividade. Não lê o post: vale em qualquer status. Não mexe em ponto.

**Comentar** (`commentOnPost`):

1. O texto já veio limpo do `validate`.
2. Lê o post e a central, como no curtir; invisível, 404.
3. Teto: `comment_sent` em 100 (`COMMENTS_PER_DAY`), 429.
4. `ref = posts/{postId}/postComments.doc()`. O `runComment` do seed passa um id fixo (`seed-c-...`) e o comentário entra no `getAll` do passo 2: se ele já existe, sai sem efeito, sem plano. Sem essa leitura, rodar o seed de novo faria o `tx.create` falhar com `ALREADY_EXISTS` nas duas tentativas do `retryOnAlreadyExists`. A rota nunca passa id.
5. `planAwards` com `{ kind: 'earn', source: 'comment', eventId: ref.id, artistId, subject: { type: 'comment', id: ref.id } }`. Passou do limite diário de `comment` (padrão 20): o comentário entra e rende 0.
6. `tx.create` do comentário (`status: 'visible'`, `authorName` e `authorPhotoURL` do `FanContext`, `countedAt` com o `serverTimestamp`); `+1` em `comments` no shard; `comment` nos agregados; `addDailyCount(plan, fan, 'comment_sent')`.
7. Responde o comentário com `pointsAwarded`.

**Denunciar** (`reportComment`, em `moderation/service.ts`):

1. `getAll`: o post, o comentário, `commentReports/{commentId}_{uid}` e `moderationQueue/{commentId}`. Depois, a central do post.
2. Post invisível, comentário que não existe ou oculto: `ModerationError('comment_not_found')`.
3. O autor é quem chama: 400 com `reason: 'own_comment'`.
4. A denúncia existe: `already_reported`, sem plano (fica a atividade).
5. Teto: `comment_report` em 30 (`REPORTS_PER_DAY`), 429.
6. `planAwards` vazio.
7. `tx.create` da denúncia. Fila: sem item, `tx.create` com o texto copiado, `reportCount: 1`, o motivo contado (`none` para `null`), `status: 'open'`; com item, `tx.update` com `reportCount` e o motivo mais 1 e `lastReportedAt`; item `resolved` com `resolution` `kept` ou `withdrawn` volta a `open` (`resolution: null`, `resolvedAt` e `resolvedBy` nulos). `report` nos agregados; `addDailyCount(plan, fan, 'comment_report')`.
8. Responde `reported`.

**Bloquear** (`blockFan`):

1. O `fanId` é o próprio uid: 400 com `reason: 'self'`.
2. `getAll`: `blockLists/{uid}` e `users/{fanId}`. Sem o perfil do outro: 404 `fan_not_found`.
3. Já está na lista: sucesso sem efeito (só a atividade).
4. Lista com 1.000: 409 `block_list_full`. Teto: `fan_block` em 30 (`BLOCKS_PER_DAY`), 429.
5. `planAwards` vazio; `tx.set` de `blockLists/{uid}` com a lista lida mais o `fanId` (a lista inteira, não `arrayUnion`: a transação já a leu); `block` nos agregados; `addDailyCount(plan, fan, 'fan_block')`.

**Desbloquear** (`unblockFan`): lê a lista; com o `fanId` nela, grava a lista sem ele. Sem teto e sem agregado.

**Confirmar presença** (`rsvpEvent`, em `agenda/service.ts`):

1. `getAll`: `events/{eventId}` e `users/{uid}/eventRsvps/{eventId}`. Depois, num `getAll`, `artists/{id}` de cada central do show (até 6).
2. Show que não existe ou fora do ar: `AgendaError('event_not_found', { reason: 'missing' })`; encerrado (`startsAt < agendaCutoff(agora)`, `isEventOpen`, 21.1 decisão 14): `reason: 'ended'`.
3. Já confirmado (`going: true`): responde `going: true` e 0, sem plano.
4. Teto: `rsvp_set` em 50 (`RSVPS_PER_DAY`), 429.
5. As centrais no ar do show, na ordem dele (`published`). `planAwards` com `{ kind: 'earn', source: 'rsvp', eventId, artistId: <a primeira delas>, subject: { type: 'event', id: eventId } }`; sem nenhuma no ar, sem `artistId` (paga sem central).
6. Sem documento, `tx.create` da presença (`going: true`, `firstGoingAt` e `updatedAt` com o `award.now`, `artistIds` com as centrais no ar); com `going: false`, `tx.update` de `going: true`, `updatedAt` e `artistIds` (o `firstGoingAt` fica). Nos dois, `rsvp` nos agregados de cada central no ar do show; `addDailyCount(plan, fan, 'rsvp_set')`.
7. Responde `{ eventId, going: true, pointsAwarded }`.

**Desfazer a presença** (`unrsvpEvent`): lê a presença; com `going: true`, `tx.update` de `going: false` e `updatedAt`, e `rsvpsUndone` nos agregados das centrais copiadas nela. Não lê o show nem as centrais. Responde `going: false` e 0.

Custo: curtir que paga numa central, 9 leituras (chave, perfil, carteira, post, curtida, central, temporada, extrato, pontos da central) e até 8 gravações (curtida, shard do post, shard do painel, carteira, extrato, pontos da central, chave e o comentário, no comentar). Curtir que rende 0 grava a curtida, os dois shards, a carteira (o contador do teto) e a chave. O "Eu vou" lê também as centrais do show, até 6. A carteira passa a ser gravada em toda curtida, comentário, presença, denúncia e bloqueio novos, pelo contador do teto: é um documento do fã, sem disputa.

Concorrência: muitos fãs curtindo o mesmo post gravam em 16 shards, e todos leem `posts/{postId}` na transação. A cópia vai por fila (21.6) justamente para o documento do post receber no máximo uma gravação a cada 10 s, e o teto ficar nos shards: perto de 16 curtidas ou comentários por segundo no mesmo post, sustentados. A leitura do post fica na transação de propósito, como a da central no bloco 4: é ela que põe em ordem a curtida e o `setPostStatus`. Sinal: `unavailable` nos logs da `api` nessas rotas. Primeiro passo: subir `POST_SHARD_COUNT`, porque quem soma lista a subcoleção. Dois pedidos do mesmo fã (curtir e descurtir em sequência, com chaves diferentes) disputam a curtida e a carteira; um repete, e o app já manda os dois em ordem (`scope`).

### 21.5 Idempotência e o evento de pontos

- Pedido: a `Idempotency-Key` de sempre. O app já manda no curtir, no comentar e no "Eu vou" (`createIdempotencyKey()` nas variáveis, a mesma nas novas tentativas da fila), e passa a mandar na denúncia e no bloqueio, com a chave da tentativa (21.13).
- Negócio: `like:<postId>` uma vez na vida por fã e post; `comment:<commentId>` uma vez por comentário (o id muda a cada comentário novo, e uma repetição com a mesma chave devolve a resposta guardada, com o mesmo id); `rsvp:<eventId>` uma vez por fã e show. A curtida e a presença são idempotentes também pelo estado: o documento nasce uma vez e fica, e o shard, os fluxos e o teto só mexem quando o estado troca. A denúncia e o bloqueio, por existir ou não.
- Missões (bloco 7): a curtida e a presença guardam a primeira vez (`firstLikedAt`, `firstGoingAt`), e só a ação que cria o documento é a primeira. O bloco 7 acabou contando a troca para curtido e para "Eu vou", um alvo por missão e período (decisão 4 de 22.1): a primeira vez da vida deixava missões que nunca fecham. Os dois campos ficam, sem uso nas missões.
- Valores e limites de `config/points`: `like` 0 e 50 por dia, `comment` 2 e 20, `rsvp` 0 e 10 (seção 4). Os tetos de 21.7 são outra coisa: contam ações, pagas ou não, e recusam.
- A curtida que rendeu 0 não grava extrato. Se a cliente subir o valor de curtir, o fã que já curtiu e descurte e curte de novo ganha a curtida uma vez. É o comportamento combinado da seção 5 (limites diários), e não dá para pagar duas vezes.

### 21.6 Contagens: shards, o gatilho e a fila `syncPostCounts`

Duas funções em `posts/sync.ts`, exportadas em `functions/src/index.ts` depois do `setGlobalOptions`, sem dependência nova, no molde de 19.6:

- **Gatilho `queuePostCountSync`:** `onDocumentWritten('postStats/{postId}/countShards/{shard}', { retry: true })`. Põe na fila `syncPostCounts` (`locations/southamerica-east1/functions/syncPostCounts`) a tarefa da janela da gravação: id `postcounts-<postId>-<janela de 10 s>` e `scheduleTime` 1 s depois do fim da janela, pelo `event.time`. Id repetido é ignorado; outro erro lança; `postId` fora do formato vai para o `logger.error` sem lançar. No emulador (`FUNCTIONS_EMULATOR`), sem id e sem horário, uma tarefa por gravação.
- **Tarefa `syncPostCounts`:** `onTaskDispatched({ retryConfig: { maxAttempts: 5, minBackoffSeconds: 10 } })`. Soma `likes` e `comments` dos shards fora de transação (soma negativa vira 0, com `logger.error`) e, numa transação que lê `posts/{postId}`, copia `likeCount`, `commentCount` e `countsAt` (o `readTime` da leitura) quando a leitura é mais nova que o `countsAt` gravado, com a precisão de microssegundos do `exactMillis`. Post que não existe: não grava. Não mexe no `updatedAt`.
- O cálculo da janela (`fanCountSyncTask`) sai de `centrals/model.ts` para uma função comum, `windowTask(prefix, id, eventTime)`, usada pelas duas filas. O comportamento do bloco 4 não muda, e os testes dele continuam iguais.

**Correção para quem chama** (`viewCounts`, puro, em `posts/model.ts`), a mesma ideia do `memberFanCount` (19.2):

- `likeCount`: a cópia, mais 1 quando a curtida do fã está ativa (`liked: true`) e o `countedAt` dela é depois do `countsAt` (ou não há `countsAt`). Vale nas três rotas de post, que já leem a curtida do fã.
- `commentCount`, só no detalhe: a cópia, mais os comentários visíveis do próprio fã nesse post com o `countedAt` depois do `countsAt` (a consulta de até 5 de `GET /posts/:postId`). Nas listas, a cópia: depois de comentar, o app soma 1 em todo cache (`commitComment`) e busca de novo só o detalhe.
- (Implementação, depois da revisão) A comparação usa o `countedAt`, o `serverTimestamp` do commit da curtida ou do comentário, e não o `updatedAt` ou o `createdAt`, que guardam o `award.now`: o começo do pedido, igual em toda tentativa da transação. O `countsAt` é o `readTime` da leitura dos shards, do mesmo relógio do commit. Uma cópia que lê os shards entre o começo do pedido e o commit não tem a ação e fica com o `countsAt` depois do `award.now`: com o `updatedAt`, o fã que curtiu recebia `likedByMe: true` com a contagem sem a curtida dele por uns 10 s, e isso acontece em post popular (a cópia grava em `posts/{id}`, que a curtida lê na transação, e a curtida repetida grava depois da leitura). Commit e leitura no mesmo instante: a leitura já vê o commit, e a correção não soma. O `restore` da equipe também grava o `countedAt` (o comentário volta à contagem ali). Documento sem `countedAt` (gravado à mão) usa o `updatedAt` ou o `createdAt`.
- Limites aceitos, como no bloco 4: quem descurte logo depois de a cópia contar a curtida vê 1 a mais por uns 10 a 20 s; as ações dos outros fãs aparecem uns 10 a 20 s depois. O comentário ocultado pela equipe sai da contagem pelo mesmo shard (`-1` em `comments`), e o reexibido volta (`+1`).

Custo por curtida ou comentário: uma execução do gatilho e uma chamada ao Cloud Tasks, quase sempre recusada como repetida; por janela de 10 s com mudança, uma tarefa com até 17 leituras e uma gravação.

### 21.7 Antifraude e tetos do dia

| Risco                                               | Barreira                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Pontos repetidos por curtir e descurtir             | `like:<postId>` paga uma vez na vida; descurtir não tira                                   |
| Comentários em massa por pontos                     | limite diário de `comment` (20 pagos) e o teto de 100 comentários por dia                  |
| Curtir e descurtir sem parar (fluxos e fila)        | 300 trocas para curtido por dia; descurtir fica preso às curtidas                          |
| "Eu vou" em massa                                   | `rsvp:<eventId>` paga uma vez por show, 50 trocas para "Eu vou" por dia, só em show aberto |
| Pontos para central em rascunho pelo "Eu vou"       | paga e soma só nas centrais do show que estão no ar, lidas na transação                    |
| Denúncias em massa contra um fã                     | uma por fã e comentário, 30 por dia, só com perfil; nada é ocultado sozinho pelo número    |
| Bloqueios em massa                                  | 30 por dia e lista de até 1.000                                                            |
| Comentário com texto invisível ou que quebra a tela | a limpeza e a validação de 21.1 (decisão 20), no app e no servidor                         |
| Ação em post ou show fora do ar                     | o post e a central (ou o show) lidos na transação                                          |
| Conta excluída que ainda tem token                  | o `requireFan` em toda gravação (seção 1)                                                  |

Os tetos ficam em constantes de `moderation/model.ts` (`LIKES_PER_DAY`, `COMMENTS_PER_DAY`, `RSVPS_PER_DAY`, `REPORTS_PER_DAY`, `BLOCKS_PER_DAY` e `BLOCK_LIST_MAX`), com o `DailyCapError` e a conta do `Retry-After`, que os três domínios usam; se o painel quiser ajustar, vão para `config/points`, ao lado dos limites diários. Nenhum fã de verdade chega perto. No app, o 429 é o kind `unknown`: a curtida desfaz e avisa, o comentário fica "Não enviado", e a sheet mostra o erro. Sem App Check, como no bloco 1.

### 21.8 Moderação

Provisória até as regras da cliente (UP-48). O que existe neste bloco:

- **Denúncia** de um comentário de outro fã, uma vez por fã, com motivo opcional (`spam`, `offensive`, `harassment`, `other` ou nenhum). A denúncia não esconde o comentário de ninguém. A tela oferece também bloquear o autor, que esconde os comentários dele para quem denunciou.
- **Fila** em `moderationQueue/{commentId}`: um item por comentário, com a cópia do texto, quantas denúncias e por qual motivo, e o estado. A seção Moderação do painel lista os itens `open` por `lastReportedAt`, decrescente (índice em 21.11), lê as denúncias de um item (`commentReports` com `commentId == ...`) e o comentário e o post (as regras de 21.11 abrem `posts` para a seção `moderation`).
- **Ação da equipe** pela callable `moderateComment` (21.9), com a seção `moderation`: `hide` (o comentário some para todos, sai da contagem, e o item vai a `resolved` com `hidden`), `keep` (só em comentário visível: o item vai a `resolved` com `kept`; uma denúncia nova o reabre; em comentário oculto é recusado com `comment-hidden`, porque deixaria o item "mantido" com o comentário escondido, e para isso existe o `restore`) e `restore` (o oculto volta, entra na contagem de novo, e o item fica `resolved` com `kept`). Ocultar não tira os pontos do comentário: o ajuste manual da seção Fãs (seção 9) cobre os casos graves.
- **Bloqueio** unilateral: some para quem bloqueou, em todos os posts, inclusive os comentários antigos; o bloqueado não sabe e continua vendo os comentários de quem o bloqueou. A contagem do post continua a de todos. A lista não aparece no app neste bloco (pergunta 8 de 21.16); a rota de desbloquear já existe. A equipe também não lê as listas (21.1, decisão 22).
- **O que as lojas pedem e não é código:** a equipe olhar a fila todo dia (a App Store fala em agir em até 24 h), os termos de uso com a regra de conteúdo e o contato da equipe (UP-45). Vai na lista para a cliente.

### 21.9 Callables do painel (contrato para o bloco 11)

No molde de `functions/src/artists`: exportadas no `src/index.ts` depois do `setGlobalOptions`, com `cors: PANEL_ORIGINS`, erro `HttpsError(código, mensagem em pt-BR, { reason })`, o acesso lido de `staff/{uid}` a cada chamada e de novo na transação (`readPanelActor`), e uma entrada em `staffAudit` por mudança (`targetEmail: ''`, `targetUid: null`, o alvo em `details`). Fora da equipe ativa: `not-staff`; sem a seção, ou só leitura numa mudança: `no-section`. Nada mudou: `{ ok: true }` sem gravar nem auditar. As ações novas entram no `AuditAction` de `staff/service.ts`: `post.created`, `post.updated`, `post.published`, `post.unpublished`, `post.deleted`, `event.created`, `event.updated`, `event.published`, `event.unpublished`, `event.deleted`, `comment.hidden`, `comment.kept` e `comment.restored`. A auditoria nunca leva o texto de um comentário.

**Posts** (admin, ou editor com `artists`):

| Callable        | Pedido                                             | Resposta       | Motivos de recusa (`details.reason`)                                                                                                                                                  |
| --------------- | -------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createPost`    | `{ artistId, kind, text, eventId? }`               | `{ postId }`   | `invalid-request`, `artist-not-found`, `invalid-kind`, `invalid-text`, `event-not-found`, `event-artist-mismatch`                                                                     |
| `updatePost`    | `{ postId, text?, eventId?, media? }`              | `{ ok: true }` | `post-not-found`, `invalid-text`, `event-not-found`, `event-artist-mismatch`, `media-not-allowed`, `invalid-media`, `media-not-found`, `published-needs-media`, `event-not-published` |
| `setPostStatus` | `{ postId, status: 'published' \| 'unpublished' }` | `{ ok: true }` | `post-not-found`, `invalid-status`, `missing-media`, `event-not-published`                                                                                                            |
| `deletePost`    | `{ postId }`                                       | `{ ok: true }` | `post-not-found`, `was-published`                                                                                                                                                     |

- `createPost` cria o rascunho, com `likeCount` e `commentCount` 0, `countsAt` e `publishedAt` nulos, e devolve o id automático. A central precisa existir (em qualquer status). `kind` é `photo`, `video`, `text` ou `event`, e não muda depois. `text`, depois da limpeza de 21.1 (decisão 20), com o mesmo `cleanMultiline`: de 1 a 2.000 no texto e no show; de 0 a 2.000 na foto e no vídeo, que podem sair sem legenda (`invalid-text`). O app já trata o texto vazio no detalhe (`post.text ? ... : null` na `PostContent`); a linha da 1b ganha o mesmo cuidado (21.13). `eventId` só no `event`, obrigatório nele, de um show que existe e tem a central do post entre os artistas (`event-artist-mismatch`); nos outros tipos, ausente ou `null`.
- `updatePost`: ausente não muda. `media` só em foto e vídeo (`media-not-allowed` nos outros): `{ photoPath, thumbPath }` na foto; `{ photoPath, thumbPath, videoPath? }` no vídeo (a capa obrigatória, o mp4 opcional); `null` tira, só fora do ar (`published-needs-media`). Os caminhos são arquivos diretos em `posts/{postId}/`, diferentes entre si (`invalid-media`). A função confere no bucket, antes da transação: existe (`media-not-found`), foto e miniatura são `image/(webp|jpeg|png)` e o vídeo é `video/mp4` (`invalid-media`); grava `{ url, path, width, height }` das imagens, com a URL do `getDownloadURL` e as medidas do metadado customizado `width` e `height` (sem eles: foto 1080x1350, miniatura 480x600; capa de vídeo 1920x1080, miniatura 480x270), e `{ url, path, size }` do vídeo. Depois da transação, limpa a pasta `posts/{postId}/` como o `updateArtist` limpa a da central (`removeFiles`, sem travar a resposta). Trocar o show de um post no ar exige o show novo no ar (`event-not-published`).
- `setPostStatus`: publicar exige a mídia na foto e no vídeo (`missing-media`) e o show no ar no post de show (`event-not-published`). A central pode estar fora do ar: o post aparece quando ela for publicada. A primeira publicação grava `publishedAt`; republicar mantém o primeiro (o post volta para o lugar dele no mural). Tirar do ar não mexe em curtida, comentário nem contagem.
- `deletePost`: só o post que nunca foi ao ar (`publishedAt` nulo, lido na transação; senão `was-published`, e a equipe tira do ar). Apaga `posts/{postId}` e `postStats/{postId}` (vazio: sem publicação, nenhuma rota grava nele) e, depois da transação, a pasta `posts/{postId}/` no Storage (`removeFiles`, sem travar a resposta, como no `deleteArtist`). Audita `post.deleted` com `artistId` e `kind` em `details`. É o que solta a central de um rascunho criado por engano (21.1, decisões 4 e 23). Admin ou editor com `artists`, como as outras callables de conteúdo: o `deleteArtist` é só do admin porque apaga uma central que pode ter história, e aqui só sai o que nenhum fã viu.

**Shows** (admin, ou editor com `artists`):

| Callable         | Pedido                                                                                                 | Resposta       | Motivos de recusa                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createEvent`    | `{ title, artistIds, city, state, venue?, startsAtLocal, timeZone, featured? }`                        | `{ eventId }`  | `invalid-request`, `invalid-title`, `invalid-artists`, `artist-not-found`, `invalid-city`, `invalid-state`, `invalid-venue`, `invalid-starts-at`, `invalid-time-zone`, `event-in-past` |
| `updateEvent`    | `{ eventId, title?, artistIds?, city?, state?, venue?, startsAtLocal?, timeZone?, featured?, photo? }` | `{ ok: true }` | os de cima, mais `event-not-found`, `invalid-photo`, `photo-not-found` e `event-has-posts`                                                                                             |
| `setEventStatus` | `{ eventId, status: 'published' \| 'unpublished' }`                                                    | `{ ok: true }` | `event-not-found`, `invalid-status`                                                                                                                                                    |
| `deleteEvent`    | `{ eventId }`                                                                                          | `{ ok: true }` | `event-not-found`, `was-published`, `event-has-posts`                                                                                                                                  |

- `artistIds`: de 1 a 6 @ sem repetir, de centrais que existem (em qualquer status). `state`: uma das 27 UFs. `venue`: opcional, `null` ou vazio limpa. `startsAtLocal`: `YYYY-MM-DDTHH:mm`, uma data que existe. `timeZone`: um de `BRAZIL_TIME_ZONES` (`America/Noronha`, `America/Belem`, `America/Fortaleza`, `America/Recife`, `America/Araguaina`, `America/Maceio`, `America/Bahia`, `America/Sao_Paulo`, `America/Campo_Grande`, `America/Cuiaba`, `America/Santarem`, `America/Porto_Velho`, `America/Boa_Vista`, `America/Manaus`, `America/Eirunepe` e `America/Rio_Branco`). O servidor exporta `DEFAULT_TIME_ZONE_BY_STATE` (BA `America/Bahia`, SE e AL `America/Maceio`, PE `America/Recife`, CE, RN, PB, PI e MA `America/Fortaleza`, PA e AP `America/Belem`, TO `America/Araguaina`, MS `America/Campo_Grande`, MT `America/Cuiaba`, RO `America/Porto_Velho`, RR `America/Boa_Vista`, AM `America/Manaus`, AC `America/Rio_Branco`, o resto `America/Sao_Paulo`), que o painel copia para sugerir o fuso pela UF.
- O instante sai de `zonedLocalToUtc(startsAtLocal, timeZone)`, puro, em `agenda/model.ts`, só com `Intl.DateTimeFormat` (o deslocamento do fuso naquele instante, calculado duas vezes para cobrir uma mudança de horário). Data mais de 24 h no passado, ao criar ou ao mudar a data, é `event-in-past`; mais de 2 anos à frente é `invalid-starts-at`.
- `photo`: `{ photoPath }`, um arquivo direto em `events/{eventId}/`, imagem até 5 MB (o painel prepara uma versão em paisagem, 1200x675 sugerida); `null` tira. Conferida e limpa como a mídia do post.
- `updateEvent` com `artistIds`: na transação, lê os posts que apontam para o show das centrais que saem da lista (`posts` com `eventId == id` e `artistId in` as que saem, até 6, pelos índices automáticos de campo único, até 20 posts) e recusa com `event-has-posts` quando vem algum (`details.postIds` com os ids). (Implementação, depois da revisão) A primeira versão lia os 20 primeiros posts do show, de qualquer central, e filtrava depois: num show com mais de 20 posts, o post da central que sai do 21º em diante passava. Sem isso, a troca quebraria o que o `createPost` garante (`event-artist-mismatch`), e o "Eu vou" do post passaria a pagar outra central. A equipe tira o post do ar e troca o show dele (`updatePost`) antes.
- `setEventStatus`: publicar não exige foto nem central no ar. Tirar do ar não apaga presenças; o post de show perde a linha do show (21.1, decisão 15).
- `deleteEvent`: só o show que nunca foi ao ar (`publishedAt` nulo; senão `was-published`) e para o qual nenhum post aponta (`event-has-posts`, com `details.postIds`; a equipe troca o show do post, ou apaga o post se ele também nunca foi ao ar). Apaga `events/{eventId}` e, depois da transação, a pasta `events/{eventId}/`. Audita `event.deleted` com `artistIds` em `details`. Solta as centrais do show (21.1, decisões 4 e 23).

**Moderação** (admin, ou editor com `moderation`):

| Callable          | Pedido                                                         | Resposta               | Motivos de recusa                                                                          |
| ----------------- | -------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `moderateComment` | `{ postId, commentId, action: 'hide' \| 'keep' \| 'restore' }` | `{ ok: true, status }` | `invalid-request`, `comment-not-found`, `invalid-action`, `not-reported`, `comment-hidden` |

- `hide`: na transação, lê o comentário e o item da fila; visível vira `hidden` (`hiddenAt`, `hiddenBy`), `-1` em `comments` num shard do post, e o item (se houver) vai a `resolved` com `hidden`. Já oculto: sem efeito. (Implementação) A auditoria leva em `details` o `postId`, o `commentId`, o `artistId` e o `authorUid`, nunca o texto; o item que já está como pedido (`resolved` com a mesma `resolution`) não é regravado nem auditado.
- `keep`: o item vai a `resolved` com `kept`. Sem item: `not-reported`. Comentário oculto: `comment-hidden` (21.8; para reexibir, `restore`).
- `restore`: oculto volta a `visible`, `+1` em `comments`, e o item (se houver) fica `resolved` com `kept`.
- `status` na resposta é o do comentário depois da ação.

**Storage** (as regras estão em 21.11): `posts/{postId}/{arquivo}` e `events/{eventId}/{arquivo}`, nome novo a cada envio (sugestão: `photo-{ts}-1440.webp`, `thumb-{ts}-480.webp`, `video-{ts}.mp4`), com `cacheControl` de um ano e `width` e `height` no metadado das imagens, como o `uploadArtistPhoto` do painel. Imagem até 5 MB; vídeo `video/mp4` até 50 MB. O documento precisa existir antes do envio, e o tipo do post decide o que entra: foto, só imagem; vídeo, imagem (a capa) ou mp4; texto e show, nada.

**Leituras diretas do painel** (bloco 11), com as regras de 21.11 e sem escuta em tempo real nos posts (a cópia das contagens grava neles a cada 10 s por post com movimento): os posts de uma central (`posts` com `artistId == id`, `orderBy('createdAt', 'desc')`), os shows (`events` por `startsAt`), os comentários de um post, a fila e as denúncias (com o comentário e o post, na Moderação), as curtidas e presenças de um fã (com o post e o show de cada uma, na seção Fãs) e quem vai a um show (grupo `eventRsvps` com `eventId == id` e `going == true`).

### 21.10 Efeitos no painel e agregados

- **Agregados** (`statsShards`, seção 7): `addEngagementCounts(plan, changes)`, em `points/award.ts`, como o `addMembershipCounts`: cria o `plan.shard` quando ele veio `null` e soma, em `totals` e em `byArtist[id]`, `likes`, `unlikes`, `comments`, `rsvps`, `rsvpsUndone` e `reports`, e só em `totals` o `blocks`. Continua uma gravação de shard por transação, e contador zerado não é gravado (`pruneZeros`). São fluxo: a exclusão de conta e a ação da equipe não descontam. `byArtist` recebe só centrais no ar (21.1, decisão 10).
- **Teto dos shards do dia:** toda curtida, descurtida, comentário, presença, desfazer, denúncia e bloqueio passa a gravar um dos 64 shards do dia, pontue ou não. O teto de perto de 64 transações por segundo no país (seção 7, "Custo e limite de escrita") passa a ser dividido entre os pontos, a atividade, as centrais, o convite e todo o engajamento. Sinal para subir o `SHARD_COUNT`: `unavailable` ou transações repetidas nos logs da `api` nas rotas de curtir, comentar e "Eu vou" (as mais frequentes), como na seção 7; quem lê lista a subcoleção, então subir não pede mudança no painel. "Engajamento por artista e por dia" é `byArtist[id]` nos shards do dia. Os pontos de curtir, comentar e "Eu vou" já entram em `bySource` e `byArtist[id].bySource` pelo `award`, quando pagam.
- **Visão geral e Crescimento** (bloco 11): curtidas, comentários, presenças e denúncias por dia e por central, e os fãs ativos, que já contam essas ações (seção 7).
- **Artistas** (bloco 11): as telas de Mural e Agenda dentro da seção, com as callables de 21.9; o `postCount` da central, se quiser, pelo mesmo `count()`. O `deleteArtist` passa a recusar central com post ou show (`has-content`), lido na transação (`posts` com `artistId == id` e `events` com `artistIds array-contains id`, `limit(1)` cada). Conta qualquer post ou show, também o rascunho: o que nunca foi ao ar se apaga antes (`deletePost`, `deleteEvent`), e o painel mostra a mensagem do servidor (`HttpsError` com a frase em pt-BR) sem mudar código.
- **Moderação** (bloco 11): a fila e as denúncias (21.8), com `moderateComment`, e o post de cada comentário.
- **Fãs** (bloco 11): as curtidas e presenças ativas de um fã (`users/{uid}/postLikes` com `liked == true` e `eventRsvps` com `going == true`), com o post e o show de cada uma, e quem vai a um show (grupo `eventRsvps` com `eventId == id` e `going == true`).
- **Nenhuma mudança no código do painel** neste bloco. As callables de hoje não mudam, fora o `has-content` do `deleteArtist`.

### 21.11 Regras do Firestore e do Storage, índices

Acréscimo ao `firestore.rules`. Nenhuma regra existente muda; os blocos de curtida e presença entram dentro do `match /users/{uid}`, e os outros antes do `match /{document=**}` final.

```
    match /users/{uid} {
      // (regras de hoje do perfil e do vínculo com as centrais)

      // Curtidas e presenças do fã: só o servidor grava (API). O fã não lê
      // nem as próprias: chegam pela API (likedByMe, /me/rsvps). A equipe com
      // a seção fans lê (seção Fãs do painel).
      match /postLikes/{postId} {
        allow read: if canSeeSection('fans');
        allow write: if false;
      }
      match /eventRsvps/{eventId} {
        allow read: if canSeeSection('fans');
        allow write: if false;
      }
    }

    // Pelos grupos de coleção (quem vai a um show, no painel). Valem para
    // qualquer coleção com estes nomes: nenhuma outra pode se chamar assim.
    match /{path=**}/postLikes/{postId} {
      allow read: if canSeeSection('fans');
    }
    match /{path=**}/eventRsvps/{eventId} {
      allow read: if canSeeSection('fans');
    }

    // Posts e shows: quem publica (artists), a Moderação (o post do comentário
    // denunciado) e a seção Fãs (o post e o show das curtidas e presenças).
    function canSeeContent() {
      return canSeeSection('artists')
        || canSeeSection('moderation')
        || canSeeSection('fans');
    }

    // Mural (bloco 6): a equipe publica pelas callables, com a seção artists.
    // O fã lê tudo pela API, nunca direto, nem os posts no ar.
    match /posts/{postId} {
      allow read: if canSeeContent();
      allow write: if false;

      // Comentários: a equipe que cuida do conteúdo e a da Moderação.
      match /postComments/{commentId} {
        allow read: if canSeeSection('artists') || canSeeSection('moderation');
        allow write: if false;
      }
    }

    match /{path=**}/postComments/{commentId} {
      allow read: if canSeeSection('artists') || canSeeSection('moderation');
    }

    // Contagens dos posts em shards: só o servidor.
    match /postStats/{postId} {
      allow read, write: if false;

      match /countShards/{shard} {
        allow read, write: if false;
      }
    }

    // Agenda (bloco 6): os shows, pelas callables, com a seção artists.
    match /events/{eventId} {
      allow read: if canSeeContent();
      allow write: if false;
    }

    // Moderação (bloco 6): denúncias e a fila.
    match /commentReports/{reportId} {
      allow read: if canSeeSection('moderation');
      allow write: if false;
    }
    match /moderationQueue/{commentId} {
      allow read: if canSeeSection('moderation');
      allow write: if false;
    }

    // Listas de bloqueio: dizem quem bloqueou quem, e nenhuma tela do painel
    // as usa. Só o servidor (API e exclusão de conta). Repete o fechado do
    // match final de propósito, como o postStats.
    match /blockLists/{uid} {
      allow read, write: if false;
    }
```

O `canSeeContent()` entra junto do `canSeeSection` no topo do `firestore.rules`. A seção que publica (`artists`) é a mesma do `PANEL_CONTENT_SECTION` das funções e do `storage.rules` (21.1, decisão 1).

As regras de grupo alcançam qualquer coleção com o mesmo nome em qualquer profundidade, como a de `centrals` (19.10). Por isso os nomes são `postLikes`, `eventRsvps` e `postComments`, e os testes travam uma coleção de raiz com cada nome. O bloco `postStats` fechado repete o `match /{document=**}` de propósito, como o `artistStats`.

Acréscimo ao `storage.rules`, com a mesma `canEditSection('artists')` de hoje (mudou a regra da equipe no `firestore.rules`? mude a cópia lá):

```
    function validVideo() {
      return request.resource.size > 0
        && request.resource.size <= 50 * 1024 * 1024
        && request.resource.contentType == 'video/mp4';
    }

    function docExists(collection, id) {
      return firestore.exists(/databases/(default)/documents/$(collection)/$(id));
    }

    // O tipo do post decide o que entra: foto, só imagem; vídeo, imagem (a
    // capa e a miniatura) ou mp4; texto e show, nada. O get de um post que
    // não existe dá erro, e erro nega: vale pela conferência de existência,
    // com a mesma leitura do exists.
    function postAcceptsFile(postId) {
      let kind = firestore.get(/databases/(default)/documents/posts/$(postId)).data.get('kind', '');
      return (kind == 'photo' && validImage())
        || (kind == 'video' && (validImage() || validVideo()));
    }

    // Mídia dos posts: foto, miniatura, capa do vídeo e o mp4. Nome novo a
    // cada envio; só o servidor troca metadados e apaga.
    match /posts/{postId}/{fileName} {
      allow get: if true;
      allow list: if false;
      allow create: if resource == null
        && postId.matches('[A-Za-z0-9_-]{1,128}')
        && !postId.matches('__.*__')
        && canEditSection('artists')
        && postAcceptsFile(postId);
      allow update, delete: if false;
    }

    // Foto dos shows.
    match /events/{eventId}/{fileName} {
      allow get: if true;
      allow list: if false;
      allow create: if resource == null
        && eventId.matches('[A-Za-z0-9_-]{1,128}')
        && !eventId.matches('__.*__')
        && validImage()
        && canEditSection('artists')
        && docExists('events', eventId);
      allow update, delete: if false;
    }
```

O `artistExists` de hoje pode virar `docExists('artists', artistId)`, sem mudar o comportamento. O tipo conferido na regra fecha o mp4 num post de foto e a imagem num post de texto ou de show; o envio abandonado de um post de foto ou vídeo continua até o próximo `updatePost` (que limpa a pasta) ou o `deletePost` do rascunho. O papel IAM `roles/firebaserules.firestoreServiceAgent` do Storage já é preciso desde o bloco 4; nada novo.

Índices novos em `firestore.indexes.json` (os de hoje ficam):

```json
{
  "indexes": [
    {
      "collectionGroup": "posts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "artistId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "publishedAt", "order": "DESCENDING" },
        { "fieldPath": "__name__", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "posts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "artistId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "postComments",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" },
        { "fieldPath": "__name__", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "postComments",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "authorUid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "startsAt", "order": "ASCENDING" },
        { "fieldPath": "__name__", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "featured", "order": "ASCENDING" },
        { "fieldPath": "startsAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "artistIds", "arrayConfig": "CONTAINS" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "startsAt", "order": "ASCENDING" },
        { "fieldPath": "__name__", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "moderationQueue",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "lastReportedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "eventRsvps",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "eventId", "order": "ASCENDING" },
        { "fieldPath": "going", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": [
    {
      "collectionGroup": "postComments",
      "fieldPath": "authorUid",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "DESCENDING", "queryScope": "COLLECTION" },
        { "arrayConfig": "CONTAINS", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    },
    { "collectionGroup": "posts", "fieldPath": "text", "indexes": [] },
    { "collectionGroup": "posts", "fieldPath": "media", "indexes": [] },
    { "collectionGroup": "postComments", "fieldPath": "text", "indexes": [] },
    { "collectionGroup": "moderationQueue", "fieldPath": "commentText", "indexes": [] },
    { "collectionGroup": "moderationQueue", "fieldPath": "reasons", "indexes": [] },
    { "collectionGroup": "events", "fieldPath": "photo", "indexes": [] }
  ]
}
```

Para que serve cada um: o primeiro, ao mural (`in` com a ordem), à grade da 1d e ao `postCount`; o segundo, à lista de posts da central no painel (bloco 11); o terceiro, aos comentários do post; o quarto, aos comentários do próprio fã no detalhe; os três de `events`, à agenda, ao destaque e à agenda de uma central; o de `moderationQueue`, à fila do painel; o de `eventRsvps` em grupo, a quem vai a um show no painel (só as presenças ativas, 21.1 decisão 8). O `authorUid` em grupo serve à exclusão de conta. Os textos e mapas ficam sem índice, porque ninguém consulta por eles e cada gravação custa menos. Usam os índices automáticos: a consulta da exclusão por `reporterUid` em `commentReports`, a de `blocked` com `array-contains` em `blockLists`, a do `updateEvent` e do `deleteEvent` por `eventId` em `posts`, a do `/me/rsvps` por `updatedAt` na subcoleção do fã e as da seção Fãs por `liked` e `going` na subcoleção de um fã.

O emulador não exige índice nenhum: a falta só aparece em produção, como o código 9. O mural, a grade, os comentários e a agenda respondem 500 sem eles; o `postCount` vira 0 com log. Os índices sobem antes da `api` e terminam de montar antes de ela ir ao ar (21.17).

### 21.12 Exclusão de conta

`deleteUserData` (`functions/src/store.ts`), na ordem nova:

1. Reservas de @, como hoje.
2. `users/{uid}` sozinho, como hoje. Daqui em diante nenhuma gravação da API passa (`requireFan`).
3. `removeInviteData`, como hoje.
4. `leaveAllCentrals`, como hoje.
5. Novo: `removeFanEngagement(db, uid)`, em `posts/service.ts`, nesta ordem, cada passo em páginas de 100 (`ENGAGEMENT_DELETE_PAGE`) até a consulta voltar vazia (o que sai não volta na consulta seguinte, como no `deleteIdempotencyKeys`), uma transação por página que relê cada documento (o que já saiu não desconta de novo). Os `-1` de uma página são somados em memória por post, e cada post da página recebe uma gravação só, num shard sorteado. Assim a página de comentários grava no máximo 300 documentos (o comentário, o item da fila e um shard por post), abaixo do teto de 500 gravações por transação que o projeto adota (`IDEMPOTENCY_DELETE_BATCH`, `REORDER_MAX`); com páginas de 200, eram até 600, e o mesmo shard gravado mais de uma vez na transação.
   1. Curtidas: `users/{uid}/postLikes`; para cada uma que ainda existe, `tx.delete` e, se estava ativa (`liked: true`), `-1` em `likes` no shard do post.
   2. Comentários: `collectionGroup('postComments')` com `authorUid == uid`; para cada um que ainda existe, `tx.delete` e, se estava `visible`, `-1` em `comments` no shard do post. O item da fila desse comentário, se houver, perde o texto (`commentText: null`) e, aberto, vai a `resolved` com `author_deleted`. As denúncias contra ele ficam, sem o texto: são dado de quem denunciou.
   3. Denúncias que ele fez: `commentReports` com `reporterUid == uid`; para cada uma, `tx.delete` e, no item da fila, `reportCount` e o motivo menos 1, nunca abaixo de 0. O item que fica `open` com `reportCount` 0 vai a `resolved` com `withdrawn` (`resolvedAt` o "agora", `resolvedBy` nulo): sem isso, a fila mostraria um item aberto sem denúncia nenhuma. Uma denúncia nova o reabre (21.4).
   4. Bloqueios: apaga `blockLists/{uid}` e tira o uid dele das listas dos outros (`blockLists` com `blocked array-contains uid`, `update` com `arrayRemove`, em páginas).
6. `recursiveDelete(users/{uid})`, como hoje: leva as presenças (`eventRsvps`, ativas ou não), que não têm contador, e o que sobrou das curtidas.
7. `referrals/{uid}`, `detachReferrals`, carteira, chaves de idempotência e `staff/{uid}`, como hoje.

Por que nessa ordem: as curtidas saem antes do `recursiveDelete` porque precisam descontar o shard, como os vínculos do bloco 4. Uma curtida ou um comentário que já tinha lido o perfil segura a leitura e grava antes do passo 2 terminar, e a listagem do passo 5 o encontra. Os agregados do painel não descontam (seção 12). O `functions/src/store.test.ts` prende a ordem nova.

Curtidas e presenças desfeitas (`liked: false`, `going: false`) também saem: guardam só o que o fã fez, e nenhuma contagem depende delas.

Comentários: apagados, e não anonimizados (21.1, decisão 18, confirmada pelo dono em 05/10/2026). Se um dia a revisão jurídica pedir para anonimizar, o passo 5.2 troca o `tx.delete` por `authorUid: null`, `authorName: 'Fã'` e `authorPhotoURL: null`, sem mexer na contagem; o texto continuaria lá, e é por isso que a proposta é apagar.

### 21.13 App

**Seletor e consultas**

- `SERVER_DOMAINS` ganha `posts` e `agenda`, no commit que entrega as rotas. Com o emulador, o mural, os comentários, as curtidas, a agenda e as presenças vêm do servidor; nas builds, das fixtures, como hoje.
- `useFeedQuery`, `useArtistPostsQuery`, `usePostQuery` e `useCommentsQuery` espalham `queryOptionsFor('posts')`; a consulta da agenda (`agendaQueryOptions`, usada também pelo `useAgendaEvent`), `useArtistAgendaQuery`, `useMyRsvpsQuery` e `useIsGoing` (a mesma chave, com `select`) espalham `queryOptionsFor('agenda')`.
- `artists/api.ts` tira a troca do `postCount` pelo número de exemplo (19.13): com as centrais na API, os posts também estão. O `countArtistPostsFixture` sai, com o teste dele.
- O `QUERY_CACHE_VERSION` não sobe: os formatos salvos não mudam, e o `venue` é opcional.

**Mutações e invalidação**

- Curtir, comentar e "Eu vou" ficam como estão: otimismo, fila offline, `scope`, a mesma chave depois de falha incerta e o `refreshAfterPoints`, que já busca carteira, ranking e centrais quando rendeu.
- (Implementação, depois da revisão) Com pontos, o `refreshAfterPoints` (posts) e o `refreshPointsAfterRsvp` (agenda) buscam também `artistKeys.details()`: comentar paga na central do post (21.1, decisão 10) e o "Eu vou" numa central do show, e o "PTS DA CENTRAL" da 1d, que soma os pontos da central, ficava o de antes com a 1d montada embaixo do post.
- (Implementação, depois da revisão) Curtir e comentar recusados com `notFound` (o post ou a central saiu do ar) fazem o mural, a grade, o detalhe e o "N posts" buscarem de novo (`refreshAfterGonePost`: `postKeys.all` e `artistKeys.details()`), no hook e no `registerPostMutationDefaults`, no molde do `refreshAfterGoneEvent`. A tela do post mostra "Este post não existe mais." também com o detalhe no cache: o React Query guarda o `data` antigo quando a busca falha, e o detalhe e os comentários vão para o disco com a API (3 dias). Sem isso, o post que o fã já tinha aberto continuava na tela, e curtir e comentar nele erravam a cada toque.
- `useRsvpMutation` (e o `registerAgendaMutationDefaults`): recusa `notFound` (show fora do ar ou encerrado) faz a agenda e o mural buscarem de novo (`agendaKeys.events()` e `postKeys.all`, com o `postKeys` importado de `@/domains/posts/keys`, fora do index, pelo mesmo motivo de 19.13).
- `useReportCommentMutation(postId, commentId, { onDone?, onError? })` e `useBlockFanMutation(fanId, { onDone?, onError? })`, novos em `posts/queries.ts` e exportados pelo index, no molde do `useLeaveCentralMutation`: não são otimistas e não entram na fila (`networkMode: 'always'`, `retry: false`); a chave é a da tentativa (a mesma depois de falha incerta, nova depois de recusa); os retornos só rodam com o hook montado. Bloquear, no sucesso: tira os comentários do bloqueado de todo cache de comentários (`removeAuthorComments(client, fanId)`, novo em `posts/cache.ts`) e busca as listas de comentários de novo. Denunciar não muda cache nenhum.
- `posts/api.ts` ganha `reportComment({ postId, commentId, reason, idempotencyKey })` (`POST .../report`, com `{ reason }`) e `blockFan({ fanId, idempotencyKey })` (`PUT /me/blocks/<id>`), com as fixtures.

**Telas**

- **Linha do comentário (`CommentRow`):** nos comentários de outro fã (não "Você", não do artista, sem `status`), um botão de opções (ícone de três pontos, alvo de 44, rótulo "Opções do comentário de {{name}}") na ponta direita da linha, no alto, na altura do nome. Ele é irmão do pressável da linha, e não filho: a linha tem rótulo próprio, e um botão dentro dela sumiria para o leitor de tela (regra do workspace de pressáveis aninhados). Abre a sheet com `router.push({ pathname: '/comentario/[comentarioId]', params: { comentarioId: comment.id, post: postId } })`.
- **Sheet "Opções do comentário"**, provisória (UP-48): rota `src/app/comentario/[comentarioId].tsx`, só com o `export default` de `CommentOptionsSheetScreen`, de `@/domains/posts`. Entra na pilha raiz, no guard de quem já entrou, com as opções do `convidar` (`formSheet`, `fitToContents`, `sheetGrabberVisible`, `sheetCornerRadius: radii.sheet`, fundo `colors.surface`). Lê o comentário do cache de comentários do post (`useCachedComment(postId, commentId)`); sem ele (aberta a frio), fecha. Conteúdo fixo, para a altura não mudar: o título "Comentário de {{name}}" com o fechar; a seção Denunciar, com o texto curto, os motivos numa `ChipGroup` de escolha única ("Sem motivo", "Spam", "Ofensivo", "Assédio", "Outro"; "Sem motivo" manda `null`) e "Denunciar comentário" (`primary`); a seção Bloquear, com o texto ("Os comentários de {{name}} somem para você, neste e nos outros posts. {{name}} não fica sabendo.") e "Bloquear {{name}}" (`secondary`). Os dois botões ficam desligados sem internet e enquanto um pedido vai (`loading` no que foi tocado); o voltar fica preso (`useStayOnScreen`). Sucesso: fecha e anuncia ("Denúncia enviada. A equipe vai analisar." ou "Você bloqueou {{name}}. Os comentários somem para você."), com o toque `success`. Erro: fica, com o aviso acima dos botões, anunciado, e o toque `error`. A resposta que chega com a sheet fechada só anuncia.
- (Implementação) A sheet lê o comentário uma vez, na abertura (`useCachedComment`, com `findCachedComment` de `posts/cache.ts`), e o aviso de erro acima dos botões é o do último pedido que falhou (denunciar ou bloquear). A chave da denúncia é a mesma depois de falha incerta só com o mesmo motivo: com outro motivo, o servidor recusaria a chave antiga com 422.
- **Compositor do comentário:** o `commentSchema` passa a limpar e validar como o servidor (`cleanMultiline` e `isVisibleMultiline`, novos em `src/utils/visible-line.ts`, espelho de `functions/src/visible-line.ts`, com os mesmos passos de 21.1 decisão 20, inclusive o NFC e a troca do `\r`, e a mesma tabela de testes nos dois lados; o limite de 500 conta unidades de UTF-16 num `refine`, como o nome). Texto que tem só invisíveis, ou uma linha com eles, mostra o erro abaixo do campo ("Tire os caracteres invisíveis do comentário.", anunciado) em vez de não fazer nada, como hoje. O texto limpo é o que vai e o que a linha local mostra.
- **Lista de comentários:** quando a última página chega vazia e ainda há `nextCursor` (comentários seguidos de bloqueados, 21.2), a tela pede a seguinte sozinha, uma vez por página, com `cancelRefetch: false`.
- **Sheet "Sair da central":** o texto ganha "Os posts desta central saem do seu mural." (21.1, decisão 19).
- **Linha do mural (`PostRow`):** foto e vídeo podem vir sem legenda (21.9). O texto só entra quando existe (`post.text ? ... : null`, como na `PostContent`), e o rótulo do bloco sai sem ele (`post.blockLabelNoText`). A grade da 1d mostra a mídia, como antes; o rótulo da célula sem legenda sai sem o texto e sem os dois-pontos soltos (`artist.posts.photoLabelNoText` e `videoLabelNoText`, implementação depois da revisão).
- Fora isso, nada muda no mural, na grade, no detalhe nem na agenda: o formato das respostas é o que eles já leem (a mídia de foto e vídeo sem arquivo vem com as URLs nulas, como nas fixtures, 21.2).

**Fixtures**

- `buildFeedPageFixture` filtra pelas centrais do `followFixture.followedIds()`, importado direto de `@/domains/artists/fixtures` (o `artists/fixtures.ts` não importa `posts`, então não há ciclo).
- `moderationFixture`, em `posts/fixtures.ts`: denunciar guarda a resposta pela chave e devolve `already_reported` na segunda vez; bloquear guarda o autor, e `buildCommentsPageFixture` tira os comentários dele. Volta ao início com a sessão (`onFixtureSessionEnd`).
- Regra de coerência (seção 13): com os posts e a agenda na API, curtir, comentar e "Eu vou" rendem do servidor. **As missões continuam de exemplo até o bloco 7: a ação de verdade não anda missão nenhuma.** O `missionsFixture.record` só roda nos caminhos das fixtures; a "Curta 5 posts do Nenho" da 1g fica em 2 de 5 com o emulador, e nenhuma curtida de verdade sobe o "+N" de missão. As missões continuam buscando de novo depois de cada ação, sem efeito. O servidor já guarda o que o bloco 7 vai contar: a primeira curtida de cada post e a primeira presença de cada show (21.5). Desde o bloco 7 isso mudou: as missões e as conquistas vêm do servidor, toda ação de verdade anda as missões que casam, e as missões só buscam de novo quando a resposta diz que alguma andou (22.12, que vale no lugar desta parte).

**O que é de verdade e o que é de exemplo** (desenvolvimento com emulador, do bloco 6 ao 7)

| Número ou lista                            | Telas             | Fonte no bloco 6               |
| ------------------------------------------ | ----------------- | ------------------------------ |
| Mural, grade e detalhe dos posts           | 1b, 1d, post      | servidor                       |
| Curtidas e comentários (contagens e lista) | 1b, 1d, post      | servidor (cópia de 10 a 20 s)  |
| "N posts" da central                       | 1d                | servidor (`count()`)           |
| Agenda, destaque e agenda da central       | 1m, 1d            | servidor                       |
| "Eu vou"                                   | 1b, 1m, 1d, post  | servidor                       |
| Pontos de curtir, comentar e "Eu vou"      | carteira (1e, 1h) | servidor                       |
| Denunciar e bloquear                       | post              | servidor                       |
| Progresso das missões                      | 1g, 1b, 1d        | exemplo, até o bloco 7 (22.12) |
| Ranking e top fãs                          | 1f, 1d            | exemplo, com o aviso, até o 8  |

**Textos novos** (`translations.json`)

- `post.blockLabelNoText`: "{{author}}, {{time}}."
- `artist.posts.photoLabelNoText`: "Post de {{name}}, {{time}}"; `artist.posts.videoLabelNoText`: "Vídeo de {{name}}, {{time}}" (implementação)
- `post.comments.optionsLabel`: "Opções do comentário de {{name}}"
- `post.moderation.title`: "Comentário de {{name}}"
- `post.moderation.reportSection`: "Denunciar"; `post.moderation.reportBody`: "A equipe do ImagineUP analisa cada denúncia. O motivo é opcional."
- `post.moderation.reasons.none`: "Sem motivo"; `.spam`: "Spam"; `.offensive`: "Ofensivo"; `.harassment`: "Assédio"; `.other`: "Outro"
- `post.moderation.report`: "Denunciar comentário"; `post.moderation.reported`: "Denúncia enviada. A equipe vai analisar."; `post.moderation.reportError`: "Não deu para enviar a denúncia. Tente de novo."
- `post.moderation.blockSection`: "Bloquear"; `post.moderation.blockBody`: o texto da sheet, acima; `post.moderation.block`: "Bloquear {{name}}"; `post.moderation.blocked`: (implementação) "Bloqueio feito: os comentários de {{name}} somem para você." (o texto do desenho, "Você bloqueou {{name}}. Os comentários...", saía com dois pontos seguidos para nomes que terminam em ponto, como "Thalita S."); `post.moderation.blockedShort` (implementação): "Bloqueio feito. Os comentários somem para você.", o anúncio quando a resposta chega com a sheet já fechada; `post.moderation.blockError`: "Não deu para bloquear. Tente de novo."
- `validation.commentInvisible`: "Tire os caracteres invisíveis do comentário."
- `artist.leave.body`: o texto de hoje mais "Os posts desta central saem do seu mural."

**`CLAUDE.md` e `AGENTS.md`**

No mesmo commit: Estrutura (`functions/src/posts`, `agenda`, `moderation` e `staff/panel-actor.ts`; a rota `comentario/[comentarioId]`), Navegação (a sheet de opções do comentário), Dados (posts e agenda no seletor; missões que não andam com ação de verdade; o mural de exemplo filtrado), Acessibilidade (o botão de opções irmão da linha), Artistas e centrais (`has-content`), API do app e pontos (as rotas e as callables do bloco 6) e Pendências (moderação provisória, desbloquear sem tela, perguntas de 21.16). O `AGENTS.md` recebe a mesma cópia, com o cabeçalho dele.

Nada disso entra no fingerprint da EAS: só JavaScript, regras e funções. A rota nova é um arquivo JavaScript.

### 21.14 Seed dos emuladores

`functions/src/agenda/seed.ts` exporta `SEED_EVENTS` e `seedEvents(db, now)`; `functions/src/posts/seed.ts` exporta `SEED_POSTS`, `SEED_ENGAGEMENT`, `seedPosts(db, now)` e `seedEngagement(db, fans, now)`. O `scripts/seed-emulators.mjs` carrega `functions/lib/agenda` e `functions/lib/posts` como já carrega os outros, nesta ordem: centrais, shows, posts, contas (com a carteira, as centrais e o convite da Camila: o link `post:p-clipe` agora exige o post no ar, por isso os posts vêm antes), claims, e por último o engajamento dos fãs de teste.

Shows, os mesmos da `buildAgendaEventsFixture`, com os mesmos ids e a mesma regra de datas, na hora local do lugar, todos no ar:

| id                      | Título                | Artistas                      | Cidade, UF               | Fuso             | Quando (hora local)                 | Destaque |
| ----------------------- | --------------------- | ----------------------------- | ------------------------ | ---------------- | ----------------------------------- | -------- |
| `arrocha-na-praia`      | Arrocha na Praia      | `nenho`                       | Aracaju, SE              | `America/Maceio` | o sábado seguinte, 22 h             | não      |
| `sao-joao-irara`        | São João de Irará     | `nettobrito`, `nenho`         | Irará, BA                | `America/Bahia`  | dia 21 do mês seguinte, 22 h        | sim      |
| `pra-encher-e-derramar` | Pra Encher e Derramar | `nettobrito`                  | Feira de Santana, BA     | `America/Bahia`  | dia 28 do mês seguinte, 21 h        | não      |
| `festa-do-vaqueiro`     | Festa do Vaqueiro     | `juninhomoraes`               | Serrinha, BA             | `America/Bahia`  | dia 12, dois meses à frente, 20 h   | não      |
| `vaquejada-de-serrinha` | Vaquejada de Serrinha | `rocksalles`                  | Serrinha, BA             | `America/Bahia`  | dia 2, três meses à frente, 22 h    | não      |
| `arrocha-do-nenho`      | Arrocha do Nenho      | `nenho`                       | Salvador, BA             | `America/Bahia`  | dia 16, três meses à frente, 22 h   | não      |
| `verao-arrochado`       | Verão Arrochado       | `nettobrito`                  | Salvador, BA             | `America/Bahia`  | dia 10, quatro meses à frente, 21 h | não      |
| `festival-do-sertao`    | Festival do Sertão    | `juninhomoraes`, `rocksalles` | Vitória da Conquista, BA | `America/Bahia`  | dia 24, quatro meses à frente, 20 h | não      |
| `carnaval-do-nenho`     | Carnaval do Nenho     | `nenho`                       | Recife, PE               | `America/Recife` | dia 13, cinco meses à frente, 22 h  | não      |

Mais um rascunho, `show-rascunho` (Netto), que o app não mostra. Sem foto e sem local, como nas fixtures.

Posts, os 10 de `posts/fixtures.ts`, com os mesmos ids, tipos, centrais e textos, e o `publishedAt` no mesmo "há N horas" de hoje (o clipe há 2 h, o show há 5 h, e assim por diante). O `p-show` aponta para `arrocha-na-praia`. Fotos e vídeos são publicados sem mídia (o placeholder da marca, como as centrais do seed sem foto), e a resposta manda `{ url: null, thumbnailUrl: null, width, height }` com as medidas padrão, como as fixtures (21.2): o clipe aparece com a miniatura e a marca de vídeo na 1b e com o play na grade da 1d. O seed usa o mesmo núcleo das callables, sem a conferência de mídia e sem auditoria. Mais um rascunho, `p-rascunho` (Netto, texto), que o app não mostra.

Engajamento dos fãs de teste, pelos mesmos núcleos das rotas (`runLikePost`, `runComment`, `runRsvp` e `runReport`), com `actor` de sistema e `SEED_ENGAGEMENT_CONFIG` (em `posts/seed.ts`): o `DEFAULT_POINTS_CONFIG` com `like`, `comment` e `rsvp` em 0, como o `SEED_INVITE_CONFIG` do bloco 5 e o `central_join: 0` do bloco 4. O padrão sozinho não serve: nele `comment` vale 2, e os comentários do seed pagariam e criariam a carteira do Alan. Com os três em 0, nenhuma carteira muda (a Camila fica a do protótipo, e o Alan continua sem carteira), e o sistema não conta nos tetos.

- Curtidas: Bia, Duda e Enzo no `p-clipe`; Bia e Enzo no `p-show`; Alan no `p-g1`; Duda no `p-nenho-2`.
- Comentários, com ids fixos:
  - `seed-c-clipe-bia` (Bia, `p-clipe`, há 60 min): "Já mandei pro grupo da família inteira, Irará em peso! 💃"
  - `seed-c-clipe-duda` (Duda, há 66 min): "Esse clipe ficou lindo demais. Já vi umas dez vezes."
  - `seed-c-clipe-enzo` (Enzo, há 73 min): "Irará nunca mais vai ser a mesma depois desse São João."
  - `seed-c-clipe-alan` (Alan, há 95 min): "Que música boa demais!"
  - `seed-c-show-bia` (Bia, `p-show`, há 2 h): "Chama que a Bahia vai em peso!"
  - `seed-c-show-enzo` (Enzo, `p-show`, há 3 h): "Promoção de ingresso no meu perfil, chama no privado!!!"
  - `seed-c-texto-duda` (Duda, `p-texto`, há 20 h): "Aposto em Sonho de Verão!"
- Presenças: Bia no `arrocha-na-praia`; Duda no `sao-joao-irara`.
- Denúncia: Alan denuncia `seed-c-show-enzo` como `spam`. A fila da Moderação nasce com um item aberto.
- A Camila não curte, não comenta e não vai a show nenhum, como o estado inicial das fixtures: com ela, a primeira ação no app mostra os pontos do servidor (comentar rende 2).
- A fila copia as contagens em segundos: o clipe fica com 3 curtidas e 4 comentários, e o show com 2 e 2. Os 4.812 e 327 do protótipo ficam só nas fixtures (contagem sem os comentários na lista seria incoerente).
- Rodar de novo não muda nada: shows, posts, curtidas, presenças, comentários (ids fixos, lidos antes de gravar pelo `runComment`, 21.4) e a denúncia já existem, e cada núcleo devolve sem efeito.

### 21.15 Testes

Funções, testes puros (`vitest`, relógio fixo):

- `visible-line.test.ts`: `cleanMultiline` e `isVisibleMultiline` (linhas vazias seguidas, pontas, isolantes bidi, NFC com o acento decomposto, `\r\n` e `\r` sozinho virando `\n` e não `invisible`, invisível no meio, emoji com ZWJ, 500 e 501 em UTF-16), na mesma tabela do teste do app.
- `posts/model.test.ts` (tabela): `parseCommentText` (os três motivos); a visão do `Post` (cada tipo; foto e vídeo sem mídia gravada saem com `url` e `thumbnailUrl` nulas e as medidas padrão, 1080x1350 e 1920x1080, e texto e show com `media: null`; vídeo sem o mp4; show fora do ar ou encerrado vira `event: null`; `likedByMe` falso com `liked: false`; `sharePointsPerVisit` nulo com o valor 0); `viewCounts` (sem `countsAt` soma, curtida antes da cópia não soma, curtida desfeita não soma, comentários do fã depois da cópia somam só no detalhe); cursores (ida e volta, malformado, instante acima do maior `Timestamp`); a junção dos blocos do mural (ordem e `nextCursor`, com blocos desiguais); a validação das callables (texto de 1 a 2.000 no texto e no show, de 0 a 2.000 na foto e no vídeo, tipo, show do post, caminhos da mídia na pasta do post); `windowTask` (o mesmo resultado do `fanCountSyncTask` de antes).
- `agenda/model.test.ts`: `zonedLocalToUtc` em `America/Bahia`, `America/Recife`, `America/Manaus` e `America/Noronha`, e a data que não existe; `agendaCutoff` e `isEventOpen` nas pontas (show de 23 h aberto às 23:59 e encerrado à 0:00 de São Paulo, o de 0:30 de hoje aberto às 0:31); a escolha do destaque (o mais próximo depois do corte, empate pelo id; o destaque de ontem às 22 h não volta à 1:00 de hoje); a central que paga a presença (a primeira no ar do show, nenhuma quando todas estão fora); a visão do show (só centrais no ar, `invitePointsPerSignup` nulo com 0); `DEFAULT_TIME_ZONE_BY_STATE` cobre as 27 UFs; a validação das callables.
- `moderation/model.test.ts`: os motivos, os tetos com o `Retry-After`, o filtro dos bloqueados, o limite da lista.
- `points/stats.test.ts` e `points/award.test.ts`: os fluxos novos, o `pruneZeros` deles e o `addEngagementCounts` com o `plan.shard` nulo; as chaves novas do `addDailyCount`.
- `api/router.test.ts`: `/posts/:postId`, `/posts/:postId/comments`, `/posts/:postId/like` e `/posts/:postId/comments/:commentId/report` não se confundem; `GET /posts/x/like` é 405 com `Allow: PUT, DELETE`; `/artists/:artistId` e `/artists/:artistId/posts` não se confundem; `GET /me/blocks/x` é 405.
- `api/index.test.ts`: os códigos novos com status e corpo; `PostError`, `AgendaError` e `ModerationError` traduzidos; o 429 dos tetos com `Retry-After`; `limit` e cursor inválidos dão 400; ids fora do formato dão o 404 de cada recurso.
- `posts/sync.test.ts`: o gatilho ignora o id repetido, lança nos outros erros, enfileira sem id no emulador.
- `store.test.ts`: a ordem nova do `deleteUserData`.

Funções nos emuladores (a `api` de verdade por HTTP, tokens do emulador de Auth; o gatilho e a fila no emulador, com espera de até 10 s pela cópia):

- `functions/test/posts.emulator.test.ts`: mural só das centrais do fã, na ordem, paginado de 2 em 2 e com mais de 30 centrais (dois blocos do `in`); post de central fora do ar e rascunho não aparecem; detalhe 404 nos dois; curtir paga pelo `like:<postId>` com o valor injetado, a mesma chave devolve a resposta guardada, curtir de novo depois de descurtir não paga, descurtir não tira; descurtir deixa o documento com `liked: false` e o `firstLikedAt` da primeira, e curtir de novo o mantém; o shard e o contador do teto só mexem na troca de estado; a fila copia `likeCount`, e antes da cópia o detalhe já conta a curtida de quem chama; comentar grava com o nome do perfil, paga 2, passa do limite do dia sem pagar, recusa os três textos inválidos sem gravar a chave; os comentários do bloqueado somem da lista de quem bloqueou e não da dos outros, com páginas que atravessam vários bloqueados; 10 fãs curtindo o mesmo post em paralelo deixam 10; o teto de curtidas dá 429 e descurtir passa; o `postCount` do `GET /artists/:id`; o link `post:<id>` só nasce com o post no ar. (Implementação, depois da revisão) A cópia lida entre o começo do pedido e o commit (o `countsAt` gravado entre o `award.now` e o commit, sem as ações) não esconde a curtida nem o comentário de quem chama no detalhe; comentar soma 1 no `comment_sent` e a repetição da chave não; com o contador no teto, 429 com `details.action` e `Retry-After`, sem gravar o comentário nem a chave.
- `functions/test/agenda.emulator.test.ts`: agenda em ordem, com o corte do começo do dia de São Paulo (relógio fixo perto da meia-noite: o show de ontem às 22 h sai da lista, do destaque, do `event` do post e do "Eu vou" à 0:00), o destaque mais próximo, a agenda de uma central sem destaque e 404 da central fora do ar; "Eu vou" paga uma vez por show, desfazer não tira, desfazer deixa `going: false` com o `firstGoingAt`, show encerrado e fora do ar dão 404 com o motivo, desfazer vale em qualquer status; show com a primeira central em rascunho paga na segunda, no ar, e não soma agregado na de rascunho; `/me/rsvps` só com shows abertos e presenças ativas, e com mais de 100 presenças ainda traz a de um show distante confirmada primeiro; o post de show monta o `event` e o perde quando o show sai do ar. (Implementação, depois da revisão) O "Eu vou" soma 1 no `rsvp_set` e o já confirmado não; com o contador no teto, 429 com `details.action` e `Retry-After`, sem gravar a presença nem a chave, e desfazer passa.
- `functions/test/moderation.emulator.test.ts`: denunciar cria a denúncia e o item da fila, a segunda do mesmo fã é `already_reported`, de outro fã soma no item, o próprio comentário é 400, comentário oculto é 404; `keep` resolve e uma denúncia nova reabre; `keep` em comentário oculto recusa com `comment-hidden`; `hide` tira o comentário da lista e da contagem, `restore` devolve; bloquear e desbloquear, o próprio uid é 400, fã que não existe é 404, a lista cheia é 409. (Implementação, depois da revisão) Denunciar soma 1 no `comment_report` e o `already_reported` não, bloquear soma 1 no `fan_block` e o já bloqueado não; com cada contador no teto, 429 com `details.action` e `Retry-After`, sem gravar a denúncia, o item da fila, a lista nem a chave, e desbloquear passa. Sem esses testes, tirar o `enforceDailyCap` ou o `countDailyAction` de uma rota (ou passar a ação errada) deixava as suítes verdes.
- (Implementação) Os quatro arquivos de emulador do bloco dividem `functions/test/support.ts` (o app do Admin SDK, a conferência das funções carregadas, a limpeza, o fã que se cadastra, a `api` pelo HTTP, o handler no processo com o relógio fixo e as callables como o painel chama). A exclusão e o seed ficam em `posts.emulator.test.ts`. O `invites.emulator.test.ts` do bloco 5 passou a publicar os posts antes dos links `post:<id>` e confere que post em rascunho, de central fora do ar ou que não existe não vira link.
- `functions/test/content-panel.emulator.test.ts`: as callables de post e de show com os membros de exemplo (admin, editora com `artists`, leitor, sem a seção, desativada); a mídia conferida no Storage do emulador, com a pasta limpa depois da troca; foto e vídeo sem legenda aceitos, texto vazio recusado no post de texto; publicar sem mídia e o post de show com o show fora do ar recusam; o fuso grava o instante certo; `updateEvent` que tira a central de um post do show recusa com `event-has-posts`, e o que tira outra central passa, também com 21 posts no show e o da central que sai depois do 20º (implementação, depois da revisão); `deletePost` e `deleteEvent` apagam o rascunho nunca publicado (com a pasta) e recusam o que já foi ao ar (`was-published`) e o show com post (`event-has-posts`); cada mudança grava uma auditoria e nada mudou não grava; `moderateComment` com a seção `moderation`; o `deleteArtist` recusa `has-content` e passa depois de apagar o rascunho que prendia a central, e os testes de `artists.emulator.test.ts` continuam passando sem mudança.
- Exclusão: fã com curtidas (uma desfeita), comentários (um denunciado, e vários no mesmo post numa página só), presenças, denúncias feitas (uma única num item, outra num item com mais denúncias) e bloqueios, e bloqueado por outro; depois do `deleteUserData`, as contagens caem só pelo que estava ativo e não ficam negativas, o item da fila do comentário dele fica sem o texto e resolvido, o item que só tinha a denúncia dele fica `resolved` com `withdrawn`, o outro perde a denúncia e continua aberto, as listas dos outros não têm mais o uid; rodar de novo não desconta outra vez; comentar depois de o perfil sair dá 503.
- Seed: os shows, os posts e o engajamento como em 21.14; as carteiras sem mudar (a Camila a do protótipo, o Alan, a Bia, a Duda e o Enzo sem lançamento de curtir, comentar ou "Eu vou", e o Alan sem carteira); a fila com um item; o clipe com a mídia de URLs nulas e as medidas padrão; rodar de novo não muda nada nem lança erro.

Regras (`tests/`, no molde de `tests/centrals-rules.test.ts`, com os mesmos membros de exemplo):

- `tests/posts-rules.test.ts`: `posts` e `postComments` (inclusive pelo grupo): o fã não lê nem o post no ar; a equipe com `artists` lê os dois; `posts` também com `moderation` ou `fans`, e `postComments` também com `moderation` (e não com `fans`); sem nenhuma dessas seções, desativada, pendente ou com sessão de antes do `authValidAfter`, não lê; ninguém grava, nem admin. `postStats` e `countShards`: ninguém. `users/{uid}/postLikes` e `eventRsvps` (e os grupos): o próprio fã não lê; a equipe com `fans` lê. Uma coleção de raiz chamada `postLikes`, `eventRsvps` ou `postComments` cai na regra de grupo (o teste deixa escrito por que nenhuma outra pode ter esses nomes).
- `tests/agenda-rules.test.ts`: `events`, com a seção `artists`, `moderation` ou `fans`; sem elas, não lê; ninguém grava.
- `tests/moderation-rules.test.ts`: `commentReports` e `moderationQueue`, só com `moderation`; `blockLists`, ninguém, nem admin nem a equipe com `moderation`, e o fã não lê nem a própria lista.
- `tests/storage-rules.test.ts`: `posts/{id}/` aceita de quem edita `artists`, só para post que existe e com nome novo, imagem até 5 MB na foto, imagem ou mp4 até 50 MB no vídeo, e nada no texto e no show; recusa mp4 na foto, imagem no texto e no show, leitor, outra seção, tipo errado, tamanho acima e post que não existe. `events/{id}/` aceita imagem até 5 MB de quem edita `artists`, só para show que existe. Ninguém lista, troca nem apaga.
- Os arquivos de teste que já existem passam sem mudança.

App:

- `src/config/__tests__/data-source.test.ts`: `posts` e `agenda` na API com o emulador.
- `src/utils/__tests__/visible-line.test.ts`: a mesma tabela do servidor para o texto de várias linhas.
- `posts/__tests__/api.test.ts`: as rotas no modo API (caminhos, `Idempotency-Key`, corpo do comentário e da denúncia, o bloqueio); nas fixtures, a denúncia repetida e o bloqueio que some com os comentários.
- `posts/__tests__/queries.test.tsx` (implementação): `useFeedQuery`, `useArtistPostsQuery`, `usePostQuery` e `useCommentsQuery` esperam a rede e vão para o disco com a API (`networkMode: 'online'`, `meta: { realData: true }`, pausadas sem rede) e, nas fixtures, rodam sem rede e ficam fora do disco. `posts/__tests__/moderation-queries.test.tsx`: bloquear tira os comentários do autor de todo cache só no sucesso; denunciar e bloquear com a mesma chave depois de falha incerta e nova depois de recusa; o retorno com o hook desmontado só avisa.
- `posts/__tests__/post-cards.test.tsx` e o teste da linha: o botão de opções só no comentário de outro fã, irmão da linha, com o rótulo; nada no "Você", no do artista e no "enviando". A `PostRow` de foto sem legenda mostra a miniatura e o rótulo sem o texto; a de vídeo com a mídia de URLs nulas mostra a miniatura com a marca de vídeo.
- `posts/__tests__/fixtures.test.ts`: o mural filtrado pelas centrais seguidas; sair do Netto tira os posts dele.
- O compositor: texto só de invisíveis mostra o erro e não envia; o texto limpo é o que vai.
- `agenda/__tests__/rsvp.test.tsx`: `useAgendaQuery`, `useArtistAgendaQuery`, `useMyRsvpsQuery` e `useIsGoing` com a API e nas fixtures, como as do mural; recusa `notFound` busca a agenda e o mural de novo; a presença com pontos busca também o detalhe da central (e a sem pontos não).
- `posts/__tests__/post-details.test.tsx` (implementação, depois da revisão): o post com o detalhe no cache e a busca que volta 404 mostra "Este post não existe mais.", sem o campo, anunciado uma vez; curtir com 404 desfaz e invalida o mural (`postKeys.all`) e os detalhes das centrais; a curtida da fila recusada com 404 também; comentar com 404 leva ao aviso; o comentário com pontos busca também `artistKeys.details()`.
- `artist-page/__tests__/describe.test.ts`: a célula de foto e de vídeo sem legenda é lida sem o texto e sem os dois-pontos.
- `artists/__tests__/api.test.ts`: sem a troca do `postCount`.
- Navegação (`src/navigation/__tests__/post.test.tsx`): o botão abre a sheet; "Denunciar comentário" fecha e anuncia; "Bloquear" fecha e o comentário some da lista; sem internet os dois ficam desligados; a sheet aberta a frio fecha.
- `artist-page`: a sheet de sair com a frase do mural.

### 21.16 Perguntas

Para a cliente (UP-48, UP-45 e UP-9):

1. Moderação: os motivos da denúncia (proposta: spam, ofensivo, assédio, outro, e o motivo opcional); ocultar sozinho com N denúncias (proposta: não agora; a equipe olha a fila todo dia, e a App Store pede agir em até 24 h); quem da equipe cuida (a seção Moderação); o texto dos termos de uso sobre conteúdo (as lojas pedem termos que proíbam conteúdo ofensivo, com a revisão jurídica, UP-45).
2. Comentários de quem exclui a conta: decidido pelo dono em 05/10/2026, são apagados. O texto de um comentário denunciado sai junto, e a fila fica com os ids. A revisão jurídica (UP-45) só confere se os termos dizem isso.
3. Valores de curtir, comentar e "Eu vou" (hoje 0, 2 e 0, provisórios, UP-9). O contrato diz que toda interação vale pontos.
4. Hora do show no fuso do lugar ou do aparelho (proposta: do aparelho, como hoje; só muda para quem está fora do UTC-3).
5. Local do show: mostrar no app (proposta: guardar agora e mostrar no destaque da 1m quando o design passar por ele).

Para o dono:

6. Vídeo: guardar o mp4 (até 50 MB, opcional) ou só a capa. Proposta: guardar, para quando o app tocar vídeo (pede `expo-video` e build nova, fora deste bloco).
7. Mural só das centrais do fã (proposta) ou todas as centrais quando o fã não segue nenhuma.
8. Tela "Fãs bloqueados" nos Ajustes, para desbloquear (proposta: num bloco seguinte, com `GET /me/blocks`; a rota de desbloquear já existe).
9. Resposta do artista nos comentários, publicada pela equipe no painel (`authorIsArtist`, o selo de verificado na linha). Fora deste bloco; o campo já existe no contrato.
10. `deleteArtist` recusando central com post ou show (`has-content`), a mudança de comportamento numa callable de hoje (21.1, decisão 23), com `deletePost` e `deleteEvent` só para o rascunho que nunca foi ao ar, liberados ao editor com `artists` (proposta).
11. Quantos vão a cada show no painel (um `goingCount` em shards, como as contagens dos posts). Proposta: só se a equipe pedir; os fluxos por dia já mostram as presenças.
12. Para o bloco 8: o ponto de curtir, comentar e "Eu vou" numa central da qual o fã não é membro entra em `centralPoints` dela (21.1, decisão 10), e por isso no ranking da central. Proposta: contar (o fã engajou com o artista), e o ranking da central decidir no bloco 8 se mostra só membros.

### 21.17 Fora deste bloco e publicação

- **Fora deste bloco (só documentado):** as telas do painel (Mural e Agenda dentro de Artistas, a fila da Moderação, os rótulos das ações novas na auditoria), bloco 11; a tela de desbloquear; tocar vídeo; a resposta do artista; ocultar por número de denúncias; o `goingCount`; o detalhe de um show (`GET /events/:eventId`), quando houver a tela; a moderação de outro conteúdo de usuário (o app não tem outro).
- **Publicação**, só com o ok do dono, nesta ordem: regras e índices (`deploy --only firestore:rules,firestore:indexes`); esperar os índices novos ficarem prontos no console (são nove compostos; sem eles, o mural, a grade, os comentários e a agenda respondem 500, e a seção Fãs não lista quem vai a um show); as regras do Storage (`npm run rules:deploy` já leva; o papel IAM do bloco 4 serve); depois todas as funções (`npm run functions:deploy`), que levam a `api` com as rotas novas, o gatilho `queuePostCountSync` e a fila `syncPostCounts` novos, as nove callables novas (`createPost`, `updatePost`, `setPostStatus`, `deletePost`, `createEvent`, `updateEvent`, `setEventStatus`, `deleteEvent` e `moderateComment`), o `deleteArtist` com o `has-content` e o `deleteUserData` novo, usado pela `deleteUserProfile` e pela `createUserProfile`. A fila nova usa a mesma conta de serviço e os mesmos papéis da fila do bloco 4 (19.6). O `EXPO_PUBLIC_API_URL` segue a regra da seção 13: só depois do bloco 10.

### 21.18 Armadilhas do bloco 6

- `likeCount` e `commentCount` de `posts/{id}` são cópias: ficam uns 10 a 20 s atrás. A leitura soma a curtida e os comentários de quem chama que a cópia ainda não viu; nunca grave a contagem direto no post.
- A tarefa copia mesmo com os números iguais quando a leitura é mais nova: o `countsAt` precisa passar o `countedAt` da curtida de quem curtiu, senão a correção soma 1 a mais para sempre.
- A correção para quem chama compara o `countsAt` (o `readTime` dos shards) com o `countedAt` (o `serverTimestamp` do commit), nunca com o `award.now`: o "agora" do pedido é anterior ao commit, e a cópia que lê os shards no meio fica sem a ação e com o `countsAt` depois dele. O `updatedAt` e o `createdAt` continuam o `award.now`, para a ordem, o cursor e o bloco 7.
- O mural usa `in` em blocos de 30 centrais e junta os blocos na mesma ordem; o cursor é `[publishedAt, id]`, e cada bloco busca `limit + 1`.
- Post visível é post no ar de central no ar. A central fora do ar esconde os posts dela no mural, na grade e no detalhe, mesmo publicados.
- `publishedAt` é da primeira publicação e não muda: é a ordem do mural e o "há N horas" do app.
- O "Eu vou" do post de show e o da agenda são a mesma presença; show fora do ar ou encerrado volta `event: null` no post, e o `PUT` recusa com 404.
- "Já passou" tem um corte só no servidor, o começo do dia de hoje em São Paulo (`agendaCutoff`), na lista, no destaque, no `event` do post, no "Eu vou" e no `/me/rsvps`: é a regra do `isUpcoming` do app. Um corte de 24 h no destaque mandava um show que o app já descarta, e o topo caía no próximo show, e não no próximo destaque.
- Curtida e presença não somem no desfazer: ficam com `liked: false` ou `going: false`. Toda leitura confere o estado, e o shard, os fluxos e o teto só mexem na troca. O bloco 7 conta a troca de estado, um alvo por missão e período (22.1, decisão 4).
- Foto e vídeo sem mídia respondem `media` com as URLs nulas e as medidas padrão, nunca `null`: o app decide a miniatura pela presença de `media`.
- O "Eu vou" lê as centrais do show na transação e paga e soma só nas que estão no ar.
- Nomes de subcoleção específicos (`postLikes`, `eventRsvps`, `postComments`): as regras de grupo valem para qualquer coleção com o mesmo nome.
- O texto do comentário é limpo antes de validar, nos dois lados, e o limite conta UTF-16, como o `maxLength` do campo. Mudou a regra num lado, mude no outro e a tabela dos dois testes.
- Nome e foto do comentário são cópias: não seguem a renomeação do fã.
- Bloquear esconde só para quem bloqueou, e a contagem do post continua a de todos.
- A denúncia não esconde nada; ocultar é da equipe, pela callable. Ocultar e reexibir mexem na contagem pelo shard.
- Os tetos do dia contam na carteira (`days[dia].count`), que passa a ser gravada em toda curtida, comentário, presença, denúncia e bloqueio novos. Desfazer nunca é recusado.
- Na exclusão, as curtidas e os comentários saem antes do `recursiveDelete`, porque descontam o shard; as presenças, sem contador, saem com ele. Páginas de 100 e uma gravação de shard por post e transação, para ficar abaixo de 500 gravações.
- O seed publica foto e vídeo sem mídia; o painel não consegue (`missing-media`). O seed usa o `SEED_ENGAGEMENT_CONFIG`, com curtir, comentar e "Eu vou" em 0: o padrão paga 2 por comentário.
- `has-content` conta também o rascunho: a equipe apaga o que nunca foi ao ar (`deletePost`, `deleteEvent`) antes de apagar a central. O `updateEvent` não tira a central de um post que aponta para o show (`event-has-posts`), e procura só os posts das centrais que saem (`artistId in`): o `limit` sem esse filtro deixava passar o post do 21º em diante.
- `blockLists` é só do servidor, nem a equipe lê.
- O emulador não exige índice: a falta só aparece em produção, como código 9. Índices antes da `api`.
- Callback passado ao `useMutation` roda com a tela desmontada: a sheet de opções confere se está montada antes de navegar.

## 22. Bloco 7: missões, níveis, conquistas e extrato

O servidor passa a decidir as missões, o progresso de cada fã, as conquistas e a subida de nível, e o app ganha a tela do extrato de pontos. Esta seção é o contrato do bloco 7: rotas, coleções e campos, transações, idempotência, conquistas, nível e meta da temporada, callables do painel, regras, efeitos no painel, exclusão de conta, mudanças no app, seed e testes. Ela segue os padrões dos blocos 1, 4, 5 e 6 (seções 1 a 21) e só diz o que muda ou acrescenta.

Origem: o levantamento de 05/10/2026 (bloco 7), a cláusula 2.4 do contrato (régua de pontos e missões configuráveis no painel), a UP-21 e a UP-22 (missões e conquistas), a UP-28 (home com dados reais), a UP-34 (seção Missões e régua do painel; as telas são do bloco 11) e o pedido do dono de 05/10/2026. Missões, valores e conquistas são provisórios até a cliente responder (UP-9). A missão relâmpago fica de fora (pergunta da UP-48). A build sem emulador continua nas fixtures, e o `EXPO_PUBLIC_API_URL` segue a regra da seção 13.

Estado: desenho de 05/10/2026, revisto em 06/10/2026 depois de uma revisão adversarial conferida no código; feito em 06/10/2026, sem deploy (as funções, as regras e os índices esperam o ok do dono, 22.16). O que o código fez diferente do desenho, e por quê, está em 22.18.

Como era antes do bloco: as missões (1g, a missão do dia da 1b, a aba Missões da 1d) e as conquistas da 1e moravam nas fixtures (`src/domains/missions/fixtures.ts` e `buildMyAchievementsFixture`), e `GET /missions`, `GET /missions/daily` e `GET /me/achievements` não tinham quem respondesse. Com o emulador, curtir, comentar, "Eu vou", entrar numa central e os convites rendiam pontos no servidor, mas não andavam missão nenhuma (21.13). A régua só existia como padrão do código: as callables `updatePointsConfig` e `updateSeason` da seção 9 não foram feitas. O `GET /me/ledger` existia, sem tela.

### 22.1 Decisões

Cada item traz a recomendação e o motivo. As perguntas para a cliente e para o dono estão em 22.15, e o código já nasce com o padrão daqui, fácil de trocar.

1. **Catálogo de missões num documento versionado, `config/missions`, lido pelo cache de 60 s.** O mesmo `createConfigSource` da seção 9 passa a ler `config/points`, `config/season`, `config/missions` e `config/achievements` num `getAll` só. A cada carga, o código monta em memória o índice por tipo de ação (`missionIndex`, puro). A ação consulta o índice e não lê o catálogo: zero leitura a mais por ação, e uma leitura do catálogo por instância a cada 60 s. Motivo: é o padrão da régua (versionado, `expectedVersion`, cópia em `versions/{n}`, auditoria), e o catálogo é pequeno: só as missões em rascunho e no ar (até 60, 30 no ar), porque a arquivada sai dele (decisão 2). Coleção `missions/{id}` com consulta por ação foi descartada: custaria leituras em toda curtida e pediria índice. Limite aceito: missão criada, editada ou arquivada no painel vale em até 60 s, como os valores (seção 9).
2. **Missão com id estável, que nunca volta a ser usado, e as arquivadas num arquivo à parte.** O id (`^[a-z0-9-]{3,40}$`) é a chave do evento de pontos (`mission:<id>:<período>`, 22.5). O servidor gera o id na criação (o título sem acento, em minúsculas, com hífens, até 30 caracteres, mais um hífen e 4 caracteres sorteados) e confere que ele não existe nem no catálogo nem no arquivo; a equipe nunca o escolhe nem o muda. Não há apagar: arquivar tira a missão de `config/missions` e a grava em `missionArchive/{id}`, na mesma transação da versão nova, e publicar de novo a traz de volta com o mesmo id. O lançamento de cada conclusão guarda o título daquela hora (`subjectTitle`, 22.3), então o extrato não depende do catálogo nem do arquivo. Motivo: id reaproveitado no mesmo período não pagaria a missão nova, e um catálogo que guardasse as arquivadas para sempre encheria (uma missão do dia por clipe passa de 200 em poucos meses) e travaria o `createMission`.
3. **Dois períodos, o dia e a semana de São Paulo.** Diária: chave `YYYY-MM-DD` (o `dayKey`), fim no começo do dia seguinte (`nextDayStart`). Semanal: a semana ISO, de segunda a domingo (o `weekKey`, `2026-W41`), fim no começo da segunda-feira seguinte (`nextWeekStart`, novo e puro). É a semana do app (`endOfWeek` com `weekStartsOn: 1` nas fixtures) e a dos fãs ativos (seção 7). Cada missão tem também uma janela de exibição (`startsAt` e `endsAt`, este opcional). A missão aberta aparece e conta enquanto `startsAt <= agora < fim`, com o fim no menor entre o `endsAt` e o fim do período; esse fim é o `endsAt` que o app recebe ("termina em 4 h" às 19:30 de uma diária). A concluída no período fica até o fim do período, mesmo com o `endsAt` vencido, como o `isMissionOver` do app ("Concluída às 14:02" até o dia virar). O período guardado nunca volta para trás: perto da meia-noite, o pedido com o "agora" de 23:59:59,950 pode gravar depois do de 00:00:00,010 (seção 5, passo 5), e o progresso do dia seguinte fica como está (22.4, passo 3).
4. **O que cada tipo de ação conta.** Uma unidade por vez (um "tick"), sempre a partir de uma gravação que o servidor já faz, e a mesma ação nunca conta duas vezes na mesma missão e no mesmo período:

   | Tipo (`action`) | Conta uma unidade quando                                                                                                                                   | Para quem     | Alvos aceitos           |
   | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------- |
   | `like`          | a troca para curtido (a curtida nasce ou volta de `liked: false`), de um post ainda não contado nesta missão no período                                    | quem curte    | nenhum, central ou post |
   | `comment`       | um comentário num post ainda não contado nesta missão no período                                                                                           | quem comenta  | nenhum, central ou post |
   | `rsvp`          | a troca para "Eu vou" (a presença nasce ou volta de `going: false`), de um show ainda não contado nesta missão no período                                  | quem confirma | nenhum, central ou show |
   | `join`          | um vínculo novo com uma central ainda não contada nesta missão no período (1l ou 1d)                                                                       | quem entra    | central                 |
   | `share`         | uma pessoa nova contada pelo link do fã (o marcador `inviteVisitors` nasce, na visita ou no cadastro pelo link)                                            | quem convidou | nenhum, post ou central |
   | `invite`        | um cadastro pelo convite do fã (o claim que grava o `referrals` com quem convidou), por link ou pelo código digitado, uma vez por pessoa (o marcador dela) | quem convidou | nenhum                  |

   Nas quatro ações do próprio fã, o alvo da ação (o post, o show, a central) conta uma vez por missão e período (`keys`, 22.3): "Comente em 3 posts" conta posts diferentes, e curtir, descurtir e curtir de novo o mesmo post no mesmo dia conta um. Noutro período, a mesma ação conta de novo. Motivo: as missões são do dia ou da semana, e contar só a primeira vez da vida (a regra das fixtures para a curtida) deixava missões que nunca fecham: a de um post ou de um show fechava uma vez na vida, quem já tinha curtido ou confirmado antes da missão nunca concluía, e "Curta 5 posts do Nenho" pedia, todo dia, 5 posts que o fã nunca curtiu. O abuso (descurtir e curtir de novo) rende no máximo a recompensa de cada missão por período, dentro dos tetos do dia (`like_set` e `rsvp_set`), o mesmo risco já aceito na entrada. A curtida continua pagando `like:<postId>` uma vez na vida (seção 5): só a missão conta de novo. O `firstLikedAt` e o `firstGoingAt` que o bloco 6 guardou para isso (21.3 e 21.5) ficam, sem uso nas missões. As fixtures contavam cada comentário; a regra do servidor segue o título (pergunta 4 de 22.15).

   Com o alvo que é a própria unidade (post em `like` e `comment`, show em `rsvp`, central em `join`), a meta é 1: mais que isso nunca fecharia, e o `validateMissionInput` recusa. A missão aberta de `like`, `rsvp` ou `join` com esse alvo some do `GET /missions` para quem já está no estado que ela pede (curtiu o post, vai ao show, está na central), porque não há o que fazer sem desfazer (22.2). Assim "Confirme presença no São João" vale, na prática, uma vez para cada fã, sem um período novo (desfazer e confirmar de novo noutra semana conta de novo, dentro do risco aceito acima).

   `share` é a "visita ou cadastro pelo link de um post ou central": a pessoa que abre o link no app e depois se cadastra conta uma vez, como no painel (20.3). O marcador é por convidante e para sempre: quem já abriu um link do fã, de qualquer destino, não anda mais nenhuma missão de link dele, em nenhum período. Até o bloco 13 a visita quase só acontece com o cadastro (20.15), então na prática a missão de link conta cadastros novos. Contar a pessoa por missão e período é pergunta para o dono (pergunta 14 de 22.15). `invite` é o "convidar" ("Traga 3 amigos novos pro app", "1 de 3 cadastrados"); a conta excluída e recriada com o mesmo e-mail não conta de novo, pelo marcador da pessoa (22.4).

5. **Alvo é filtro, e só a chave do alvo decide.** Missão com post conta só a ação naquele post (compara o `postId`; a central gravada no alvo não entra na conta); com show, só naquele show (o `eventId`); com central, só ações naquela central: os posts, os shows e o link dela, e também o link de um post dela. Sem alvo, qualquer uma. O alvo de post guarda também a central dele, gravada pelo servidor: é a aba Missões da 1d (`missionsOfArtist`) e a central da recompensa (decisão 7). Na presença com show alvo, conta só aquele show; as fixtures de hoje contam qualquer show, e passam a contar só o alvo (`countsFor` confere o `eventId`), para os dois modos baterem. O título provisório "Confirme presença em um show" fica, com o show na linha de baixo ("São João de Irará · 21 nov"); a troca de texto é pergunta para a cliente (pergunta 5 de 22.15). `join` exige a central: sem alvo, o app levaria ao Explorar, que ainda é placeholder, e a lista de todos os artistas fica no grupo `(onboarding)`, barrado pelo guard depois do onboarding. Quando o Explorar existir, abrir o `join` sem alvo é uma mudança no `validateMissionInput`.
6. **Progresso na carteira, na mesma transação da ação.** O progresso do período atual mora em `wallets/{uid}.missions` (22.3). A carteira de quem chama já chega lida no `FanContext` (`runIdempotent`), e a de quem convidou já é lida pelo `planAwards`: contar não lê nada a mais. A carteira já é gravada em toda troca para curtido, comentário, troca para "Eu vou" e entrada nova (os tetos do dia, 21.7 e 19.5), então o progresso vai na mesma gravação. Na carteira de quem convidou, a gravação a mais só acontece quando o progresso muda, e o progresso para na meta: no máximo a meta de cada missão por período, mesmo com um link que viraliza. Motivo: nenhum documento novo disputado, nenhuma leitura nova e o progresso atômico com os pontos. Documento à parte (`wallets/{uid}/missionProgress/{período}`) foi descartado: uma leitura e uma gravação a mais em cada ação contada, pelo mesmo resultado. Só o período atual fica guardado: o histórico é o extrato (`mission:<id>:<período>`).
7. **Conclusão paga pelo núcleo de pontos, no mesmo plano da ação.** Quando a unidade fecha a meta, o `computeAwards` acrescenta o lançamento `{ kind: 'earn', source: 'mission', eventId: '<missionId>:<chave do período>', points: <recompensa>, artistId, subject: { type: 'mission', id: <missionId> }, title: <título do catálogo> }` aos lançamentos daquele fã, depois os da ação. O `artistId` é a central do alvo (a do post, ou a central alvo) nas missões de curtir, comentar, "Eu vou" e entrar, e `null` sem alvo, com show alvo e sempre em `share` e `invite`: a missão de link e a de convite pagam quem convidou fora das centrais, como os pontos do convite (decisão 11 de 20.1), e quem não é membro de uma central não entra no ranking dela (bloco 8) por trazer gente pelo link de um post dela. É a decisão do bloco 1 (seção 5, exemplo da curtida que conclui missão): o `pointsAwarded` da resposta já inclui a recompensa, e o mesmo evento nunca paga duas vezes. Missão sem limite diário: `dailyLimits.mission` fica `null` de vez (a validação recusa outro valor, 22.8), porque uma conclusão `capped` gravaria o `completedAt` sem lançamento e a missão não pagaria mais naquele período.
8. **Missão do dia é a destacada de "Hoje".** A equipe marca `featured` em qualquer missão, diária ou semanal. Em cada período vale como destaque só a primeira destacada visível (aberta ou concluída no período, depois de saírem a de alvo fora do ar e a de alvo único já feito, 22.2), na ordem do catálogo; as outras saem com `featured: false`. A destacada concluída continua destacada até o período virar: a 1b mostra o pulso da conclusão nela, e não pula para a próxima. `GET /missions/daily` devolve a destacada de "Hoje", ou `null`. Motivo: a 1b mostra uma missão só, e o card lima da 1g mostra uma por seção ("Hoje" e "Esta semana", `buildMissionItems`).
9. **Meta da temporada em `config/missions.seasonGoal`, presa ao id da temporada.** A meta (título, texto, texto da meta cumprida, métrica e alvo) é editada pela seção Missões, e só aparece com a temporada ativa de mesmo id. Duas métricas: `missions` (missões concluídas na temporada: "Complete 20 missões", "12/20") e `points` (os pontos da temporada, o `seasonPoints` que já existe). O pedido do bloco falava em pontos da temporada; o protótipo e as fixtures contam missões. O código aceita as duas e o painel escolhe, sem código; o seed fica com `missions`, para bater com as fixtures ("Semana do arrocha" 12/20, regra de coerência da seção 13), e a escolha final é do dono e da cliente (perguntas 3 e 15 de 22.15). O contador de missões é `seasonMissions`, na carteira, ao lado de `seasonPoints` e com a mesma troca preguiçosa pelo `seasonId` (seção 8). Quem bate a meta fica marcado na carteira (`goalReached: { seasonId, at }`), na transação em que a conta chega ao alvo, para o painel listar quem ganhou (blocos 10 e 11); a marca não sai, mesmo que um ajuste baixe a conta depois. Com a meta cumprida, a 1g mostra o texto da meta cumprida (o prêmio garantido, `reachedDescription`), que a equipe escreve à parte.
10. **Conquistas pelo servidor, na transação, guardadas na carteira.** Catálogo em `config/achievements`, com padrão no código (a lista provisória de 22.6), como a régua. Regras provisórias: nível alcançado (`level`), a primeira vez de uma ação (`first`: a primeira presença é "Fã de show", a primeira pessoa trazida por link é "Boca a boca") e posição no ranking (`rank`, só no bloco 8). O desbloqueio acontece na transação em que a regra fica verdadeira e grava a data em `wallets/{uid}.achievements`. A de nível que o XP lido já alcança vale desde a leitura (22.6). Conquista não dá pontos e nunca é revogada. Motivo de ficar na carteira: zero leitura a mais, e a regra de nível precisa do XP depois do lançamento, que só existe ali.
11. **Subida de nível detectada na transação e devolvida na resposta.** A régua continua em `config/points.levels`. O nível segue sem ser guardado (sai do XP). A rota compara o nível do XP lido com o do XP novo, pela régua do pedido, e devolve `levelUp` quando subiu. O app já tem o toque `levelUp` e a festa do selo da 1e; o anúncio passa a sair na hora da ação (22.12).
12. **Tudo na transação, sem gatilho.** Contra a sugestão do levantamento (progresso e conquistas por gatilho no lançamento). Motivo: o app espera o `pointsAwarded` com a missão e o aviso da conquista na resposta da própria ação; na transação o resultado é determinístico, testável com relógio fixo e igual no emulador; um gatilho custaria uma execução por lançamento e chegaria depois.
13. **Os tetos do dia ficam editáveis, em `config/points.actionCaps`.** Os tetos de ações dos blocos 4, 5 e 6 (19.5, 20.4, 21.7) saem das constantes para a configuração, com as constantes como padrão do código. O pedido de "editar a régua (valores, tetos, níveis)" pede isso, e o bloco 6 já tinha deixado o lugar indicado. `BLOCK_LIST_MAX` (tamanho da lista de bloqueios) continua constante: não é teto do dia.
14. **Callables do painel com a seção certa.** Régua (`updatePointsConfig`), missões, meta da temporada e conquistas: seção `missions` ("Missões" nos `SECTION_IDS` do painel, `imagineup-admin/src/lib/staff.ts`). Temporada (`updateSeason`): seção `ranking` ("Ranking e temporadas"), como a seção 9 previa. O `updateSeason` sai do bloco 8 para cá, com o `season-id-locked` e o `season-id-used` da seção 8. O `adjustFanPoints` continua no bloco 11.
15. **Extrato provisório no Perfil.** Tela nova, sem desenho, no visual das outras (aprovação de 28/09/2026 para telas sem desenho), aberta pelo card de pontos da 1e. Lê o `GET /me/ledger` do bloco 1, que ganha o nome da central e o título da missão de cada linha (o título vem do próprio lançamento). Fica marcada como provisória nas Pendências, para a cliente validar.
16. **Exclusão de conta: nada de passo novo.** Progresso, conquistas e a meta cumprida moram na carteira, que o `deleteUserData` já apaga inteira (`recursiveDelete(wallets/{uid})`). O progresso de quem convidou não guarda nada da pessoa convidada, e o catálogo e o arquivo das missões não guardam nada de fã (22.11).
17. **Seed pelas próprias ações.** O progresso da Camila sai de claims, visitas e curtidas de verdade, na ordem certa, e a meta da temporada sai de lançamentos de missão no extrato dela (22.13).

### 22.2 Rotas

| Método e caminho                       | Grava | Função do app                             | Resposta                                   |
| -------------------------------------- | ----- | ----------------------------------------- | ------------------------------------------ |
| `GET /missions`                        | não   | `missions/api.ts` `fetchMissions`         | `MissionsResponse`                         |
| `GET /missions/daily`                  | não   | `missions/api.ts` `fetchDailyMission`     | `DailyMissionResponse`                     |
| `GET /me/achievements`                 | não   | `profile/api.ts` `fetchMyAchievements`    | `MyAchievements`                           |
| `GET /me/ledger` (bloco 1)             | não   | `profile/api.ts` `fetchLedgerPage` (novo) | `Page<LedgerEntry>`, com dois campos novos |
| `PUT /posts/:postId/like` (bloco 6)    | sim   | `posts/api.ts` `setPostLike`              | `PointsAward` com as recompensas           |
| `POST /posts/:postId/comments`         | sim   | `posts/api.ts` `addComment`               | `AddCommentResult` com as recompensas      |
| `PUT /events/:eventId/rsvp`            | sim   | `agenda/api.ts` `setEventRsvp`            | `RsvpResult` com as recompensas            |
| `PUT /me/centrals/:artistId` (bloco 4) | sim   | `artists/api.ts` `joinCentral`            | `JoinCentralResult` com as recompensas     |
| `POST /me/artists`                     | sim   | `artists/api.ts` `followArtists`          | `FollowArtistsResult` com as recompensas   |
| `POST /invites/claim` e `/visit`       | sim   | `auth/api.ts`                             | como hoje (o progresso é de quem convidou) |

Arquivos novos:

- `functions/src/day.ts`: `TIME_ZONE`, `dayKey`, `shiftDay`, `nextDayStart`, `weekKey` e `monthKey` saem de `points/model.ts` para cá, e o `points/model.ts` os reexporta (nenhum import de hoje muda). Mais `nextWeekStart(now)`, puro.
- `functions/src/missions/`: `model.ts` (puro, com teste em tabela: tipos do catálogo, `parseMissionsConfig`, `validateMissionInput`, `missionIndex`, `periodOf`, `candidateMissions`, `rollMissions`, `applyMissionTicks`, `keyDigest`, `missionsView`, constantes e o `MissionsError`), `service.ts` (leituras das rotas), `panel.ts` (callables das missões e da meta), `errors.ts` (`HttpsError` com `details.reason`), `seed.ts` e `index.ts`.
- `functions/src/achievements/`: `model.ts` (puro: catálogo, `DEFAULT_ACHIEVEMENTS_CONFIG`, `parseAchievementsConfig`, `validateAchievementInput`, `unlockAchievements`, `achievementsView`), `service.ts`, `panel.ts`, `errors.ts` e `index.ts`.
- `functions/src/points/panel.ts`: `updatePointsConfig` e `updateSeason`.
- `functions/src/api/routes/missions.ts` (`missionRoutes`: `/missions`, `/missions/daily` e `/me/achievements`), somadas ao `API_ROUTES` depois das do bloco 6.

Sem ciclo entre os módulos: o `points/model.ts` importa os modelos de missões e de conquistas (valores), e eles importam do `points/model.ts` só tipos (`import type`, como o `AwardEntry`), com os dias vindo de `day.ts`. O nível chega pronto ao `achievements/model.ts` (o número do degrau, calculado por quem chama com o `levelForXp`). Um teste carrega cada modelo sozinho.

Os tipos novos entram em `api/contract.ts`, espelho de `src/domains/missions/types.ts` e `src/domains/profile/types.ts`. Nenhum código de erro novo na API: as rotas novas só leem.

#### `GET /missions`

1. Em paralelo: `wallets/{uid}` (uma leitura) e a configuração do cache (valores, temporada, catálogo).
2. As missões visíveis, na ordem do catálogo: `status: 'active'` e `startsAt <= agora`; a aberta enquanto `agora < fim` (decisão 3), a concluída no período até o fim do período.
3. Um `getAll` com os alvos citados, `posts/{postId}`, `events/{eventId}` e `artists/{artistId}` (a central do post vem no mesmo `getAll`, porque o alvo de post guarda a central), e, para cada missão aberta de alvo único (`like` com post, `rsvp` com show, `join`), o estado do fã: `users/{uid}/postLikes/{postId}`, `users/{uid}/eventRsvps/{eventId}` ou `users/{uid}/centrals/{artistId}`. Saem da resposta: a aberta com alvo invisível (post fora do ar ou de central fora do ar, a regra do `readVisiblePost`; show fora do ar ou encerrado, `isEventOpen`; central fora do ar) e a aberta de alvo único que o fã já fez (`liked: true`, `going: true`, o vínculo existe). A concluída no período fica, mesmo com o alvo fora: o fã vê o "Concluída às 14:02".
4. O progresso de cada uma vem de `wallet.missions.daily` ou `.weekly`, só quando a chave guardada é a do período de agora; senão, 0.
5. O destaque de cada período (decisão 8), depois do passo 3.
6. `season`: a meta de `config/missions.seasonGoal` quando o `seasonId` dela é o da temporada ativa (cache); senão, `null` (22.7).

Custo: uma leitura da carteira, uma por alvo distinto (em geral 3 a 6) e uma por missão aberta de alvo único. Não exige perfil: carteira que não existe responde tudo em 0.

```json
{
  "season": {
    "id": "temporada-sao-joao",
    "title": "Semana do arrocha",
    "description": "Complete 20 missões e garanta um lote de ingressos do São João.",
    "completedCount": 12,
    "targetCount": 20,
    "endsAt": "2026-10-17T22:30:00.000Z"
  },
  "missions": [
    {
      "id": "m-clipe-netto",
      "title": "Leve 5 pessoas para o clipe novo do Netto",
      "rewardPoints": 20,
      "progress": { "current": 3, "target": 5 },
      "endsAt": "2026-10-06T03:00:00.000Z",
      "status": "active",
      "action": "share",
      "target": { "postId": "p-clipe", "artistId": "nettobrito" },
      "period": "daily",
      "featured": true,
      "pointsBreakdown": { "perVisit": 2, "perSignup": 10 },
      "completedAt": null,
      "unlockHint": null,
      "event": null
    }
  ]
}
```

O `Mission`, igual nas duas rotas:

- `rewardPoints`: a recompensa do catálogo; na concluída com `rewardPaid` maior que 0, a que foi paga, para uma troca de valor depois não mudar o que o fã viu. A conclusão que saiu `duplicate` guarda 0 e mostra a do catálogo, nunca "+0".
- `progress`: `{ current: min(current, meta), target: meta }`.
- `endsAt`: na aberta, o fim da decisão 3; na concluída, o fim do período (a meia-noite do dia, ou a da segunda-feira na semanal), que é quando ela sai, mesmo com o `endsAt` do catálogo antes. Em ISO. O app tira da tela a missão que passou do `endsAt`, aberta ou concluída (`isMissionOver`, 22.12).
- `status`: `completed` com `completedAt` no período; senão `active`. O servidor nunca manda `expired` nem `locked` (a relâmpago fica de fora).
- `action`: o tipo da decisão 4. `join` é novo no app (22.12).
- `target`: só as chaves que existem (`{ postId, artistId }`, `{ artistId }`, `{ eventId }`), ou `null`.
- `featured`: decisão 8.
- `pointsBreakdown`: só no `share`, com `values.invite_visit` e `values.invite_signup` da configuração.
- `completedAt`: ISO, na concluída.
- `unlockHint`: sempre `null`.
- `event`: só no `rsvp` com show alvo: `{ name: title, startsAt }` do show.

#### `GET /missions/daily`

A mesma montagem, só com as diárias destacadas. Responde `{ "mission": <Mission> }` com a destacada de "Hoje" (decisão 8: a primeira visível, aberta ou concluída hoje), ou `{ "mission": null }`. Lê a carteira, os alvos delas e, no alvo único, o estado do fã.

#### `GET /me/achievements`

Lê a carteira e a configuração do cache (catálogo e régua).

```json
{
  "unlockedCount": 5,
  "totalCount": 9,
  "highlights": [
    {
      "id": "boca-a-boca",
      "title": "Boca a boca",
      "icon": "share",
      "tone": "action",
      "unlockedAt": "2026-10-05T22:30:00.000Z"
    },
    {
      "id": "purainha",
      "title": "Purainha",
      "icon": "star",
      "tone": "points",
      "unlockedAt": "2026-09-27T15:00:00.000Z"
    },
    {
      "id": "sanfona",
      "title": "Sanfona",
      "icon": "star",
      "tone": "points",
      "unlockedAt": "2026-09-27T15:00:00.000Z"
    },
    {
      "id": "backstage",
      "title": "Backstage",
      "icon": "star",
      "tone": "points",
      "unlockedAt": null
    }
  ]
}
```

- `totalCount`: as conquistas `active` do catálogo. `unlockedCount`: quantas delas o fã tem, as de `wallet.achievements` e as de nível cujo degrau o nível do XP lido (pela régua do cache) já alcança, ainda sem gravação (22.6, com a data do `updatedAt` da carteira). Arquivada sai das duas contas, e o "X de N" nunca passa de N.
- `highlights` (`achievementsView`, puro, com o nível pronto): até 3 desbloqueadas, da mais nova para a mais velha (empate pelo catálogo de trás para frente: no mesmo instante, a de nível maior vem antes), e depois as bloqueadas: primeiro a de nível com o menor degrau acima do nível atual (a próxima que o XP destrava), depois as outras na ordem do catálogo, até 4 peças (`ACHIEVEMENT_HIGHLIGHTS`, as `ACHIEVEMENT_SLOTS` da 1e). A Camila do seed vê Boca a boca, Purainha, Sanfona e Backstage; o fã novo (nível 1) vê Pé de serra, Boca a boca, Fã de show e Missão cumprida.

#### `GET /me/ledger`

Como na seção 6, com dois campos novos em cada linha, opcionais no app:

```json
{
  "items": [
    {
      "id": "mission:m-curtir-nenho:2026-10-05",
      "kind": "earn",
      "source": "mission",
      "points": 10,
      "xpDelta": 10,
      "seasonDelta": 10,
      "artistId": "nenho",
      "centralSeasonDelta": 10,
      "centralTotalDelta": 10,
      "subject": { "type": "mission", "id": "m-curtir-nenho" },
      "createdAt": "2026-10-05T22:31:04.000Z",
      "artistName": "Nenho",
      "subjectTitle": "Curta 5 posts do Nenho"
    }
  ],
  "nextCursor": null
}
```

- `artistName`: o `name` de `artists/{artistId}`, num `getAll` das centrais distintas da página, em qualquer status; `null` sem central ou com a central apagada.
- `subjectTitle`: o título que o lançamento de missão guardou ao concluir (22.3), que não muda com o título do catálogo nem com o arquivo; `null` no resto e no lançamento sem o campo. O título do show e da recompensa ficam de fora: o "Eu vou" já leva a central, e o resgate é do bloco 10.
- O `id` continua o do documento, também dentro do cursor. O app o usa só como chave da lista e nunca o mostra. O de convite leva a chave da pessoa (o HMAC do e-mail ou, na conta sem e-mail, `u<uid>`), que com a tela nova vai para o aparelho de quem convidou e para o cache do disco. Fica assim de propósito: 20.6 mostra que escondê-lo do fã não fecharia nada (a equipe lê os ids crus, e o fã não lê o extrato de mais ninguém), e trocar o id por um resumo pediria outro cursor, porque o convite é o lançamento que mais repete o mesmo `createdAt` (a visita e o cadastro no mesmo claim).
- Custo: a página, mais uma leitura por central distinta nela (em geral 2 ou 3).

#### Respostas das ações

As rotas que lançam pontos para quem chama passam a mandar, além do que mandam hoje, as recompensas do plano (`rewardsOf(plan)`, em `points/award.ts`):

```json
{
  "pointsAwarded": 10,
  "completedMissions": [
    {
      "id": "m-curtir-nenho",
      "title": "Curta 5 posts do Nenho",
      "rewardPoints": 10,
      "completedAt": "2026-10-05T22:31:04.000Z"
    }
  ],
  "levelUp": null,
  "unlockedAchievements": [],
  "missionsChanged": true
}
```

- Valem para `PUT /posts/:postId/like`, `POST /posts/:postId/comments`, `PUT /events/:eventId/rsvp`, `PUT /me/centrals/:artistId` e `POST /me/artists`. Os quatro campos vão sempre (listas vazias, `null` e `false`), também quando a ação não rendeu nada. No app, o comentário que entra no cache da lista sai sem eles: o `commitComment` já tira o `pointsAwarded` e passa a tirar os quatro. Desfazer (`DELETE`), sair, denunciar, bloquear e as rotas do convite não mudam.
- `completedMissions`: as missões de quem chama concluídas agora e pagas (lançamento aplicado), na ordem do plano, com o título do lançamento.
- `levelUp`: `{ number, name, minXp }` do nível novo quando subiu, senão `null`. Duas subidas de uma vez mandam o nível final.
- `unlockedAchievements`: `{ id, title }` das conquistas desbloqueadas agora para quem chama (a de nível que já valia na leitura não volta aqui, 22.6).
- `missionsChanged`: `true` quando alguma unidade contou no progresso de quem chama, quando a meta da temporada foi cumprida agora e, com a meta por pontos (`metric: 'points'`, da temporada ativa), quando os pontos da temporada dele mudaram no plano, mesmo sem missão nenhuma andar: o anel da 1g é o `seasonPoints`. O app só busca as missões de novo assim (22.12).
- O `pointsAwarded` é o de sempre: a soma dos ganhos aplicados de quem chama, com as missões. A resposta repetida pela idempotência traz o mesmo corpo (`storedBody`).
- No `contract.ts`, os campos entram por interseção só nos corpos das rotas que gravam a ação (`PointsAward & ActionRewards` no `PUT` da curtida, `AddCommentResult & ActionRewards`, `RsvpResult & ActionRewards` no `PUT` do "Eu vou", `JoinCentralResult & ActionRewards` e `FollowArtistsResult & ActionRewards`). O `DELETE /posts/:postId/like` e o `DELETE /events/:eventId/rsvp` continuam com o `PointsAward` e o `RsvpResult` de hoje, sem eles. No app, os campos são opcionais nos tipos de sempre.

### 22.3 Coleções e campos

Uma coleção nova (`missionArchive`), dois documentos novos em `config/`, campos novos na carteira, no extrato e nos shards do painel.

```
config/missions {
  version: number                    // 1, 2, 3...; sem documento, a versão 0: catálogo vazio e sem meta
  missions: [{                       // na ordem do painel (a ordem da 1g e da 1d); só draft e active
    id: string                       // ^[a-z0-9-]{3,40}$, do servidor (22.1, decisão 2)
    title: string                    // 1 a 80, uma linha visível
    action: 'like' | 'comment' | 'rsvp' | 'join' | 'share' | 'invite'
    target: {
      postId: string | null
      artistId: string | null        // a central (no alvo de post, a dele, gravada pelo servidor)
      eventId: string | null
    } | null
    goal: number                     // a meta, inteiro de 1 a 50 (MISSION_GOAL_MAX); 1 no alvo único
    period: 'daily' | 'weekly'
    rewardPoints: number             // inteiro de 1 a 10.000 (VALUE_MAX)
    featured: boolean
    startsAt: Timestamp
    endsAt: Timestamp | null
    status: 'draft' | 'active'
    activatedAt: Timestamp | null    // a primeira vez que ficou active (a trava de 22.8)
    createdAt: Timestamp
    updatedAt: Timestamp
  }]
  seasonGoal: {
    seasonId: string                 // o id de config/season.season
    title: string                    // 1 a 40, uma linha visível ("Semana do arrocha")
    description: string              // 1 a 140, uma linha visível
    reachedDescription: string | null  // 1 a 140; o texto com a meta cumprida (o prêmio garantido)
    metric: 'missions' | 'points'
    target: number                   // 1 a 1.000 em missions; 1 a 1.000.000 em points
  } | null
  updatedAt: Timestamp
  updatedBy: { uid: string, name: string } | null
}
config/missions/versions/{version}   // cópia imutável de cada versão

missionArchive/{missionId} {         // a missão arquivada, fora do catálogo (22.1, decisão 2)
  ...                                // os campos da missão de config/missions, como estavam
  status: 'archived'
  archivedAt: Timestamp
  archivedBy: { uid: string, name: string }
}

config/achievements {
  version: number                    // sem documento, a versão 0: DEFAULT_ACHIEVEMENTS_CONFIG (22.6)
  achievements: [{
    id: string                       // ^[a-z0-9-]{3,40}$, do servidor, como a missão
    title: string                    // 1 a 40, uma linha visível
    icon: string                     // ^[a-z0-9-]{1,30}$; o app conhece share, trophy, ticket, star,
                                     // users, heart, comment, calendar e flame, e cai no genérico no resto
    tone: 'action' | 'points' | 'events'
    rule: { type: 'level', level: number }            // 2 a 50, um degrau da régua
        | { type: 'first', action: 'like' | 'comment' | 'rsvp' | 'join' | 'share' | 'invite' | 'mission' }
        | { type: 'rank', top: number }               // bloco 8; até lá não pode ficar active
    status: 'draft' | 'active' | 'archived'
    activatedAt: Timestamp | null
    createdAt: Timestamp
    updatedAt: Timestamp
  }]
  updatedAt: Timestamp
  updatedBy: { uid: string, name: string } | null
}
config/achievements/versions/{version}

config/points {
  ...                                // seção 4
  dailyLimits: { ..., mission: null }  // sempre null (22.1, decisão 7)
  actionCaps: {                      // tetos do dia por fã (decisão 13); padrão: as constantes de hoje
    central_entry: 30, invite_visit_sent: 20, invite_link: 30, like_set: 300,
    comment_sent: 100, rsvp_set: 50, comment_report: 30, fan_block: 30
  }
}

wallets/{uid} {
  ...                                // seção 4
  seasonMissions: number             // missões concluídas na temporada seasonId; zera na troca de temporada
  goalReached: { seasonId: string, at: Timestamp } | null   // quem bateu a meta da temporada; nunca sai
  missions: {
    daily: { key: string, items: { <missionId>: MissionItem } } | null    // key "2026-10-05"
    weekly: { key: string, items: { <missionId>: MissionItem } } | null   // key "2026-W41"
  }
  achievements: { <achievementId>: Timestamp }   // quando desbloqueou; nunca sai
}

MissionItem {
  current: number                    // unidades contadas no período
  keys: string[]                     // em like, comment, rsvp e join: o keyDigest de cada post, show
                                     // ou central que já contou; vazio em share e invite
  completedAt: Timestamp | null
  rewardPaid: number                 // o que a conclusão pagou (0 enquanto aberta ou se saiu duplicate)
}

wallets/{uid}/ledger/{entryId} {
  ...                                // seção 4
  subjectTitle: string | null        // só na missão: o título dela quando concluiu
}
```

- `config/missions`, `missionArchive` e `config/achievements` só mudam pelas callables (22.8), na transação que grava a versão nova, a cópia em `versions/{n}` e a auditoria. Ninguém grava pelo cliente.
- Limites do catálogo de missões: até 60 missões no documento (`MISSIONS_MAX`, rascunhos e no ar) e até 30 no ar (`ACTIVE_MISSIONS_MAX`); o arquivo não tem limite. Conquistas: até 100 (`ACHIEVEMENTS_MAX`, arquivadas inclusive: a arquivada continua na carteira de quem ganhou, e a lista cresce pouco). Com isso, o documento das missões fica abaixo de uns 50 KiB, e o progresso na carteira fica pequeno: só `like`, `comment`, `rsvp` e `join` guardam chaves, até a meta (50), com 12 caracteres cada (`keyDigest`: os 12 primeiros caracteres do sha256 do id em base64url, porque os ids de post vão até 128 e a carteira é regravada a cada ação), e `share` e `invite` chegam únicos pelo marcador da pessoa.
- Leitura tolerante, como a de `config/points` (seção 9): `parseMissionsConfig` descarta, com `logger.error`, a missão fora do formato (as outras ficam, e um `status` fora de `draft` e `active` é fora do formato) e a meta inválida (vira `null`); documento fora do formato vale o catálogo vazio. `parseAchievementsConfig` faz o mesmo, e o documento fora do formato vale o padrão do código. O `actionCaps` entra no `parsePointsConfig`: chave desconhecida ignorada, valor inválido volta ao padrão só nele. O `parsePointsConfig` força `dailyLimits.mission` em `null` (outro valor vai para o `logger.error`).
- Carteira: `walletFromDoc` lê os quatro campos novos com padrão (`0`, `null`, `{ daily: null, weekly: null }`, `{}`) e o `updatedAt` (ms, a data da conquista de nível que já valia, 22.6), e `walletFields` os grava junto com o resto, no `create` e no `update`. O `missions` e o `achievements` vão inteiros a cada gravação, como o `days`.
- Extrato: o lançamento de missão leva `title` na entrada (`AwardEntry` da `mission`, obrigatório, de 1 a 80, conferido no `assertValidEntry`), que vira o `subjectTitle` do `LedgerData`; nas outras origens, `null`.
- `ShardDelta` (`points/stats.ts`) ganha `byMission: { <missionId>: { completed } }` e `byAchievement: { <achievementId>: { unlocked } }` (22.9).
- Contrato, no app e no `contract.ts`: `MissionsResponse`, `Mission`, `SeasonGoal`, `DailyMissionResponse` e `MyAchievements` como estão, com `MissionAction` ganhando `join`. Novos: `ActionRewards { completedMissions: CompletedMission[]; levelUp: Level | null; unlockedAchievements: UnlockedAchievement[]; missionsChanged: boolean }`, `CompletedMission { id, title, rewardPoints, completedAt }` e `UnlockedAchievement { id, title }`, nos corpos das rotas que gravam a ação (22.2; opcionais no app). `LedgerEntry` ganha `artistName: string | null` e `subjectTitle: string | null`. O comentário do topo de `missions/types.ts` deixa de chamar o contrato de provisório.

### 22.4 Transações passo a passo

A ordem é a de sempre (seção 5): chave e fã (`runIdempotent`), leituras do domínio, `planAwards`, gravações do domínio. O que muda é o núcleo: o `planAwards` passa a receber as unidades contadas de cada fã e a configuração do jogo.

**Entradas novas do núcleo** (`points/award.ts` e `points/model.ts`):

```ts
type MissionAction = 'like' | 'comment' | 'rsvp' | 'join' | 'share' | 'invite';

type MissionTick = {
  action: MissionAction;
  key: string; // o post, o show, a central ou a chave da pessoa
  on: { postId?: string; eventId?: string; artistIds: string[] };
};

type GameConfig = {
  missions: MissionIndex;
  achievements: AchievementCatalog;
  seasonGoal: SeasonGoalConfig | null;
};

type FanAwards = { uid: string; entries: AwardEntry[]; fan?: FanContext; ticks?: MissionTick[] };
type AwardContext = { now; config; shard; actor; game: GameConfig };
```

- O `runIdempotent` monta o `AwardContext.game` da mesma carga do cache que já dá os valores (`deps.config.get()`). Os caminhos fora da API (`runAward`, `runAsFan`, `runJoinCentrals`, `runClaim`, `runLikePost` e o `runVisit` novo, usados pelo seed e pelo ajuste) ganham `game` nas opções, com o padrão `NO_GAME` (catálogos vazios e sem meta): quem não passa nada continua como hoje, sem andar missão, sem desbloquear conquista e sem marcar a meta. O ajuste da equipe (`adjustFanPoints`, bloco 11) passa o `game` da configuração.
- O `AwardPlan` ganha `rewards: ActionRewards` (de quem chama).

**Leituras** (`planAwards`, no mesmo `getAll` de hoje):

1. As missões candidatas de cada fã com ticks: `candidateMissions(game.missions, ticks, now)`, puro, devolve as `active`, na janela, do tipo do tick e com o alvo que casa (decisão 5): com post no alvo, `on.postId` igual; com show, `on.eventId` igual; com central, a central em `on.artistIds`; sem alvo, qualquer uma.
2. Para quem chama, o progresso já está no `FanContext.wallet`: o núcleo calcula antes quais candidatas vão concluir e lê só `ledger/mission:<id>:<período>` delas e o `centralPoints` da central delas. Para outro fã (quem convidou), cuja carteira só chega no `getAll`, entram todas as candidatas (em geral uma ou duas).

**Cálculo** (`computeAwards`, puro, depois dos lançamentos da rota, para cada fã com perfil; fã sem perfil, como quem convidou e excluiu a conta, tem os ticks ignorados, como os lançamentos `skipped`):

3. `rollMissions(state.missions, now)`: o período cuja chave guardada é anterior à do pedido vira vazio, com a chave do pedido, sem gravar por isso (como a troca de temporada, passo 6 da seção 5). Chave guardada posterior à do pedido (o pedido de 23:59:59,950 gravando depois do de 00:00:00,010, seção 5, passo 5; o mesmo na virada de segunda-feira): o progresso guardado fica como está, e os ticks daquele período no pedido são descartados (não andam, não concluem, não pagam). As chaves comparam como texto (`2026-10-05`, `2026-W41`).
4. `applyMissionTicks` (de `missions/model.ts`), tick por tick, na ordem. Para cada candidata do tick: concluída no período, não anda; em `like`, `comment`, `rsvp` e `join`, o `keyDigest(key)` que já está em `keys` não anda; senão `current += 1` (e o resumo entra em `keys` nesses quatro tipos). Chegou na meta: `completedAt = now` e o lançamento da missão (22.1, decisão 7), com o título do catálogo, entra no fim da lista do fã.
5. Os lançamentos de missão passam pelo mesmo passo 7 da seção 5: extrato que já existe é `duplicate` (o `completedAt` fica, e o `rewardPaid`, 0). Nunca saem `capped` (o limite é sempre `null`) nem `zero` (a recompensa vai de 1 a 10.000). Aplicado: `rewardPaid` recebe os pontos; com temporada ativa, `seasonMissions += 1`; o shard soma `byMission[id].completed`.
6. Meta da temporada: com temporada ativa, `game.seasonGoal` do mesmo id, a conta da métrica depois do plano (`seasonMissions` ou `seasonPoints`) no alvo ou acima e `goalReached` sem esse `seasonId`, a carteira ganha `goalReached = { seasonId, at: now }`. Vale em qualquer gravação da carteira, também na primeira depois de a equipe baixar o alvo, e conta como mudança (passo 8).
7. Conquistas (`unlockAchievements`, de `achievements/model.ts`, com os números dos níveis prontos): o nível do XP lido e o do XP depois do plano (`levelForXp` com a régua do pedido), `first:<tipo>` de cada tick do fã (mesmo sem missão nenhuma daquele tipo) e `first:mission` quando algum lançamento `mission` foi aplicado. Cada conquista `active` cuja regra ficou verdadeira e que não está em `achievements` entra: a de nível que o XP lido já alcançava (a régua mudou depois da última gravação) com a data do `updatedAt` lido, a mesma que o `GET /me/achievements` já mostrava; o resto com `now`. O shard soma `byAchievement[id].unlocked`.
8. A carteira é gravada também quando só o progresso mudou, só uma conquista nasceu ou só a meta foi marcada (o critério do passo 9 da seção 5 ganha esses três casos).
9. Quem chama: `rewards.completedMissions` (as aplicadas dele, com o título), `rewards.levelUp` (nível do XP novo maior que o do XP lido, pela régua do pedido), `rewards.unlockedAchievements` (as que nasceram com `now`) e `rewards.missionsChanged` (alguma unidade dele contou no passo 4, a meta foi marcada no passo 6 ou, na meta por pontos, o `seasonPoints` dele mudou no plano).

**Onde nasce cada tick** (sempre no `planAwards` que vem antes das gravações do domínio; o que é chamado depois delas, com a lista vazia, não leva ticks):

- **Curtir** (`likePost`): na troca para curtido (a curtida nasce, ou estava com `liked: false`; o mesmo caminho que conta o `like_set`), `{ action: 'like', key: postId, on: { postId, artistIds: [artistId] } }`. Já curtido não conta.
- **Comentar** (`commentOnPost`): a cada comentário que nasce, `{ action: 'comment', key: postId, on: { postId, artistIds: [artistId] } }`. O comentário do seed que já existe sai sem plano e sem tick (21.4).
- **"Eu vou"** (`rsvpEvent`): na troca para "Eu vou" (a presença nasce, ou estava com `going: false`), `{ action: 'rsvp', key: eventId, on: { eventId, artistIds: <as centrais no ar do show> } }`. Já confirmado não conta.
- **Entrar** (`joinCentrals`, da 1d, da 1l e do seed): um tick por vínculo novo, `{ action: 'join', key: artistId, on: { artistIds: [artistId] } }`. Sair e entrar de novo no mesmo período não conta de novo (`keys`); noutro período, conta (limite aceito: o teto de 30 entradas por dia segura, e a missão paga uma vez por período).
- **Claim** (`claimInvite`), para quem convidou, e só no caminho que monta o plano (não na mesma pessoa noutra conta). O claim já lê o marcador `inviteVisitors/{personKey}` antes do `planAwards`. `{ action: 'invite', key: personKey, on: { artistIds: [] } }` quando o marcador não existe ou existe só por uma visita (`via: 'visit'` sem `signupAt`); e, com o marcador ainda não existente e `via: 'link'`, `{ action: 'share', key: personKey, on: linkOn(origem) }`. Na gravação, o marcador passa a guardar o cadastro: nasce com `signupAt` (o de hoje, `via: 'claim'`), ou, se veio de uma visita, ganha `signupAt` por `tx.update` (uma gravação a mais nesse caso). O marcador de antes do bloco 7 com `via: 'claim'` vale como cadastro. Assim a conta excluída e recriada com o mesmo e-mail não anda o `invite` de novo, também quando o cadastro não pagou (valor 0 ou quem convidou acima do limite do dia, que saem `zero` e `capped` e não deixam lançamento). O código digitado não é link: só `invite`.
- **Visita** (`recordInviteVisit`), para quem convidou, depois das saídas de hoje (dono do código, teto de quem visita): com o marcador ainda não existente, `{ action: 'share', key: personKey, on: linkOn(origem) }`.
- **`linkOn(origem)`**: `{ postId, artistIds: [] }` no link de post, `{ artistIds: [@] }` no de central e `{ artistIds: [] }` nos outros (`invite`, `agenda`, `other`). No link de post, quando o índice tem uma missão `share` ativa com alvo de central, o claim e a visita leem também `posts/{postId}` (no mesmo `getAll` do marcador, em qualquer status) e põem a central do post em `artistIds`: o link de um post do Netto anda a missão de link da central do Netto (decisão 5). Sem essa missão, nada a mais é lido.

O marcador nasce só quando quem convidou tem perfil, e o tick só vale quando quem convidou tem perfil: os dois acontecem juntos. A chave da pessoa não é guardada no progresso (`keys` fica vazio em `share` e `invite`), porque a unicidade já vem do marcador.

**Custo.** Curtida que conclui missão na mesma central: 10 leituras (as 9 de 21.4, mais o extrato da missão) e as gravações de 21.4 mais o lançamento da missão (a central e a carteira já seriam gravadas). Curtida que só anda missão: as de hoje, sem leitura a mais (a carteira já era gravada pelo teto). Claim ou visita com missão de quem convidou aberta: mais as candidatas no `getAll` (uma ou duas) e a carteira de quem convidou gravada enquanto o progresso muda. Claim de quem já tinha visitado: mais a gravação do `signupAt` no marcador. Link de post com missão de link de central no ar: mais a leitura do post.

**Concorrência.** Duas ações do mesmo fã disputam a carteira, e a que repete parte do progresso gravado pela outra: a unidade não conta duas vezes e a missão não paga duas vezes. Muitas pessoas pelo link do mesmo fã disputam a carteira dele só enquanto alguma missão dele anda (até a meta) ou um lançamento de convite paga (até o limite do dia): depois disso, o claim e a visita só leem a carteira dele, como hoje (20.4).

### 22.5 Idempotência e o evento de pontos

- Pedido: a `Idempotency-Key` de sempre. As rotas novas só leem.
- Negócio, em três camadas: a unidade conta uma vez (o resumo do alvo em `keys` na missão e no período, ou o marcador da pessoa no convite); a missão conclui uma vez por período (`completedAt` no progresso); e paga uma vez por missão e período (`mission:<missionId>:<chave do período>` no extrato, `eventId` como `m-clipe-netto:2026-10-05` ou `m-trazer-amigos:2026-W41`, no `EVENT_ID_PATTERN`). A mesma missão volta a valer no período seguinte, com o progresso do zero.
- Valor: `rewardPoints` da missão, explícito no lançamento (seção 5, `points` só na `mission`), sem limite diário. Mudança de recompensa vale para a próxima conclusão; a já paga fica (`rewardPaid`).
- Conquista e meta da temporada não têm evento de pontos: o desbloqueio é idempotente por existir ou não em `achievements`, e a meta, por existir ou não `goalReached` com o `seasonId`.
- Os lançamentos `mission:seed-camila-<n>` do seed (seção 14) seguem válidos: o `eventId` sem período não colide com o formato acima.

### 22.6 Conquistas: regras e lista provisória

Regras (`unlockAchievements`, puro, com teste em tabela):

| Regra                         | Fica verdadeira quando                                                           |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `{ type: 'level', level: n }` | o nível do XP, pela régua do pedido, é `n` ou mais                               |
| `{ type: 'first', action }`   | um tick daquele tipo veio no plano (`mission`: um lançamento de missão aplicado) |
| `{ type: 'rank', top: n }`    | bloco 8 (posição na temporada `n` ou melhor); até lá nunca                       |

A regra é avaliada para quem chama em toda rota que grava (o XP está no retrato, sem leitura) e para quem convidou quando ele está no plano. O ajuste da equipe e o seed também desbloqueiam, desde que passem o `game` (o seed passa, 22.13; o `adjustFanPoints` do bloco 11 tem de passar): a regra olha o XP, e não quem lançou.

A de nível vale desde a leitura. Depois de a equipe baixar o `minXp` de um degrau, a 1e festeja o nível novo na hora (o `/me/progress` sai do XP), e o `GET /me/achievements` já conta a conquista daquele degrau como desbloqueada, com a data do `updatedAt` da carteira (o XP só muda com gravação). A próxima gravação a guarda com essa mesma data, sem anunciar em `unlockedAchievements`. Assim o "X de N", o selo e a conquista andam juntos.

Lista provisória (`DEFAULT_ACHIEVEMENTS_CONFIG`, versão 0, até a cliente responder, UP-9). Ela troca os "14 de 32" do protótipo por uma lista que o servidor sabe conferir hoje. A lista padrão conta como publicada: cada `active` tem `activatedAt`, e a trava `achievement-locked` vale para ela (22.8).

| Ordem | id                | Título          | Ícone     | Tom      | Regra              | Status   |
| ----- | ----------------- | --------------- | --------- | -------- | ------------------ | -------- |
| 1     | `boca-a-boca`     | Boca a boca     | `share`   | `action` | `first`, `share`   | `active` |
| 2     | `fa-de-show`      | Fã de show      | `ticket`  | `events` | `first`, `rsvp`    | `active` |
| 3     | `missao-cumprida` | Missão cumprida | `flame`   | `points` | `first`, `mission` | `active` |
| 4     | `puxa-conversa`   | Puxa conversa   | `comment` | `action` | `first`, `comment` | `active` |
| 5     | `pe-de-serra`     | Pé de serra     | `star`    | `points` | `level`, 3         | `active` |
| 6     | `sanfona`         | Sanfona         | `star`    | `points` | `level`, 5         | `active` |
| 7     | `purainha`        | Purainha        | `star`    | `points` | `level`, 7         | `active` |
| 8     | `backstage`       | Backstage       | `star`    | `points` | `level`, 8         | `active` |
| 9     | `lenda`           | Lenda           | `star`    | `points` | `level`, 10        | `active` |
| 10    | `top-20`          | Top 20          | `trophy`  | `points` | `rank`, 20         | `draft`  |

"Boca a boca", "Fã de show", "Top 20" e "Backstage" são os nomes da 1e; "Backstage" vira o nível 8. As de nível repetem os nomes dos degraus 3, 5, 7 e 10 da régua provisória. O "Top 20" fica em rascunho até o bloco 8: entra na conta "de N" só quando puder ser ganho. Nos destaques, a primeira bloqueada é a de nível seguinte ao do fã (22.2): a Camila (nível 7) vê Boca a boca, Purainha, Sanfona e Backstage, perto da fixture (Boca a boca, Top 20, Fã de show e Backstage).

### 22.7 Nível e meta da temporada

**Nível.** O nível de quem chama antes e depois do plano sai do `levelForXp` com a régua do mesmo pedido (cache). Subiu: `levelUp` na resposta. A régua só muda pela callable, e a mudança muda o nível mostrado de todo mundo na hora (seção 9), sem `levelUp`, com a conquista do degrau junto (22.6): o app só festeja a subida que a ação causou e a que a 1e vê ao abrir (22.12). O nível de quem convidou também pode subir num claim; ele vê a festa na 1e, como hoje.

**Meta da temporada** (`SeasonGoal` do app, `missionsView`):

- Existe quando `config/missions.seasonGoal` existe e o `seasonId` dela é o da temporada ativa (`startsAt <= agora < endsAt`). Senão, `season: null` e o card some.
- `id`: o da temporada; `title`: o da meta; `targetCount`: o `target`; `endsAt`: o fim da temporada.
- `completedCount`: com `metric: 'missions'`, `wallet.seasonMissions` quando `wallet.seasonId` é o da temporada, senão 0; com `metric: 'points'`, o `visibleSeasonPoints` do `/me/wallet`.
- Cumprida: `wallet.goalReached.seasonId` igual ao da temporada, ou a conta no alvo ou acima. Cumprida, `description` é o `reachedDescription` (o prêmio garantido, como o `SeasonGoal` do app já descreve); sem ele, o `description` de sempre.
- `seasonMissions` sobe no `computeAwards`, a cada lançamento `mission` aplicado com temporada ativa, e zera na troca preguiçosa de temporada, junto com o `seasonPoints` (passo 6 da seção 5). Não conta para o `pastSeasons`.
- `goalReached` é gravado no passo 6 de 22.4 e nunca sai. A meta não paga nada: o prêmio ("um lote de ingressos") é da equipe, pela loja (bloco 10) ou fora do app. O painel lista quem ganhou com `where('goalReached.seasonId', '==', <id>)` em `wallets` (índice automático de campo, sem isenção), na seção Fãs.
- Métrica `points` no anel da 1g: alvos acima de 999 não cabem no furo de 48 ("4,1 mil/5 mil" passa de 80 pt na fonte do anel). Com eles, o furo mostra a porcentagem e os números vão numa linha abaixo do título (22.12).

### 22.8 Callables do painel (contrato para o bloco 11)

No molde de 21.9: exportadas no `src/index.ts` depois do `setGlobalOptions`, com `cors: PANEL_ORIGINS`, erro `HttpsError(código, mensagem em pt-BR, { reason })` e o acesso por `readPanelActor` (lido fora e de novo na transação). Fora da equipe ativa: `not-staff`; sem a seção, ou só leitura: `no-section`. O `SECTION_LABELS` de `staff/panel-actor.ts` ganha `missions: 'Missões'` e `ranking: 'Ranking e temporadas'`.

Todas gravam um documento de `config/` do mesmo jeito: na transação, lê o documento, recusa com `config-changed` (com `details.version`, a versão de agora) quando ela não é o `expectedVersion` do pedido, valida, grava a versão `+1` com `updatedAt` e `updatedBy`, a cópia em `versions/{n}` e uma entrada em `staffAudit` (`targetEmail: ''`, `targetUid: null`, o alvo e as versões em `details`). Arquivar e trazer de volta também gravam `missionArchive/{id}` na mesma transação. Nada mudou: `{ ok: true, version }` sem gravar nem auditar. Campo errado: `invalid-request` com `details.field` (o caminho, como `mission.goal`), pelo `ConfigValidationError` da seção 9.

**Régua e temporada:**

| Callable             | Seção      | Pedido                                                                             | Resposta      | Recusas (`details.reason`)                                                |
| -------------------- | ---------- | ---------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------- |
| `updatePointsConfig` | `missions` | `{ expectedVersion, values?, dailyLimits?, actionCaps?, levels? }`                 | `{ version }` | `invalid-request`, `config-changed`, `level-in-use`                       |
| `updateSeason`       | `ranking`  | `{ expectedVersion, season: { id, name, startsAt, endsAt, leaderTitle } \| null }` | `{ version }` | `invalid-request`, `config-changed`, `season-id-locked`, `season-id-used` |

- `updatePointsConfig`: o `validatePointsConfigInput` de hoje, mais o `actionCaps` (só chaves conhecidas, inteiros de 1 a 10.000) e com `dailyLimits.mission` só `null` (outro valor: `invalid-request` com `details.field: 'dailyLimits.mission'`; hoje ele aceita de 1 a 1.000, 22.1, decisão 7). Ausente não muda. Régua com menos degraus do que uma conquista de nível não arquivada pede é recusada (`level-in-use`, com `details.achievementIds`, lendo `config/achievements` na transação; sem o documento, vale a lista padrão, `DEFAULT_ACHIEVEMENTS_CONFIG`): a conquista nunca mais seria ganha. Auditoria `points.config.updated`, com os campos mudados.
- `updateSeason`: o `validateSeasonInput` de hoje (datas em ms). `season-id-locked` quando muda o `id` de uma temporada com `startsAt` no passado; `season-id-used` quando o `id` novo já apareceu numa versão antiga (`config/season/versions` com `season.id == id`, `limit(1)`, índice automático). `season: null` encerra sem outra. Auditoria `season.updated`. A meta da temporada antiga some sozinha (decisão 9).

**Missões e meta** (admin, ou editor com `missions`):

| Callable           | Pedido                                                                                                                                | Resposta                 | Recusas                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `createMission`    | `{ expectedVersion, mission: { title, action, target, goal, period, rewardPoints, featured, startsAt, endsAt } }`                     | `{ missionId, version }` | `invalid-request`, `config-changed`, `invalid-target`, `target-not-found`, `too-many-missions`                   |
| `updateMission`    | `{ expectedVersion, missionId, changes: { title?, action?, target?, goal?, period?, rewardPoints?, featured?, startsAt?, endsAt? } }` | `{ version }`            | `mission-not-found`, `mission-locked`, `invalid-request`, `config-changed`, `invalid-target`, `target-not-found` |
| `setMissionStatus` | `{ expectedVersion, missionId, status: 'active' \| 'archived' }`                                                                      | `{ version }`            | `mission-not-found`, `invalid-status`, `too-many-active`, `too-many-missions`, `config-changed`                  |
| `reorderMissions`  | `{ expectedVersion, missionIds }`                                                                                                     | `{ version }`            | `invalid-request` (a lista não é a do catálogo, sem faltar nem sobrar), `config-changed`                         |
| `updateSeasonGoal` | `{ expectedVersion, goal: { title, description, reachedDescription, metric, target } \| null }`                                       | `{ version }`            | `invalid-request`, `config-changed`, `no-season`                                                                 |

- Nasce `draft`. O `createMission` confere o id gerado no catálogo e em `missionArchive/{id}` (uma leitura na transação); tomado, sorteia de novo os 4 caracteres.
- `setMissionStatus` com `active` publica (grava `activatedAt` na primeira vez). Com `archived`, tira a missão do catálogo (rascunho ou no ar) e a grava em `missionArchive/{id}`, com `archivedAt` e `archivedBy`, na mesma transação: ela sai do app. Com `active` num id que não está no catálogo, a callable procura no arquivo e traz a missão de volta para o fim do catálogo, já no ar, com o mesmo id, o `activatedAt` de antes e o progresso que o período ainda guardar (apaga o documento do arquivo); catálogo cheio, `too-many-missions`. O `updateMission` só acha o que está no catálogo: arquivada responde `mission-not-found` até voltar.
- Datas em ms. `startsAt` sem limite para trás; `endsAt` `null` ou depois do `startsAt`, até 366 dias depois.
- `target`: os alvos aceitos por tipo (decisão 4): fora deles, `invalid-target`, também o `join` sem central (decisão 5). O alvo precisa existir, em qualquer status (`target-not-found`), lido na transação: `posts/{id}` (e o servidor grava a central do post em `artistId`), `events/{id}` ou `artists/{id}`. Um alvo que sai do ar depois só esconde a missão aberta (22.2). Com o alvo único (post em `like` e `comment`, show em `rsvp`, central em `join`), a meta é 1 (`invalid-request` com `details.field: 'mission.goal'`, decisão 4).
- `mission-locked`: missão que já foi publicada e cujo `startsAt` passou, ou chega dentro do cache do catálogo (`startsAt <= agora + CONFIG_TTL_MS`, 60 s), não muda `action`, `target`, `goal`, `period` nem `startsAt`. Motivo: o progresso guardado mudaria de sentido no meio do período; e a `api` lê o catálogo pelo cache de 60 s, então, com a trava só no início, o período trocado nos 60 s antes dele deixava uma instância com o catálogo velho pagar `mission:<id>:<dia>` e outra, com o novo, `mission:<id>:<semana>`. Título, recompensa, destaque e `endsAt` mudam sempre (o título novo vale para as conclusões seguintes; as já pagas guardam o delas). Para outra regra, a equipe arquiva e cria outra.
- `too-many-missions` acima de `MISSIONS_MAX` (60, rascunhos e no ar); `too-many-active` ao publicar a 31ª no ar.
- `updateSeasonGoal` grava com o `seasonId` da temporada de `config/season` lido na transação; sem temporada, `no-season`. `reachedDescription` é `null` ou de 1 a 140, uma linha visível. `null` no `goal` tira a meta.
- Auditoria: `mission.created`, `mission.updated` (campos mudados), `mission.published`, `mission.archived`, `mission.reordered`, `season.goal.updated`.

**Conquistas** (admin, ou editor com `missions`):

| Callable               | Pedido                                                                         | Resposta                     | Recusas                                                                            |
| ---------------------- | ------------------------------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------- |
| `createAchievement`    | `{ expectedVersion, achievement: { title, icon, tone, rule } }`                | `{ achievementId, version }` | `invalid-request`, `config-changed`, `too-many-achievements`                       |
| `updateAchievement`    | `{ expectedVersion, achievementId, changes: { title?, icon?, tone?, rule? } }` | `{ version }`                | `achievement-not-found`, `achievement-locked`, `invalid-request`, `config-changed` |
| `setAchievementStatus` | `{ expectedVersion, achievementId, status: 'active' \| 'archived' }`           | `{ version }`                | `achievement-not-found`, `invalid-status`, `rule-not-available`, `config-changed`  |
| `reorderAchievements`  | `{ expectedVersion, achievementIds }`                                          | `{ version }`                | `invalid-request`, `config-changed`                                                |

- O primeiro `create` ou mudança parte do padrão do código quando `config/achievements` não existe: a versão 1 nasce com a lista provisória, com `activatedAt` igual ao `now` da gravação em cada `active` (a lista padrão vale desde o deploy, e sem a data a trava abaixo deixaria mudar a regra de uma conquista já ganha), e com a mudança pedida.
- `level` precisa de um degrau que existe na régua de agora, lida de `config/points` na transação (e não do cache) no `createAchievement`, no `updateAchievement` e no `setAchievementStatus` com `active`: fora dela, `invalid-request` com `details.field: 'achievement.rule.level'`. `rank` não pode ficar `active` antes do bloco 8 (`rule-not-available`).
- `achievement-locked`: a regra não muda depois da primeira publicação (`activatedAt`). Título, ícone e tom mudam sempre.
- Auditoria: `achievement.created`, `achievement.updated`, `achievement.published`, `achievement.archived`, `achievement.reordered`.

As ações novas entram no `AuditAction` de `staff/service.ts`. As callables de hoje não mudam.

**Leituras diretas do painel** (bloco 11), com as regras de 22.10: `config/missions`, `missionArchive` e `config/achievements` (e as versões) com a seção `missions`, `config/missions` e `missionArchive` também com `overview` (os títulos das conclusões na Visão geral), e os três documentos de agora (sem as versões) também com `fans` (os nomes das missões e das conquistas da carteira de um fã), por `getDoc` (um documento só, que muda pouco: escuta em tempo real cabe aqui, se a tela quiser); o arquivo em `getDocs` com `orderBy('archivedAt', 'desc')` (índice automático); a régua e a temporada como hoje (equipe ativa); as conclusões por missão e por dia nos shards (`statsDaily`, que a seção `missions` passa a ler). O progresso, as conquistas e a meta cumprida de um fã estão na carteira dele, que a seção Fãs já lê, e quem bateu a meta sai da consulta por `goalReached.seasonId` (22.7).

**Falta para as telas do bloco 11: a versão 0.** Sem o documento, o servidor usa o padrão do código: em produção, `config/achievements` não existe até a primeira mudança (as 9 conquistas valem pelo `DEFAULT_ACHIEVEMENTS_CONFIG`, e o app mostra "0 de 9"), e o mesmo vale para `config/points` (`DEFAULT_POINTS_CONFIG`). Lendo o documento direto, o painel veria o catálogo vazio e não teria os ids (`boca-a-boca`...) para o `updateAchievement` e o `setAchievementStatus`. Copiar a lista padrão para o painel duplicaria a fonte. Antes das telas, uma das duas, com o ok do dono: uma carga única que grava a versão 1 de `config/achievements` (e de `config/points`) com o padrão do código, no molde do `seedMissionsCatalog` (com `activatedAt` nas ativas), rodada no deploy como a `backfill-signups.mjs`; ou uma callable de leitura que devolva os catálogos efetivos. Proposta: a carga, que mantém o painel lendo o Firestore direto, como o resto.

### 22.9 Efeitos no painel e agregados

- **Agregados** (`statsShards`, seção 7): `byMission[missionId].completed` e `byAchievement[achievementId].unlocked`, somados no mesmo shard do plano (continua uma gravação de shard por transação; contador zerado não é gravado). Os pontos das missões já entram em `bySource.mission` e em `byArtist[id].bySource.mission` (as de link e de convite, fora das centrais). São fluxo: a exclusão de conta não desconta. Isenção de índice para os dois mapas.
- **Missões** (bloco 11): a lista do catálogo com status, janela, destaque e ordem, as arquivadas (`missionArchive`), as callables de 22.8, a meta da temporada e as conclusões por missão e por dia (os shards). "Ativas, agendadas e encerradas" (o subtítulo da seção no painel) sai do status e da janela: `active` com `startsAt` no futuro é agendada; `endsAt` no passado ou no arquivo, encerrada.
- **Régua** (bloco 11, na mesma seção): valores, limites, tetos e níveis por `updatePointsConfig`.
- **Ranking e temporadas** (bloco 11): a temporada por `updateSeason`.
- **Fãs** (bloco 11): o progresso do período, as conquistas e a meta cumprida de um fã, na carteira, e a lista de quem bateu a meta da temporada.
- **Visão geral**: missões concluídas por dia, pelos shards, com os títulos do catálogo e do arquivo.
- **Nenhuma mudança no código do painel** neste bloco.

### 22.10 Regras e índices

Acréscimo ao `firestore.rules`, depois do `match /config/{docId}` de hoje, que não muda. Duas regras que casam o mesmo documento somam: o `match` genérico continua negando esses ids, e o novo libera a seção.

```
    // Catálogo de missões, meta da temporada, missões arquivadas e catálogo de
    // conquistas (bloco 7). A seção missions lê tudo; a Visão geral lê o
    // catálogo e o arquivo das missões, pelos títulos das conclusões; a seção
    // Fãs lê os catálogos de agora e o arquivo (não as versões), para dar nome
    // aos ids do progresso e das conquistas na carteira de um fã. Nenhum deles
    // guarda dado de fã. Muda só por callable, com auditoria. O app recebe
    // tudo pela API.
    match /config/missions {
      allow read: if canSeeSection('missions') || canSeeSection('overview')
        || canSeeSection('fans');
      allow write: if false;

      match /versions/{version} {
        allow read: if canSeeSection('missions') || canSeeSection('overview');
        allow write: if false;
      }
    }

    match /missionArchive/{missionId} {
      allow read: if canSeeSection('missions') || canSeeSection('overview')
        || canSeeSection('fans');
      allow write: if false;
    }

    match /config/achievements {
      allow read: if canSeeSection('missions') || canSeeSection('fans');
      allow write: if false;

      match /versions/{version} {
        allow read: if canSeeSection('missions');
        allow write: if false;
      }
    }
```

O `match /statsDaily/{day}` de hoje, e o `statsShards` dentro dele, ganham a seção `missions` (as conclusões por missão e por dia da tela Missões):

```
    match /statsDaily/{day} {
      allow read: if canSeeSection('overview') || canSeeSection('growth')
        || canSeeSection('missions');
      allow write: if false;

      match /statsShards/{shard} {
        allow read: if canSeeSection('overview') || canSeeSection('growth')
          || canSeeSection('missions');
        allow write: if false;
      }
    }
```

O progresso, as conquistas e a meta cumprida estão em `wallets/{uid}`, que só a seção `fans` lê, e o fã não lê nem a própria (seção 11). A carteira guarda só os ids das missões (`missions.daily.items`) e das conquistas (`achievements`): por isso a seção `fans` lê também o catálogo de agora, o arquivo e o catálogo de conquistas, sem as versões. O `config/points` e o `config/season` continuam legíveis pela equipe ativa.

Índices: nenhum composto novo. Isenções em `firestore.indexes.json` (ninguém consulta, e mapas com chaves soltas gerariam uma entrada por chave):

```json
{ "collectionGroup": "wallets", "fieldPath": "missions", "indexes": [] },
{ "collectionGroup": "wallets", "fieldPath": "achievements", "indexes": [] },
{ "collectionGroup": "wallets", "fieldPath": "seasonMissions", "indexes": [] },
{ "collectionGroup": "statsShards", "fieldPath": "byMission", "indexes": [] },
{ "collectionGroup": "statsShards", "fieldPath": "byAchievement", "indexes": [] },
{ "collectionGroup": "config", "fieldPath": "missions", "indexes": [] },
{ "collectionGroup": "config", "fieldPath": "achievements", "indexes": [] },
{ "collectionGroup": "versions", "fieldPath": "missions", "indexes": [] },
{ "collectionGroup": "versions", "fieldPath": "achievements", "indexes": [] }
```

O `goalReached` fica sem isenção, porque a seção Fãs consulta `goalReached.seasonId` (índice automático). A consulta do `season-id-used` (`season.id` em `config/season/versions`) usa o índice automático, que a isenção do `versions.missions` não toca. O arquivo é listado por `archivedAt`, também com o índice automático.

### 22.11 Exclusão de conta

Nenhum passo novo no `deleteUserData`. O progresso das missões, o `seasonMissions`, o `goalReached` e as conquistas moram em `wallets/{uid}`, que o passo da carteira já apaga inteira (`recursiveDelete`), junto com os lançamentos de missão do extrato. O perfil sai antes (19.12): uma ação que já tinha lido o perfil grava antes, e a carteira leva o que ela gravou; uma depois recusa no `requireFan`.

O que fica de propósito: no progresso de quem convidou, a unidade que a pessoa excluída contou (só o `current`; a chave da pessoa nunca é guardada no progresso, 22.4); no marcador de quem convidou, o `signupAt` (o marcador já ficava, 20.10, e é ele que impede a conta recriada de contar de novo); nos shards, as conclusões e os desbloqueios (fluxo, seção 12). O catálogo e o arquivo não mudam e não guardam nada de fã.

O `functions/src/store.test.ts` não muda de ordem. O teste de emulador confere que, depois do `deleteUserData`, o `GET /missions` e o `GET /me/achievements` da mesma conta (com o token ainda válido) respondem tudo em 0.

### 22.12 App

**Seletor e consultas**

- `SERVER_DOMAINS` ganha `missions` e `achievements`, no commit que entrega as rotas.
- `useMissionsQuery`, `useDailyMissionQuery` e `useMissionQuery` espalham `queryOptionsFor('missions')`; `useMyAchievementsQuery`, `queryOptionsFor('achievements')`.
- `useLedgerInfiniteQuery`, novo em `profile/queries.ts`: chave `profileKeys.ledger()`, debaixo de `profileKeys.wallet()` (quem invalida a carteira invalida o extrato), `fetchLedgerPage({ cursor })`, `getNextPageParam` pelo `nextCursor` e `queryOptionsFor('wallet')`.
- O `QUERY_CACHE_VERSION` não sobe: os formatos salvos só ganham campos opcionais e um valor novo de `action`.

**Tipos**

- `MissionAction` ganha `join`. `MISSION_ICONS.join`: `UserPlus` do lucide, tom `action`. `missionHref` do `join`: a central do alvo (`/artista/[artistaId]`), que o servidor sempre manda (decisão 5); sem ela, `null`, como a concluída. `missionHint`: `missions.hint.artist`. A meta é a de progresso.
- `ActionRewards` (com o `missionsChanged`), `CompletedMission` e `UnlockedAchievement` em `missions/types.ts`, exportados pelo index, com os campos opcionais. `PointsAward` (posts), `RsvpResult` (agenda), `JoinCentralResult` e `FollowArtistsResult` (artists) estendem `ActionRewards` por `import type`, sem ciclo em tempo de execução (o `missions` não importa nenhum domínio).
- `LedgerEntry` em `profile/types.ts`, com `artistName?` e `subjectTitle?`.

**Recompensa na hora da ação**

- `describeRewards(points, rewards)`, puro, novo em `missions/describe-rewards.ts` e exportado pelo index: a frase única do anúncio e o toque. Frase: "Mais 21 pontos." mais uma frase por missão ("Missão concluída: Curta 5 posts do Nenho."), a do nível (`profile.level.up`, "Você subiu para o nível 8, Xodó.") e uma por conquista ("Conquista nova: Fã de show."). Toque: `levelUp` com subida de nível, senão `missionComplete` com missão concluída, senão `pointsEarned` (o padrão da tabela de haptics: um evento, um toque).
- `PointsToast` ganha `haptic?: HapticEvent` (padrão `pointsEarned`). O "+N" do curtir (`PostActions`), do comentar (`comment-composer`, que já junta "Comentário enviado" ao ganho), do "Eu vou" (`rsvp-button`) e do entrar (`artist-actions`) passam a frase e o toque do `describeRewards`. O "+N" já é o `pointsAwarded`, que inclui a missão.
- Sem pontos e com conquista (a primeira presença com o "Eu vou" valendo 0), o hook da ação anuncia só a conquista, na fila, sem toast.
- Para a festa não sair duas vezes: `noteMissionCelebrated(missionId, completedAt)` (`missions/celebrated.ts`) e `noteLevelCelebrated(uid, number)` (`profile/level-celebrated.ts`, importado direto, fora do index, como o `profile/keys`), em memória. Quem anunciou na hora marca. O `useMissionCelebrations` da 1g, o `useCompletionPulse` da missão do dia e o `useLevelUp` da 1e continuam com o desenho deles (o check, o "+N", o selo que acende), mas pulam o toque e o anúncio do que já foi marcado. O que concluiu sem o fã ver (a missão de link de quem convidou, a subida num claim ou depois de a equipe mudar a régua) festeja como hoje, quando ele abre a tela.

**Invalidação depois de cada ação**

- Curtir, comentar e "Eu vou": as missões buscam de novo quando a resposta traz `missionsChanged: true`, e sempre quando o campo não vem (as fixtures, que seguem como hoje); com pontos, carteira (com progresso e extrato), ranking e centrais (como hoje); com `unlockedAchievements` ou `levelUp`, também `profileKeys.achievements()`.
- Entrar na central (`refreshAfterJoin`) e seguir na 1l (`useFollowArtistsMutation`): passam a invalidar `missionKeys.all` (importado de `@/domains/missions`) pela mesma regra, além do que já invalidam, e as conquistas na mesma regra de cima.
- Sair da central (`useLeaveCentralMutation`): invalida `missionKeys.all` sempre, porque a missão `join` daquela central, escondida de quem é membro, volta (como o desfazer do "Eu vou" e o descurtir, que já buscavam as missões de novo).
- O "+N" do "Eu vou" só sobe no botão do show que respondeu: o `RsvpButton` mora em células da FlashList, que passam de um show para outro com o hook montado, e a resposta que chega com a célula mostrando outro show não festeja nem marca nada (a 1g festeja quando o fã voltar a ela).
- Missão vencida (`isMissionOver`): a aberta no `endsAt`, a concluída no fim do período (o `endsAt` que o servidor manda nela, 22.2). A concluída de ontem sai da 1b e de "Hoje" depois da meia-noite, também com o app aberto na virada e aberto do cache sem rede, e o `useDailyMission` e a 1g buscam a do período novo. As fixtures mandam a concluída com o fim do período, como o servidor.
- Puxar para atualizar a 1e busca também o extrato aberto, pela chave da carteira.

**Telas**

- **1b (missão do dia)** e **1g**: sem mudança de desenho com a métrica `missions` (a do seed): o servidor manda o que as fixtures mandavam. Com a métrica `points` e alvo acima de 999 (22.7), o `SeasonGoalCard` mostra no furo do anel a porcentagem, arredondada para baixo ("82%"), e ganha abaixo do título a linha "4,1 mil de 5 mil pontos" (`formatCompact`), antes do texto; o rótulo do leitor de tela leva os números inteiros.
- **1d (aba Missões)**: o `missionsOfArtist` já filtra por `target.artistId`; entra o `join`, sempre com a central.
- **Sheet "Gerar meu link"**: missão `share` com alvo de central passa `artistId` (o `inviteHref` manda `{ missionId, artistId }` quando não há post), e a sheet monta o link da central (`artist:<id>`, o mesmo do compartilhar da 1d).
- **1e**: as conquistas vêm do servidor ("5 de 9" na Camila do seed). O card de pontos vira tocável e abre o extrato: `Card` com `onPress` (`router.push('/extrato')`), haptic `tap`, papel de botão (sai o `progressbar`), o mesmo rótulo de hoje e a dica `profile.points.hint` ("Abre o extrato de pontos."). Nada dentro dele é tocável (regra do workspace).
- **Extrato (`/extrato`, provisório)**, abaixo.

**Tela do extrato** (sem desenho; visual da 1g)

- Rota `src/app/(tabs)/(perfil)/extrato.tsx`, só com o `export default` de `LedgerScreen`, de `@/domains/profile` (`views/ledger.tsx`). Na pilha do Perfil, com a tab bar.
- `LargeTitleHeader` com o voltar (aprovação de 29/09), título "Extrato" e subtítulo "Os pontos que entraram e saíram da sua carteira.".
- Uma `FlashList` com dois tipos de célula (`getItemType`): a sobrelinha do dia (`SectionLabel`: "Hoje", "Ontem", ou a data, "sex., 3 out", pelo `@/utils/date`, no fuso do aparelho) e a linha do lançamento.
- Linha (`components/ledger-row.tsx`, uma `ListRow` não tocável): `IconTile` com o ícone e o tom da origem; título pela origem; abaixo, o contexto e a hora ("Curta 5 posts do Nenho · 22:31"); à direita, o valor com `formatPointsDelta`, em lima no ganho e no texto padrão no resgate e no ajuste negativo. Um elemento só para o leitor de tela: "Missão concluída, Curta 5 posts do Nenho, mais 10 pontos, hoje às 22:31.".

  | `source`        | Título                 | Contexto                            | Ícone e tom           |
  | --------------- | ---------------------- | ----------------------------------- | --------------------- |
  | `like`          | Curtida                | a central                           | `Heart`, ação         |
  | `comment`       | Comentário             | a central                           | `MessageCircle`, ação |
  | `rsvp`          | Presença em show       | a central                           | `Ticket`, shows       |
  | `central_join`  | Entrada na central     | a central                           | `UserPlus`, ação      |
  | `mission`       | Missão concluída       | o título da missão (`subjectTitle`) | `Flame`, pontos       |
  | `invite_visit`  | Visita pelo seu link   | nenhum                              | `Users`, pontos       |
  | `invite_signup` | Cadastro pelo seu link | nenhum                              | `Users`, pontos       |
  | `redeem`        | Resgate                | nenhum (bloco 10)                   | `Gift`, ação          |
  | `adjustment`    | Ajuste da equipe       | nenhum (a nota fica de fora)        | `Award`, pontos       |
  | `seed`          | Ajuste                 | nenhum                              | `Award`, pontos       |
  | outra           | Pontos                 | nenhum                              | `Award`, pontos       |

- Linha com `points`, `xpDelta` e `seasonDelta` em 0 (o ajuste só de central, que só o seed e o `adjustFanPoints` fazem) não aparece. Página que não acrescenta linha visível e ainda tem `nextCursor` pede a seguinte sozinha, uma vez por página, com `cancelRefetch: false` (como os comentários com bloqueados, 21.13).
- Fim da lista: `fetchNextPage({ cancelRefetch: false })`. Puxar para atualizar com o toque `refresh` e o indicador lima, como na 1g. Vazio: "Seus pontos aparecem aqui quando você curte, comenta, entra numa central ou conclui uma missão.". Erro sem lista: o `EmptyState` com "Tentar de novo"; com lista, o aviso no pé, anunciado com a tela em foco, como a 1g. A página seguinte que falha tem aviso próprio ("Não deu para carregar mais lançamentos."), como a agenda e o ranking: o "Tentar de novo" dele busca só ela (`fetchNextPage`, e não o `refetch`, que buscaria de novo as já carregadas) e anuncia "Mais lançamentos carregados.", e o fim da lista não insiste sozinho depois da falha.
- Fixtures (`buildLedgerPageFixture(now, cursor)`, em `profile/fixtures.ts`): os lançamentos do seed da Camila (22.13), com os mesmos ids, valores, títulos e dias relativos a `fixtureNow()`, em páginas de 20. O que o fã ganha na sessão das fixtures não entra (limite aceito: é exemplo).
- Provisória: entra nas Pendências do `CLAUDE.md`, para a cliente validar o que a tela mostra.

**Fixtures das missões** (a regra de coerência pede que contem como o servidor)

- `missionsFixture.record(action, now, on)`, com `on: { artistId?, postId?, eventId? }`, anda todas as missões abertas que casam (como as candidatas do servidor, e não só a primeira do tipo), pelo alvo da decisão 5, e cada uma guarda em memória os posts e shows que já contou no período, como o `keys`: comentar três vezes no mesmo post conta um.
- `countsFor` confere o `postId` e o `eventId` do alvo, além da central: o "Eu vou" em outro show não anda a "Confirme presença em um show".
- Quem chama: curtir, na troca para curtido (não mais só na primeira curtida do post na sessão), com o `postId` e a central; comentar, com o `postId` e a central; o "Eu vou", com o `eventId`.
- Os posts de exemplo ganham `p-nenho-4` e `p-nenho-5` (os mesmos do seed, 22.13), já curtidos pelo fã (`likedByMe: true`): são as duas curtidas do "2 de 5" da "Curta 5 posts do Nenho", e os três outros posts do Nenho continuam fechando a missão.
- O resto fica: nas builds sem API, a demonstração é a de hoje.

**Regra de coerência** (seção 13): com o emulador, as missões e as conquistas vêm do servidor, e toda ação de verdade anda missão. O `missionsFixture.record` continua só nos caminhos das fixtures. No commit do bloco, a frase "As missões seguem de exemplo até o bloco 7" sai do `CLAUDE.md`, e a nota de 21.13 ganha a remissão a esta seção.

**O que é de verdade e o que é de exemplo** (desenvolvimento com emulador, do bloco 7 ao 8)

| Número ou lista                             | Telas            | Fonte no bloco 7                    |
| ------------------------------------------- | ---------------- | ----------------------------------- |
| Missões, progresso e missão do dia          | 1g, 1b, 1d       | servidor                            |
| Recompensa de missão no "+N" e nos anúncios | 1b, 1d, post, 1m | servidor                            |
| Meta da temporada                           | 1g               | servidor                            |
| Conquistas e "X de N"                       | 1e               | servidor (lista provisória)         |
| Subida de nível                             | ação, 1e         | servidor                            |
| Extrato                                     | extrato          | servidor                            |
| Ranking e top fãs                           | 1f, 1d           | exemplo, com o aviso, até o bloco 8 |

**Textos novos** (`translations.json`)

- `missions.rewards.mission`: "Missão concluída: {{title}}."; `missions.rewards.achievement`: "Conquista nova: {{title}}."
- `missions.season.pointsMeta`: "{{done}} de {{total}} pontos"
- `profile.points.hint`: "Abre o extrato de pontos."
- `ledger.title`: "Extrato"; `ledger.subtitle`: "Os pontos que entraram e saíram da sua carteira."
- `ledger.sources.like`: "Curtida"; `.comment`: "Comentário"; `.rsvp`: "Presença em show"; `.central_join`: "Entrada na central"; `.mission`: "Missão concluída"; `.invite_visit`: "Visita pelo seu link"; `.invite_signup`: "Cadastro pelo seu link"; `.redeem`: "Resgate"; `.adjustment`: "Ajuste da equipe"; `.seed`: "Ajuste"; `.other`: "Pontos"
- `ledger.days.today`: "Hoje"; `ledger.days.yesterday`: "Ontem"
- `ledger.rowMeta`: "{{context}} · {{time}}"; `ledger.rowLabel`: "{{title}}, {{context}}, {{points}}, {{when}}."; `ledger.rowLabelNoContext`: "{{title}}, {{points}}, {{when}}."
- `ledger.empty`: o texto do vazio, acima; `ledger.loading`: "Carregando o extrato"; `ledger.loadError`: "Não deu para carregar o extrato."; `ledger.updateError`: "Não deu para atualizar o extrato."; `ledger.moreError`: "Não deu para carregar mais lançamentos."; `ledger.loaded`: "Extrato carregado."; `ledger.moreLoaded`: "Mais lançamentos carregados."

**`CLAUDE.md` e `AGENTS.md`**

No mesmo commit: Estrutura (`functions/src/day.ts`, `missions`, `achievements`, `points/panel.ts`; a rota `extrato`), Dados (missões e conquistas no seletor; a regra de coerência sem a exceção das missões; as recompensas na resposta e o `missionsChanged`; as duas curtidas da Camila no seed), Navegação (o extrato na pilha do Perfil), Acessibilidade (o card de pontos tocável), API do app e pontos (as rotas, os campos novos, o `missionArchive` e as callables do bloco 7, e o `updateSeason` antecipado), Testes e Pendências (extrato provisório, lista provisória de conquistas e as perguntas de 22.15). O `AGENTS.md` recebe a mesma cópia, com o cabeçalho dele.

Nada disso entra no fingerprint da EAS: só JavaScript, regras e funções. Nenhuma dependência nova (o `keyDigest` usa o `node:crypto`).

### 22.13 Seed dos emuladores

`functions/src/missions/seed.ts` exporta `SEED_MISSIONS`, `SEED_SEASON_GOAL` e `seedMissionsCatalog(db, now)`, que grava `config/missions` (versão 1, com a cópia em `versions/1`) se ele não existir, pelo mesmo núcleo das callables, sem auditoria. As conquistas não são gravadas: valem as do padrão do código (22.6), e o seed as exercita. O `scripts/seed-emulators.mjs` carrega `functions/lib/missions` como carrega os outros.

Catálogo provisório, o das fixtures de hoje sem a relâmpago, todos `active`, com `startsAt` 1 dia antes do seed e `endsAt` `null`:

| id                   | Título                                    | Tipo      | Alvo                          | Meta | Período  | Recompensa | Destaque |
| -------------------- | ----------------------------------------- | --------- | ----------------------------- | ---- | -------- | ---------- | -------- |
| `m-clipe-netto`      | Leve 5 pessoas para o clipe novo do Netto | `share`   | post `p-clipe` (`nettobrito`) | 5    | `daily`  | 20         | sim      |
| `m-curtir-nenho`     | Curta 5 posts do Nenho                    | `like`    | central `nenho`               | 5    | `daily`  | 10         | não      |
| `m-comentar-central` | Comente em 3 posts da central             | `comment` | central `nettobrito`          | 3    | `daily`  | 20         | não      |
| `m-trazer-amigos`    | Traga 3 amigos novos pro app              | `invite`  | nenhum                        | 3    | `weekly` | 30         | não      |
| `m-presenca-show`    | Confirme presença em um show              | `rsvp`    | show `sao-joao-irara`         | 1    | `weekly` | 15         | não      |

Meta: `{ seasonId: 'temporada-sao-joao', title: 'Semana do arrocha', description: 'Complete 20 missões e garanta um lote de ingressos do São João.', reachedDescription: 'Meta cumprida: seu lote de ingressos do São João está garantido.', metric: 'missions', target: 20 }`.

**Carteira da Camila** (muda a tabela da seção 14). Para a meta dar 12 de 20 pelo extrato, entram 8 lançamentos de missão antes da semana, sem central, e a base desce o mesmo tanto. Os totais não mudam:

| Quando             | Lançamento                                                  | Saldo e XP | Temporada | Central                    |
| ------------------ | ----------------------------------------------------------- | ---------- | --------- | -------------------------- |
| 17 a 10 dias atrás | `mission:seed-camila-5` a `-12` (earn, 50 cada, um por dia) | +400       | +400      |                            |
| 8 dias atrás       | `seed:camila-base` (adjust)                                 | +11.240    | +2.880    |                            |
| 8 dias atrás       | `seed:camila-base-netto` e `-nenho`, como hoje              |            |           | Netto +3.620, Nenho +2.640 |
| 6 a 1 dia atrás    | `mission:seed-camila-1` a `-4`, como hoje                   | +840       | +840      | Netto +500, Nenho +340     |
| total              |                                                             | 12.480     | 4.120     | Netto 4.120, Nenho 2.980   |

- Os 8 novos rodam antes da base, em ordem de data. Ficam fora dos 7 dias, então o "+840" não muda, e dentro da temporada (que começou 18 dias atrás): o `seasonMissions` termina em 12.
- Os 12 lançamentos de missão levam título (o `subjectTitle` do extrato): os 8 novos, "Leve 5 pessoas para o clipe novo do Netto"; os de hoje, "Comente em 3 posts da central" nos do Netto e "Curta 5 posts do Nenho" nos do Nenho.
- O `seedCamilaWallet` passa a carregar a configuração inteira (`createConfigSource(db, { ttlMs: 0 })`) e a passar o `game` ao `runAward`. Com as conquistas do padrão, a Camila ganha "Missão cumprida" 17 dias atrás (o primeiro lançamento de missão) e "Pé de serra", "Sanfona" e "Purainha" 8 dias atrás (a base leva o XP de 400 a 11.640, nível 7).
- O extrato dela passa de 7 para 15 lançamentos.

**Ordem do seed**, para o progresso sair das próprias ações (as mudanças em negrito):

1. Centrais, shows e posts, como hoje, **mais `p-nenho-4` e `p-nenho-5`** (os mesmos das fixtures, 22.12, no ar, publicados 15 e 16 dias atrás: ficam no fim do mural e da grade do Nenho).
2. Contas: Camila (carteira, centrais, código e links), Alan, Bia, Duda, Enzo e **Gabi Souza** (`gabi@teste.imagineup`, `fa-de-teste-6`, nova, só para visitar).
3. **Claims da Duda (link da central) e do Enzo (código digitado), antes do catálogo de missões.** Com as conquistas do padrão já valendo, o claim da Duda dá à Camila o "Boca a boca" (a primeira pessoa pelo link). Nenhuma missão anda: o catálogo ainda não existe.
4. **`seedMissionsCatalog`.**
5. **Claim da Bia (link do clipe, com a campanha).** Anda "Leve 5 pessoas" (1) e "Traga 3 amigos" (1).
6. **Visitas do Alan e da Gabi ao link do clipe** (`/post/p-clipe`, código `CAMILA12`), pelo mesmo `recordInviteVisit` da rota (`runVisit`, novo em `invites/service.ts`, no molde do `runClaim`), com ator de sistema e o `SEED_INVITE_CONFIG` (convite valendo 0). Cada uma cria o marcador e anda "Leve 5 pessoas": 3 de 5.
7. **Curtidas da Camila em `p-nenho-4` e `p-nenho-5`**, pelo `runLikePost` da rota, com ator de sistema, o `SEED_ENGAGEMENT_CONFIG` (curtir vale 0: nenhum lançamento) e o `game`: "Curta 5 posts do Nenho" fica em 2 de 5, como no protótipo, e a carteira só ganha o progresso.
8. Engajamento dos fãs de teste, como hoje, com `NO_GAME`: as curtidas, os comentários e as presenças dos fãs de teste não andam missão nem desbloqueiam conquista, e o Alan continua sem carteira (21.14).

Os claims, as visitas e as curtidas da Camila usam a configuração do jogo lida na hora (`createConfigSource` sem cache), então a ordem é o que decide. O `seedInviteClaims` passa a receber a lista de convidados de cada passo, e a contagem do bloco 5 muda pouco: 3 cadastros convidados e, agora, 5 visitas no shard do dia (3 pelo tipo `post`, da Bia, do Alan e da Gabi, 1 `artist`, da Duda, e 1 `code`, do Enzo). As visitas vão pelo `seedInviteVisits(db, visitors, now)`, novo em `invites/seed.ts`, e as curtidas da Camila por `seedCamilaLikes(db, uid, now)`, novo em `posts/seed.ts`. O 21.14 muda num ponto: a Camila passa a ter essas duas curtidas (nenhum ponto), e continua sem comentar e sem ir a show.

Resultado na Camila: 1b com "Leve 5 pessoas para o clipe novo do Netto", 3/5, +20; 1g com "Semana do arrocha" 12/20, "Curta 5 posts do Nenho" 2 de 5, "Comente em 3 posts da central" 0 de 3, "Traga 3 amigos novos pro app" 1 de 3 cadastrados e "Confirme presença em um show" com o São João de Irará; 1e com a carteira de sempre (12.480, nível 7, "+840") e "5 de 9" conquistas (Boca a boca, Purainha e Sanfona, e a próxima, Backstage, bloqueada); extrato com 15 lançamentos. A Duda, que já vai ao São João, não vê a missão de presença (decisão 4).

Diferença do protótipo, de propósito: "Comente em 3 posts da central" começa aberta (no protótipo, concluída às 14:02: concluir no seed pagaria +20 e mudaria a carteira). Para ver uma conclusão no emulador com a Camila: as três curtidas que faltam nos posts do Nenho (+10 na terceira), três comentários em posts diferentes do Netto (+2 cada e +20 na terceira), o "Eu vou" no São João de Irará (+15), ou duas visitas novas ao link do clipe (+20 para ela).

Rodar de novo não muda nada: o catálogo existe, os claims respondem `already_claimed`, os marcadores das visitas existem (sem tick), as curtidas da Camila já estão curtidas (sem troca, sem tick), e os lançamentos do seed voltam `duplicate`. Depois da meia-noite, o progresso do dia volta a 0, como o de qualquer fã, e rodar o seed de novo não o devolve, pelos mesmos motivos: para ver de novo o 3 de 5 e o 2 de 5, feche os emuladores (os dados somem) e rode o seed outra vez.

### 22.14 Testes

Funções, testes puros (`vitest`, relógio fixo):

- `day.test.ts`: os testes de `dayKey`, `weekKey` e `nextDayStart` que hoje estão em `points/model.test.ts`, mais `nextWeekStart` (domingo 23:59 e segunda 0:00 de São Paulo; a virada do ano ISO).
- `missions/model.test.ts` (tabela): `parseMissionsConfig` (missão fora do formato descartada, as outras ficam; `archived` no catálogo é fora do formato; meta inválida vira `null`; documento ausente é catálogo vazio); `validateMissionInput` (cada campo, os alvos aceitos por tipo, o `join` sem central, a meta 1 no alvo único, os limites); `missionIndex` e `candidateMissions` (tipo, janela, `draft` fora; o alvo de post compara só o `postId`, e o tick do link de post sem central casa com ele; o de show, o `eventId`; o de central, a central na lista do tick; cada alvo casando e não casando); `periodOf` e o fim (o menor entre `endsAt` e o fim do período, perto da meia-noite e na virada da semana); `rollMissions` (chave anterior zera; chave posterior fica e descarta os ticks do período velho, no dia e na semana); `applyMissionTicks` (conta, conclui na meta e gera o lançamento com o `eventId`, o título e a central certos, `null` em `share` e `invite`; concluída não anda; o `keyDigest` em `keys` barra a repetição no período nas quatro ações do fã; a virada de dia e de semana zera sem gravar); `keyDigest` (12 caracteres, estável); `missionsView` (progresso só com a chave do período de agora; a concluída fica depois do `endsAt` até o fim do período; o destaque é a primeira visível de cada período, aberta ou concluída, também na semanal; alvo invisível esconde a aberta e não a concluída; o alvo único já feito esconde a aberta; `pointsBreakdown` só no `share`; `rewardPaid` na concluída e a recompensa do catálogo com `rewardPaid` 0; `event` do show).
- `achievements/model.test.ts` (tabela): `parseAchievementsConfig` e `validateAchievementInput`; `unlockAchievements` (nível alcançado de uma vez destrava os de baixo; `first` de cada tipo; `first:mission`; o que já tem não muda de data; a de nível que o XP lido já alcançava entra com a data do `updatedAt` e fora do anúncio; `rank` nunca antes do bloco 8; arquivada não desbloqueia); `achievementsView` (contagem só das ativas, com a de nível que já vale pelo XP; 3 desbloqueadas da mais nova à mais velha, com o desempate de trás para frente; a primeira bloqueada é a de nível seguinte, depois a ordem do catálogo, até 4; fã novo).
- `points/model.test.ts`: `computeAwards` com ticks (o lançamento da missão depois dos da rota e somado no `pointsAwarded`; `seasonMissions` sobe só com temporada ativa e zera na troca; `goalReached` marcado ao chegar no alvo, nas duas métricas, uma vez só, também depois de o alvo baixar, e que fica com a conta caindo; carteira gravada quando só o progresso, só uma conquista ou só a meta mudou; nada mudou, nada gravado; outro fã sem perfil ignora os ticks; tick de período velho descartado; `rewards` de quem chama com a subida de nível pela régua do pedido, inclusive duas subidas de uma vez, e o `missionsChanged`).
- `points/config.test.ts`: `actionCaps` na leitura tolerante e na validação estrita; `dailyLimits.mission` recusado na validação e forçado em `null` na leitura; a fonte lê os quatro documentos num `getAll`.
- `points/award.test.ts`: o `planAwards` com ticks lê o extrato e a central só das missões que vão concluir para quem chama, e de todas as candidatas para outro fã; `rewardsOf`; o `title` obrigatório na entrada de missão.
- `points/stats.test.ts`: `byMission` e `byAchievement`, e o `pruneZeros` deles.
- `moderation/model.test.ts` e os testes das centrais e do convite: os tetos lidos da configuração, com o padrão igual às constantes de hoje.
- Carga dos módulos: o `missions/model.ts` e o `achievements/model.ts` carregam sem o `points/model.ts` em tempo de execução (só `import type`).
- `api/router.test.ts`: `/missions` e `/missions/daily` não se confundem; `POST /missions` é 405; `/me/achievements` e `/me/ledger` convivem com as rotas de `me`.
- `api/index.test.ts`: os quatro campos de recompensa nas respostas das ações, também na resposta repetida; o `DELETE` da curtida e o do "Eu vou" sem eles; o extrato com `artistName` e `subjectTitle`.

Funções nos emuladores (a `api` de verdade por HTTP, tokens do emulador de Auth, relógio fixo injetado no handler do processo do teste quando a virada importa):

- `functions/test/missions.emulator.test.ts` (novo): catálogo vazio responde listas vazias e `mission: null`; com o catálogo do seed, a 1g da Camila como em 22.13; curtir os 3 posts do Nenho que faltam conclui na terceira, paga 10 na mesma resposta (`pointsAwarded`, `completedMissions` e `missionsChanged`), grava `mission:m-curtir-nenho:<dia>` com o título; descurtir e curtir de novo no mesmo dia não anda, e no dia seguinte anda; comentar 3 vezes no mesmo post anda 1, em 3 posts conclui; o "Eu vou" em outro show não anda a de presença, no São João conclui e paga 15 com o "Eu vou" valendo 0, e na semana seguinte a missão some para ela (já vai), como para a Duda; entrar numa central anda o `join`, sair e entrar de novo no mesmo dia não; claim e visita pelo link do clipe andam o `share` de quem convidou, e a quinta pessoa paga 20 a quem convidou, sem central e sem mudar o `pointsAwarded` de quem chama; o link de um post do Netto anda uma missão de link com a central do Netto como alvo; o código digitado anda só o `invite`; a conta recriada com o mesmo e-mail não anda o `invite` de novo, também com o `invite_signup` valendo 0 e com o limite do dia de quem convidou atingido; quem visitou antes e se cadastra depois anda o `invite` (o marcador ganha `signupAt`); a mesma chave devolve a mesma resposta, sem contar de novo; duas curtidas em paralelo que fecham a meta pagam uma vez; a virada da meia-noite zera o progresso do dia e a de segunda, o da semana; com a ordem invertida perto da virada (o pedido de 23:59:59,950 gravando depois do de 00:00:00,010), o progresso do período novo fica e o tick do velho não conta, no dia e na semana; missão em `draft`, arquivada ou fora da janela não conta; alvo fora do ar esconde a aberta e mantém a concluída; a concluída fica depois do `endsAt` até o dia virar; o destaque é a primeira visível, e a destacada concluída continua destacada; a meta da temporada por missões e por pontos, o `goalReached` ao chegar no alvo (e a consulta por `goalReached.seasonId`), o `reachedDescription` com a meta cumprida e, sem temporada ativa, `null`.
- Conquistas, no mesmo arquivo: a primeira presença dá "Fã de show" e manda `unlockedAchievements` com o "Eu vou" valendo 0; a primeira pessoa pelo link dá "Boca a boca" a quem convidou; um lançamento que cruza o nível 8 manda `levelUp` e destrava "Backstage"; baixar o `minXp` do nível 8 na configuração mostra "Backstage" no `GET /me/achievements` na hora, com a data do `updatedAt`, e a ação seguinte a grava com a mesma data, sem `levelUp` nem `unlockedAchievements`; `GET /me/achievements` com "X de N" e os destaques (a de nível seguinte primeiro).
- Exclusão: fã com progresso, conquistas e meta cumprida; depois do `deleteUserData`, a carteira não existe, e as rotas de leitura respondem tudo em 0; o progresso de quem convidou não guarda a pessoa.
- Extrato: a página com `artistName` e `subjectTitle`, com a central apagada (`null`) e com o título da missão mantido depois de ela mudar de título e ir para o arquivo.
- Seed: o catálogo, os 15 lançamentos (com os títulos) e a carteira da Camila sem mudar, "Leve 5 pessoas" em 3 de 5, "Curta 5 posts do Nenho" em 2 de 5, "Traga 3 amigos" em 1 de 3, a meta em 12 de 20, as 5 conquistas, o Alan e a Gabi sem carteira, e rodar de novo sem mudar nada. O teste de seed do bloco 5 (`invites.emulator.test.ts`) passa a esperar 5 visitas no shard do dia, o do bloco 1 (`points.emulator.test.ts`), o extrato da Camila com 15 lançamentos, e o do bloco 6 (`posts.emulator.test.ts`), os dois posts novos do Nenho com uma curtida cada.
- `functions/test/game-panel.emulator.test.ts` (novo), com os membros de exemplo (admin, editora com `missions`, leitor, sem a seção, só com `ranking`, desativada): cada callable de 22.8 com acesso e recusa; `config-changed` com a versão velha; `mission-locked` depois do início e a mudança de título passando; `target-not-found` e `invalid-target` (também o `join` sem central); a meta 1 no alvo único; `too-many-active` e `too-many-missions`; arquivar move para `missionArchive` e publicar de novo traz de volta, com o mesmo id; o id gerado conferido no arquivo; `dailyLimits.mission` recusado; `level-in-use` sem `config/achievements`; `rule-not-available` no `rank`; `achievement-locked`, também numa conquista da lista padrão; o primeiro `createAchievement` parte do padrão, com `activatedAt` nas ativas; o degrau conferido na régua lida na transação; o `reachedDescription`; `season-id-locked` e `season-id-used`; a cópia em `versions/{n}`; uma auditoria por mudança e nenhuma quando nada mudou; a missão criada vale na `api` depois do cache (fonte injetada sem cache).
- Da revisão do fechamento (06/10/2026, 22.18): no `missions.emulator.test.ts`, a missão aberta de alvo único some para quem curtiu o post ou está na central antes de ela existir e volta depois de descurtir e de sair (o `readFacts` da curtida e do vínculo); o claim e a visita com o link `/post/__x__` e uma missão de link de central no ar respondem 200; e, com a meta por pontos já cumprida e nenhuma missão, a curtida que rende pontos responde `missionsChanged: true`. No `game-panel.emulator.test.ts`, a missão publicada que começa em 30 s recusa mudar o período, e a que começa em 2 h aceita.

Regras (`tests/missions-rules.test.ts`, novo, no molde de `tests/points-rules.test.ts`, com os mesmos membros de exemplo):

- `config/missions`, as versões dele e `missionArchive`: a equipe ativa com `missions` ou com `overview` e admin leem; sem as duas seções (só `ranking`), desativada, pendente ou com sessão de antes do `authValidAfter`, não leem; fã e sem login não leem; ninguém grava, nem admin.
- A seção `fans` sozinha lê `config/missions`, `missionArchive` e `config/achievements`, e não as versões.
- `config/achievements` e as versões: só com `missions` (com `overview` sozinha, não); o resto como acima.
- `statsDaily` e `statsShards`: a seção `missions` passa a ler, ao lado de `overview` e `growth`.
- `config/points`, `config/season` e `config/<outro id>` continuam como na seção 11, e os arquivos de teste que já existem passam sem mudança.

App:

- `src/config/__tests__/data-source.test.ts`: `missions` e `achievements` na API com o emulador.
- `missions/__tests__/api.test.ts` (novo): as duas rotas no modo API; nas fixtures, como hoje.
- `missions/__tests__/describe-rewards.test.ts` (novo, tabela): a frase com pontos, missão, nível e conquista, cada combinação, e o toque pela prioridade.
- `missions/__tests__/describe-mission.test.ts`: `join` com a central (destino e dica) e sem ela (`null`); `share` com alvo de central leva o `artistId` à sheet.
- `missions/__tests__/fixtures.test.ts`: a presença em outro show não anda a missão de presença; comentar três vezes no mesmo post anda um; uma ação anda todas as missões que casam; curtir, descurtir e curtir de novo conta um no período.
- `missions/__tests__/mission-cards.test.tsx` (onde já moravam os testes do `SeasonGoalCard`): com alvo acima de 999, a porcentagem no furo, a linha dos pontos e o rótulo com os números inteiros; com alvo pequeno, o furo de sempre.
- `missions/__tests__/mission-cards.test.tsx` e `daily-mission-card.test.tsx`: a festa da missão já anunciada na ação mantém o check e o "+N" e não toca nem anuncia; a que concluiu longe festeja como hoje.
- `profile/__tests__/use-level-up.test.tsx`: o nível já anunciado na ação acende o selo sem toque nem anúncio.
- `profile/__tests__/describe-ledger.test.ts` (novo, puro): cada origem com o título, o contexto e o sinal; o ajuste sem saldo; a linha zerada fora; os dias ("Hoje", "Ontem", "dom., 27 set", com relógio fixo) e o rótulo de cada linha.
- `src/navigation/__tests__/ledger.test.tsx` (novo, a tela pela rota): o card da 1e abre `/extrato` na pilha do Perfil, com a tab bar, e o voltar devolve à 1e; as linhas e as sobrelinhas das fixtures (a Camila do seed), sem os ajustes só de central; com a API, a página sem linha visível pede a seguinte sozinha, uma vez cada; vazio; erro anunciado, "Tentar de novo" e "Extrato carregado.".
- `profile/__tests__/profile-cards.test.tsx`: o card de pontos com `onPress` é um botão só, com o rótulo e a dica, sem a barra como outro foco.
- `posts/__tests__/rewards.test.tsx` (novo), `agenda/__tests__/rsvp.test.tsx` e `artists/__tests__/queries.test.tsx`: o "+N" com a frase e o toque do `describeRewards`; com conquista e sem pontos, só o anúncio; as missões buscam de novo com `missionsChanged: true` e sem o campo, e não com `false`; entrar e seguir invalidam as missões pela mesma regra; com conquista, as conquistas; o comentário que entra no cache não leva os campos de recompensa.
- O `join` levando à central fica no `describe-mission.test.ts` (o destino e a dica), sem teste de navegação na 1g: as fixtures não têm missão de entrar.
- Da revisão do fechamento (22.18): `rsvp.test.tsx`, a célula que passa para outro show com o pedido indo não sobe o "+N" nem marca a missão como festejada; `ledger.test.tsx`, a página seguinte que falha mostra o aviso próprio, anunciado, e o "Tentar de novo" busca só ela; `artists/__tests__/queries.test.tsx`, sair da central invalida as missões; `describe-mission.test.ts` e `sections.test.ts`, a concluída sai depois do fim do período; `daily-mission-card.test.tsx`, a concluída de ontem some depois da meia-noite (relógio fixo) e a de hoje chega.

### 22.15 Perguntas

Para a cliente (UP-9, UP-21, UP-22 e UP-48):

1. Missões de verdade: quais, quanto valem, metas e períodos. Proposta: as de hoje (22.13), editáveis no painel no bloco 11.
2. Conquistas: a lista, os nomes e as regras. Proposta: as 9 de 22.6, mais o "Top 20" com o ranking (bloco 8). O protótipo fala em 32; a lista cresce pelo painel, desde que a regra seja de nível, de primeira vez ou de ranking. Regra nova (por exemplo, "10 shows") é código.
3. Meta da temporada: contar missões (o protótipo, "Complete 20 missões", e a proposta do seed) ou os pontos da temporada; o texto da meta cumprida; e qual é o prêmio e como ele chega (a loja do bloco 10 ou a equipe, fora do app).
4. "Comente em 3 posts": posts diferentes (proposta) ou três comentários.
5. Missão de presença com show escolhido: conta só aquele show e some para quem já vai a ele (proposta). O título "Confirme presença em um show" vira "Confirme presença no São João de Irará"?
6. Missão relâmpago: continua de fora até ela definir quem abre e quando (UP-48).
7. Extrato: a tela provisória mostra de onde veio cada ponto e quando, sem o nome de quem visitou ou se cadastrou pelo link (proposta). Ela quer mais alguma coisa nele?
8. Conquista rende pontos? Proposta: não (os pontos já vêm da ação e da missão).

Para o dono:

9. Progresso e conquistas na carteira (decisões 6 e 10), em vez de documentos à parte.
10. Os tetos do dia editáveis no painel (`actionCaps`, decisão 13), e não só os limites de pontos.
11. O `updateSeason` neste bloco, com a seção `ranking`, e a meta da temporada com a seção `missions`.
12. O seed com a conta nova (Gabi), a ordem nova (dois claims antes do catálogo), os 8 lançamentos de missão a mais na carteira da Camila, com a base menor, e as duas curtidas dela em dois posts novos do Nenho, que também entram nas fixtures (22.13).
13. A curtida e o "Eu vou" contam a troca de estado, um alvo por missão e período (decisão 4): descurtir e curtir de novo noutro dia anda a missão de novo, até a meta e dentro dos tetos do dia, e a missão de alvo único some para quem já fez. A regra das fixtures (a primeira vez da vida) deixava missões que nunca fecham.
14. Missão de link: a pessoa conta uma vez por convidante e para sempre, pelo marcador (proposta), ou uma vez por missão e período, guardando em `keys` um resumo não reversível (`sha256(personKey:missionId:período)`, 16 caracteres)? A proposta gasta a roda de amigos do fã numa missão só; a outra deixa a mesma pessoa render a missão de link todo dia.
15. Meta da temporada: o pedido do bloco falava em pontos da temporada, e o seed seguiu o protótipo e as fixtures (missões concluídas). O código aceita as duas; confirmar qual vai para a conversa com a cliente (pergunta 3).
16. As missões de link e de convite pagam sem central (decisão 7), como os pontos do convite (decisão 11 de 20.1).

### 22.16 Fora deste bloco e publicação

- **Fora deste bloco (só documentado):** as telas do painel (Missões e régua, com as arquivadas, a temporada em Ranking e temporadas, o progresso, as conquistas e a meta cumprida na seção Fãs), bloco 11; a regra `rank` e o "Top 20", bloco 8; a missão relâmpago e o estado `locked`; uma tela de todas as conquistas (a 1e mostra 4); regras novas de conquista (contagens como "10 shows"), que pedem contador; o prêmio da meta da temporada, bloco 10; o `adjustFanPoints`, bloco 11, que passa o `game`; o `join` sem central, quando o Explorar existir; a versão 0 de `config/achievements` e de `config/points` para as telas do painel (a carga da versão 1 ou uma callable de leitura, 22.8).
- **Publicação**, só com o ok do dono, nesta ordem: regras e índices (`deploy --only firestore:rules,firestore:indexes`; só isenções, sem índice composto novo, então não há o que esperar montar); depois todas as funções (`npm run functions:deploy`), que levam a `api` com as rotas e os campos novos e as 11 callables novas (`updatePointsConfig`, `updateSeason`, `createMission`, `updateMission`, `setMissionStatus`, `reorderMissions`, `updateSeasonGoal`, `createAchievement`, `updateAchievement`, `setAchievementStatus`, `reorderAchievements`). Em produção não há `config/missions`: o app mostra "sem missões" até a equipe criar as missões no painel (bloco 11) ou o dono autorizar uma carga do catálogo provisório. As conquistas valem pelo padrão do código desde o deploy. O `EXPO_PUBLIC_API_URL` segue a regra da seção 13: só depois do bloco 10.

### 22.17 Armadilhas do bloco 7

- O catálogo vem do cache de 60 s, também na transação: missão criada, editada ou arquivada vale em até 60 s. A temporada continua lida na transação (seção 8).
- Ticks só no `planAwards` que vem antes das gravações do domínio. O que roda depois delas, com a lista vazia, não pode ler nada, e as candidatas são leitura.
- O progresso é da carteira: toda gravação nela passa pelo plano (ou pelo `addDailyCount`, que parte do retrato) e leva o `missions`, o `achievements` e o `goalReached` inteiros. Um `update` que esquecesse um deles apagaria o progresso, as conquistas ou a meta cumprida.
- O período nunca anda para trás: o `rollMissions` só zera a chave anterior à do pedido, e o tick de um período velho é descartado.
- A curtida e o "Eu vou" contam a troca de estado; curtir, comentar, "Eu vou" e entrar contam o alvo uma vez por missão e período (o `keyDigest` em `keys`); `share` e `invite` contam a pessoa pelo marcador, e a chave da pessoa nunca vai para o progresso.
- O tick de `invite` olha o marcador (com `signupAt`, ou `via: 'claim'` de antes do bloco 7), e não o lançamento do cadastro: o cadastro em 0 ou acima do limite do dia não deixa lançamento.
- Alvo é filtro pela chave dele: o de post compara o `postId`, o de show o `eventId`, o de central a lista de centrais do tick. Alvo único (post em `like` e `comment`, show em `rsvp`, central em `join`) pede meta 1, e a missão aberta some para quem já está no estado.
- A missão paga `mission:<id>:<período>`. Id de missão nunca muda nem volta a ser usado: arquivar move para `missionArchive`, e o `createMission` confere o catálogo e o arquivo. O título do extrato é o do lançamento.
- As missões de link e de convite pagam sem central. `dailyLimits.mission` é sempre `null`.
- Missão publicada e começada não muda tipo, alvo, meta, período nem início (`mission-locked`).
- O fim de uma missão aberta é o menor entre o `endsAt` e o fim do período; a concluída fica até o fim do período. A semana é a ISO de São Paulo, de segunda a domingo.
- `seasonMissions` zera na troca preguiçosa de temporada, junto com o `seasonPoints`; `goalReached` nunca sai.
- Conquista nunca é revogada, e a de nível vale desde a leitura: mudar a régua mostra a conquista na hora e a grava na próxima gravação, com a data do `updatedAt`, sem `levelUp` nem anúncio. O caminho fora da API sem `game` não desbloqueia nada.
- `rank` não pode ficar `active` antes do bloco 8.
- `levelUp`, `completedMissions` e `missionsChanged` são só de quem chama. Quem convidou vê a festa ao abrir a tela.
- O app anuncia a recompensa na hora e marca o que anunciou: a 1g, a 1b e a 1e não repetem o toque nem o anúncio do que já saiu na ação. As missões só buscam de novo com `missionsChanged`.
- O seed depende da ordem: dois claims antes do catálogo de missões, o resto depois, as curtidas da Camila com o `game` e o engajamento com `NO_GAME`.
- Os modelos de missões e de conquistas importam do núcleo só tipos: valor importado de `points/model.ts` fecharia um ciclo em tempo de execução.

### 22.18 O que o código fez diferente do desenho

O desenho de 22.1 a 22.17 vale como está; estas são as diferenças do código de 06/10/2026, cada uma com o motivo.

- **`SeasonGoal.metric` na resposta.** O `season` do `GET /missions` leva a métrica da meta (`'missions'` ou `'points'`), no `contract.ts` e no app (opcional). Sem ela, o app não saberia quando trocar o número do anel pela porcentagem (22.7). Texto novo: `missions.season.percent` ("{{percent}}%").
- **`functions/src/config-validation.ts`**, novo, com o `ConfigValidationError`, que o `points/config.ts` reexporta. Os modelos das missões e das conquistas lançam o mesmo erro, e importá-lo do núcleo fecharia o ciclo de 22.17. O teste de carga (`missions/load.test.ts`) carrega os dois modelos com o núcleo e a configuração quebrados.
- **`functions/src/points/config-change.ts`**, novo, com o `runConfigChange`: o molde de 22.8 (o acesso lido fora e de novo na transação, o `config-changed` com a versão de agora, a versão `+1` com `updatedAt` e `updatedBy`, a cópia em `versions/{n}`, a auditoria e o `ConfigValidationError` virando `invalid-request`) num lugar só, usado pelas 11 callables, em vez de repetido em cada `panel.ts`.
- **Os erros da régua e da temporada** (`level-in-use`, `season-id-locked`, `season-id-used`, `no-season`) saem do `gamePanelError` de `missions/errors.ts`, com os das missões; as conquistas têm o `achievements/errors.ts`.
- **`season-id-locked` ao pé da letra.** Com a temporada de agora já começada, nenhum pedido troca o id dela, nem depois do fim. Para começar outra, a equipe encerra (`season: null`) e grava a nova num segundo pedido. Nome, fim e título do líder continuam editáveis.
- **`profile/action-rewards.ts`** (app), novo, com o `rewardsToast`: a regra de 22.12 (com pontos, o "+N" com a frase e o toque; sem pontos e com conquista, só o anúncio na fila; e a marca do que já festejou). O `artists/queries.ts` e o `posts/queries.ts` usam os dois, e pôr a regra num deles fechava um ciclo entre eles.
- **Textos a mais** além dos de 22.12: `ledger.when.today`, `.yesterday` e `.other` ("hoje às 22:31", "em 27 de setembro às 12:00", no rótulo do leitor de tela), `ledger.pointsGain` e `ledger.pointsLoss` ("mais 10 pontos", "menos 1.000 pontos") e `invite.target.artist` e `.artistPlain` (a sheet "Gerar meu link" com o link de uma central, para a missão de link com alvo de central).
- **A data da sobrelinha do extrato** sai do `formatWeekdayDayMonth`, novo em `@/utils/date`: as três primeiras letras do dia da semana ("sáb., 3 out"), porque no pt-BR do date-fns 4 o `EEE` sai por extenso ("sábado") e o `EEEEEE` perde o acento ("sab").
- **A missão do dia da 1b entra em fade por valor animado** (`useEnterFade`), e não mais pelo `FadeIn` de layout do Reanimated: com a missão vindo do servidor depois de a home aparecer, o `entering` apagava a tela inteira no Android uns segundos depois (Expo Go, emulador), com a árvore montada e a opacidade da pilha em 1. O desenho não muda.
- **Onde os testes do app ficaram** (22.14 já está com os nomes de agora): os do `SeasonGoalCard` no `mission-cards.test.tsx`, o extrato num teste puro e num de navegação, o card que abre o extrato no de navegação do extrato, e as recompensas dos posts num arquivo próprio.

**Revisão do fechamento (06/10/2026).** Uma revisão adversarial do bloco, conferida no código e nos emuladores, trouxe dez apontamentos; entraram estes, cada um com teste:

- **`missionsChanged` com a meta por pontos.** Só ligava com unidade contada, e o anel da 1g (o `seasonPoints`) ficava velho depois de um comentário fora de missão. Agora liga também quando a meta da temporada ativa é por pontos e o `seasonPoints` de quem chama mudou, e quando a meta é cumprida agora (22.2). O app não mudou: a regra continua sendo o campo.
- **Id de post reservado no link do convite.** O `classifyInvitePath` aceitava `/post/__x__`, e, com uma missão de link de central no ar, o claim e a visita liam `posts/__x__`, que o Firestore recusa (500; o claim tentaria de novo para sempre). O id de post passa pelo `isContentId`, e o link vira `other`.
- **`mission-locked` um cache antes do início** (22.8).
- **A seção Fãs lê os catálogos** (22.10), para dar nome aos ids da carteira.
- **O "+N" do "Eu vou" na célula reaproveitada**, **sair da central busca as missões**, **a página seguinte do extrato** e **a concluída que vence no fim do período** (22.12). Para a última, o servidor passou a mandar na concluída o fim do período como `endsAt` (antes, o menor entre o `endsAt` do catálogo e o fim do período): com o valor antigo, o app não conseguia tirar a de ontem sem também tirar a concluída cujo `endsAt` de catálogo venceu no meio do dia, que a decisão 3 manda manter.

Ficou de fora: a versão 0 de `config/achievements` e de `config/points` para o painel (22.8, "Falta para as telas do bloco 11"), porque pede uma carga em produção ou uma callable nova, com o ok do dono.

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
