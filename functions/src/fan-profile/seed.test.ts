import { describe, expect, it } from 'vitest';

import { RESERVED_HANDLES } from '../artists/model';
import { SEED_CENTRALS } from '../centrals/seed';
import { SEED_INVITEES, SEED_VISITORS } from '../invites/seed';
import { SEED_SPAM_FAN, SEED_SUSPENDED_EMAIL } from '../moderation/seed';
import { usernameBase } from '../profile';
import { RANKING_SEED } from '../ranking/seed';
import { cleanMultiline } from '../visible-line';
import {
  BIO_MAX,
  BIO_MAX_LINES,
  normalizeSocialHandle,
  parseProfileChanges,
  SOCIAL_NETWORKS,
} from './details';
import { SEED_FAN_DETAILS, SEED_FANS, seedFanDetailsChanges } from './seed';

// Os fãs de teste e os detalhes do perfil novo do seed dos emuladores (28.10):
// a tabela da nota, a coerência com as contas do script e do ranking e o @
// que o cadastro dá no emulador (o mesmo do `fixtureUsername` do app).

describe('a tabela de 28.10', () => {
  it('é a da nota, por e-mail', () => {
    expect(SEED_FAN_DETAILS).toEqual([
      {
        email: 'camila@teste.imagineup',
        displayName: 'Camila Ribeiro',
        username: 'camilarib',
        bio: 'Feira de Santana.\nFã do Netto desde o primeiro show.',
        gender: 'woman',
        privateAccount: false,
        socials: {
          instagram: 'camila.teste.up',
          tiktok: 'camila.teste.up',
          linkedin: 'camila-teste-imagineup',
          x: 'camilatesteup',
        },
      },
      {
        email: 'bia@teste.imagineup',
        displayName: 'Bia Santos',
        username: 'biasan',
        bio: 'Salvador.\nMando todo clipe novo para o grupo da família.',
        gender: 'woman',
        privateAccount: false,
        socials: { instagram: 'bia.teste.up', tiktok: 'bia.teste.up' },
      },
      {
        email: 'spam@teste.imagineup',
        displayName: 'Promo Seguidores',
        username: 'promoseg',
        bio: 'Seguidores reais e baratos! Chama no direct.',
        gender: null,
        privateAccount: false,
        socials: { instagram: 'promo.teste.up', x: 'promotesteup' },
      },
      {
        email: 'rank-01@teste.imagineup',
        displayName: 'Thalita Santos',
        username: 'thalitasan',
        bio: 'Do arrocha ao piseiro, sigo o Netto em todo São João.\nIrará na veia.',
        gender: 'woman',
        privateAccount: false,
        socials: {
          instagram: 'thalita.teste.up',
          tiktok: 'thalita.teste.up',
          linkedin: 'thalita-teste-imagineup',
          x: 'thalitatesteup',
        },
      },
      {
        email: 'rank-05@teste.imagineup',
        displayName: 'Aline Ferreira',
        username: 'alinefer',
        bio: 'Conta de teste privada. Esta bio não aparece para os outros fãs.',
        gender: 'undisclosed',
        privateAccount: true,
        socials: { instagram: 'aline.teste.up', x: 'alinetesteup' },
      },
    ]);
  });

  it('todo e-mail existe no SEED_FANS ou no RANKING_SEED, com o mesmo nome', () => {
    const names = new Map<string, string>([
      ...SEED_FANS.map((fan): [string, string] => [fan.email, fan.displayName]),
      ...RANKING_SEED.map((account): [string, string] => [account.email, account.name]),
    ]);
    for (const details of SEED_FAN_DETAILS) {
      expect(names.get(details.email), details.email).toBe(details.displayName);
    }
  });

  it('as bios passam pela limpeza, até 200 e 6 linhas; o corpo inteiro passa pela rota', () => {
    for (const details of SEED_FAN_DETAILS) {
      const bio = details.bio!;
      expect(cleanMultiline(bio), details.email).toBe(bio);
      expect(bio.length).toBeLessThanOrEqual(BIO_MAX);
      expect(bio.split('\n').length).toBeLessThanOrEqual(BIO_MAX_LINES);
      const parsed = parseProfileChanges(seedFanDetailsChanges(details));
      expect(parsed, details.email).toMatchObject({ ok: true });
    }
  });

  it('os usuários das redes passam pelo normalizador sem mudar; o do X cabe nos 15', () => {
    for (const details of SEED_FAN_DETAILS) {
      for (const network of SOCIAL_NETWORKS) {
        const handle = details.socials[network];
        if (handle === undefined) continue;
        expect(normalizeSocialHandle(network, handle!), `${details.email} ${network}`).toEqual({
          ok: true,
          handle,
        });
        expect(handle).toMatch(/teste/);
      }
    }
  });

  it('o @ da tabela é o que o cadastro dá: o usernameBase do nome', () => {
    for (const details of SEED_FAN_DETAILS) {
      expect(usernameBase(details.displayName), details.email).toBe(details.username);
    }
  });

  it('a conta suspensa do seed é a rank-48, Renata Teixeira, sem detalhes', () => {
    expect(SEED_SUSPENDED_EMAIL).toBe('rank-48@teste.imagineup');
    expect(RANKING_SEED.find((account) => account.email === SEED_SUSPENDED_EMAIL)?.name).toBe(
      'Renata Teixeira',
    );
    expect(SEED_FAN_DETAILS.map((details) => details.email)).not.toContain(SEED_SUSPENDED_EMAIL);
  });
});

describe('os fãs de teste (SEED_FANS)', () => {
  it('os do script, com a Camila da carteira, os três convidados e o fã de propaganda', () => {
    expect(SEED_FANS.map((fan) => fan.email)).toEqual([
      'camila@teste.imagineup',
      'alan@teste.imagineup',
      'bia@teste.imagineup',
      'duda@teste.imagineup',
      'enzo@teste.imagineup',
      'gabi@teste.imagineup',
      'spam@teste.imagineup',
    ]);
    expect(SEED_FANS.filter((fan) => fan.wallet).map((fan) => fan.email)).toEqual([
      'camila@teste.imagineup',
    ]);
    expect(
      SEED_FANS.filter((fan) => fan.invited)
        .map((fan) => fan.email)
        .sort(),
    ).toEqual(SEED_INVITEES.map((invitee) => invitee.email).sort());
    const emails = SEED_FANS.map((fan) => fan.email);
    for (const visitor of SEED_VISITORS) expect(emails).toContain(visitor);
    expect(SEED_FANS.find((fan) => fan.email === SEED_SPAM_FAN.email)).toMatchObject({
      displayName: SEED_SPAM_FAN.displayName,
      city: null,
    });
  });

  it('o @ de cada fã de teste e das 48 contas é único, sem dígito, fora das centrais e dos reservados', () => {
    // Assim o cadastro no emulador dá a base pura (sem os dígitos do sorteio), e o
    // @ da tabela e o `fixtureUsername` do app concordam.
    const bases = [
      ...SEED_FANS.map((fan) => usernameBase(fan.displayName)),
      ...RANKING_SEED.map((account) => usernameBase(account.name)),
    ];
    expect(bases).toHaveLength(SEED_FANS.length + 48);
    expect(new Set(bases).size).toBe(bases.length);
    const centrals = new Set(SEED_CENTRALS.map((central) => central.id));
    for (const base of bases) {
      expect(base, base).not.toMatch(/[0-9]/);
      expect(base).not.toBe('fa');
      expect(centrals.has(base), base).toBe(false);
      expect(RESERVED_HANDLES, base).not.toContain(base);
    }
  });
});
