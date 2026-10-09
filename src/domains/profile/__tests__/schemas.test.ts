import { t } from '@/i18n';
import { CITY_MAX, DISPLAY_NAME_MAX } from '@/utils/visible-line';

import { BIO_MAX, BIO_MAX_LINES } from '../details';
import {
  changesOf,
  EDIT_PROFILE_FIELD_ORDER,
  editProfileSchema,
  formValuesOf,
  SERVER_FIELD_TO_FORM,
  type EditProfileFormInput,
} from '../schemas';
import type { FanProfile } from '../types';

// O formulário da tela "Editar perfil" (seção 28 de docs/arquitetura-api.md)
// com as regras do servidor (parseProfileChanges, em
// functions/src/fan-profile/details.ts): o nome é o campo do cadastro, sem
// cópia; as redes ficam no primeiro nível, para o envio inválido anunciar.

const BASE: EditProfileFormInput = {
  name: 'Camila Ribeiro',
  username: 'camilarib',
  bio: '',
  city: '',
  gender: null,
  privateAccount: false,
  instagram: '',
  tiktok: '',
  linkedin: '',
  x: '',
};

const parse = (changes: Partial<EditProfileFormInput>) =>
  editProfileSchema.safeParse({ ...BASE, ...changes });
const firstError = (changes: Partial<EditProfileFormInput>) =>
  parse(changes).error?.issues[0]?.message;
const errorOf = (changes: Partial<EditProfileFormInput>, field: string) =>
  parse(changes).error?.issues.find((issue) => issue.path[0] === field)?.message;

describe('nome (o campo do cadastro)', () => {
  it.each([
    ['Camila Ribeiro', 'Camila Ribeiro'],
    ['  Camila Ribeiro  ', 'Camila Ribeiro'],
    ['Camila 👩‍🎤', 'Camila 👩‍🎤'],
    ['x'.repeat(DISPLAY_NAME_MAX), 'x'.repeat(DISPLAY_NAME_MAX)],
  ])('%j passa como %j', (typed, saved) => {
    expect(parse({ name: typed }).data?.name).toBe(saved);
  });

  it('vazio, longo e invisível são recusados com as mensagens do cadastro', () => {
    expect(firstError({ name: '' })).toBe(t('validation.nameRequired'));
    expect(firstError({ name: 'x'.repeat(DISPLAY_NAME_MAX + 1) })).toBe(
      t('validation.nameMax', { max: DISPLAY_NAME_MAX }),
    );
    expect(firstError({ name: 'Ca​mila' })).toBe(t('validation.nameInvalid'));
  });
});

describe('cidade (opcional, até 80)', () => {
  it('vazia (ou só espaços) vira null, que limpa o campo', () => {
    expect(parse({ city: '' }).data?.city).toBeNull();
    expect(parse({ city: '   ' }).data?.city).toBeNull();
  });

  it.each([
    ['Feira de Santana, BA', 'Feira de Santana, BA'],
    ['  Irará, BA ', 'Irará, BA'],
    ['⁦Salvador⁩', 'Salvador'],
    ['x'.repeat(CITY_MAX), 'x'.repeat(CITY_MAX)],
  ])('%j passa como %j', (typed, saved) => {
    expect(parse({ city: typed }).data?.city).toBe(saved);
  });

  it('80 conta unidades de UTF-16, como o servidor', () => {
    expect(CITY_MAX).toBe(80);
    // 40 emoji são 80 unidades de UTF-16; 41, 82.
    expect(parse({ city: '🎶'.repeat(40) }).success).toBe(true);
    expect(firstError({ city: '🎶'.repeat(41) })).toBe(t('validation.cityMax', { max: CITY_MAX }));
  });

  it('linha quebrada e caractere invisível são recusados', () => {
    expect(firstError({ city: 'Irará\nBA' })).toBe(t('validation.cityInvalid'));
    expect(firstError({ city: 'Ira​rá' })).toBe(t('validation.cityInvalid'));
    expect(firstError({ city: 'x'.repeat(CITY_MAX + 1) })).toBe(
      t('validation.cityMax', { max: CITY_MAX }),
    );
  });
});

describe('bio (opcional, até 200 e 6 linhas)', () => {
  it('pela limpeza do comentário: as pontas e as linhas vazias seguidas saem; vazia vira null', () => {
    expect(parse({ bio: '  Feira de Santana.  \n\n\n  Fã do Netto.  ' }).data?.bio).toBe(
      'Feira de Santana.\n\nFã do Netto.',
    );
    expect(parse({ bio: '' }).data?.bio).toBeNull();
    expect(parse({ bio: ' \n \n ' }).data?.bio).toBeNull();
  });

  it('200 em UTF-16 passa; 201 não', () => {
    expect(parse({ bio: 'a'.repeat(BIO_MAX) }).data?.bio).toHaveLength(BIO_MAX);
    expect(firstError({ bio: 'a'.repeat(BIO_MAX + 1) })).toBe(
      t('validation.bioMax', { max: BIO_MAX }),
    );
    // 100 emoji são 200 unidades; 101, 202.
    expect(parse({ bio: '🎶'.repeat(100) }).success).toBe(true);
    expect(parse({ bio: '🎶'.repeat(101) }).success).toBe(false);
  });

  it('6 linhas passam; 7 não, contadas no texto limpo', () => {
    expect(parse({ bio: 'a\nb\nc\nd\ne\nf' }).success).toBe(true);
    expect(firstError({ bio: 'a\nb\nc\nd\ne\nf\ng' })).toBe(
      t('validation.bioLines', { max: BIO_MAX_LINES }),
    );
    // As linhas vazias seguidas viram uma só antes de contar.
    expect(parse({ bio: 'a\n\n\n\nb\nc\nd\ne' }).success).toBe(true);
  });

  it('uma linha invisível é recusada', () => {
    expect(firstError({ bio: 'oi\nㅤ\ntchau' })).toBe(t('validation.bioInvalid'));
  });
});

describe('o @', () => {
  it('normalizado: minúsculas e sem o @ do começo', () => {
    expect(parse({ username: ' @CamilaRibeiro ' }).data?.username).toBe('camilaribeiro');
  });

  it('fora do formato é recusado como barreira (a linha do @ já segura o ✓)', () => {
    expect(errorOf({ username: 'ca' }, 'username')).toBe(t('editProfile.username.invalid'));
    expect(errorOf({ username: 'camila.ribeiro' }, 'username')).toBe(
      t('editProfile.username.invalid'),
    );
    expect(parse({ username: '' }).success).toBe(true);
  });
});

describe('gênero e conta privada', () => {
  it('o gênero só dos quatro valores, ou null', () => {
    for (const gender of ['woman', 'man', 'nonbinary', 'undisclosed', null] as const) {
      expect(parse({ gender }).data?.gender).toBe(gender);
    }
    expect(parse({ gender: 'other' as never }).success).toBe(false);
  });

  it('a conta privada é booleano', () => {
    expect(parse({ privateAccount: true }).data?.privateAccount).toBe(true);
  });
});

describe('as quatro redes, no primeiro nível', () => {
  it('o link colado vira o usuário; vazio vira null', () => {
    const data = parse({
      instagram: 'https://www.instagram.com/camila.teste.up/',
      tiktok: '@Camila.Teste.Up',
      linkedin: 'https://br.linkedin.com/in/jo%C3%A3o-teste',
      x: '',
    }).data;
    expect(data).toMatchObject({
      instagram: 'camila.teste.up',
      tiktok: 'camila.teste.up',
      linkedin: 'joão-teste',
      x: null,
    });
  });

  it('o link de outro domínio e o usuário fora do formato são erro do próprio campo', () => {
    expect(errorOf({ instagram: 'https://www.tiktok.com/@camila' }, 'instagram')).toBe(
      'Esse link não é do Instagram.',
    );
    expect(errorOf({ x: 'a'.repeat(16) }, 'x')).toBe('Usuário fora do formato do X (Twitter).');
    expect(errorOf({ linkedin: 'https://www.linkedin.com/company/imagine' }, 'linkedin')).toBe(
      'Usuário fora do formato do LinkedIn.',
    );
  });

  it('as redes estão na ordem do anúncio do primeiro erro, depois dos outros campos', () => {
    expect(EDIT_PROFILE_FIELD_ORDER).toEqual([
      'name',
      'username',
      'bio',
      'city',
      'gender',
      'instagram',
      'tiktok',
      'linkedin',
      'x',
    ]);
  });
});

const PROFILE: FanProfile = {
  uid: 'uidCamila',
  displayName: 'Camila Ribeiro',
  username: 'camilarib',
  city: 'Feira de Santana, BA',
  photoURL: null,
  createdAt: null,
  usernameChangeableAt: null,
  bio: 'Feira de Santana.',
  gender: 'woman',
  privateAccount: false,
  socials: { instagram: 'camila.teste.up', tiktok: null, linkedin: null, x: null },
};

describe('formValuesOf', () => {
  it('os textos crus dos campos a partir do perfil', () => {
    expect(formValuesOf(PROFILE, 'Camila da Sessão')).toEqual({
      name: 'Camila Ribeiro',
      username: 'camilarib',
      bio: 'Feira de Santana.',
      city: 'Feira de Santana, BA',
      gender: 'woman',
      privateAccount: false,
      instagram: 'camila.teste.up',
      tiktok: '',
      linkedin: '',
      x: '',
    });
  });

  it('o perfil sem nome usa o da sessão; sem os campos novos, o padrão', () => {
    const old: FanProfile = {
      uid: 'u',
      displayName: null,
      username: 'fa711224',
      city: null,
      photoURL: null,
      createdAt: null,
    };
    expect(formValuesOf(old, 'Camila da Sessão')).toEqual({
      name: 'Camila da Sessão',
      username: 'fa711224',
      bio: '',
      city: '',
      gender: null,
      privateAccount: false,
      instagram: '',
      tiktok: '',
      linkedin: '',
      x: '',
    });
  });
});

describe('changesOf: o corpo do ✓', () => {
  const draft = (changes: Partial<EditProfileFormInput>) => ({
    ...formValuesOf(PROFILE, null),
    ...changes,
  });

  it('só os campos mexidos cujo valor limpo difere do perfil', () => {
    expect(
      changesOf(
        draft({ bio: '  Salvador.  ', city: 'Feira de Santana, BA ', gender: 'woman' }),
        { bio: true, city: true, gender: true },
        PROFILE,
        { sendUsername: false },
      ),
    ).toEqual({ bio: 'Salvador.' });
  });

  it('o campo não mexido fica fora, mesmo diferente do perfil (a escuta o acompanha)', () => {
    expect(
      changesOf(draft({ bio: 'Outra' }), {}, { ...PROFILE, bio: null }, { sendUsername: false }),
    ).toEqual({});
  });

  it('o nome do perfil sem nome vai junto, sem ser mexido', () => {
    expect(
      changesOf(
        { ...formValuesOf({ ...PROFILE, displayName: null }, 'Camila da Sessão') },
        {},
        { ...PROFILE, displayName: null },
        { sendUsername: false },
      ),
    ).toEqual({ displayName: 'Camila da Sessão' });
  });

  it('o @ só vai quando pode (Disponível e sem prazo)', () => {
    const changed = draft({ username: '@CamilaRibeiro' });
    expect(changesOf(changed, { username: true }, PROFILE, { sendUsername: false })).toEqual({});
    expect(changesOf(changed, { username: true }, PROFILE, { sendUsername: true })).toEqual({
      username: 'camilaribeiro',
    });
  });

  it('vazio limpa: a bio e a cidade viram null', () => {
    expect(
      changesOf(draft({ bio: ' ', city: '' }), { bio: true, city: true }, PROFILE, {
        sendUsername: false,
      }),
    ).toEqual({ bio: null, city: null });
  });

  it('a conta privada e o gênero', () => {
    expect(
      changesOf(
        draft({ privateAccount: true, gender: 'undisclosed' }),
        { privateAccount: true, gender: true },
        PROFILE,
        { sendUsername: false },
      ),
    ).toEqual({ privateAccount: true, gender: 'undisclosed' });
  });

  it('as redes mexidas que diferem vão no socials, normalizadas; a igual sai', () => {
    expect(
      changesOf(
        draft({
          instagram: 'https://www.instagram.com/camila.teste.up/',
          tiktok: '@Camila.Teste.Up',
          x: '',
        }),
        { instagram: true, tiktok: true, x: true },
        PROFILE,
        { sendUsername: false },
      ),
    ).toEqual({ socials: { tiktok: 'camila.teste.up' } });
    expect(
      changesOf(draft({ instagram: '' }), { instagram: true }, PROFILE, { sendUsername: false }),
    ).toEqual({ socials: { instagram: null } });
  });

  it('a rede fora do formato conta como mudança (o envio mostra o erro do campo)', () => {
    expect(
      changesOf(draft({ x: 'a'.repeat(16) }), { x: true }, PROFILE, { sendUsername: false }),
    ).toEqual({ socials: { x: 'a'.repeat(16) } });
  });
});

describe('SERVER_FIELD_TO_FORM', () => {
  it('o campo do profile_invalid vira o campo do formulário', () => {
    expect(SERVER_FIELD_TO_FORM.displayName).toBe('name');
    expect(SERVER_FIELD_TO_FORM['socials.x']).toBe('x');
    expect(SERVER_FIELD_TO_FORM['socials.linkedin']).toBe('linkedin');
    expect(SERVER_FIELD_TO_FORM.bio).toBe('bio');
    expect(SERVER_FIELD_TO_FORM.city).toBe('city');
    expect(SERVER_FIELD_TO_FORM.gender).toBe('gender');
  });
});
