import { describe, expect, it } from 'vitest';

import { RESERVED_HANDLES } from './artists/model';
import {
  DISPLAY_NAME_MAX,
  profileDisplayName,
  USERNAME_PATTERN,
  usernameBase,
  usernameCandidates,
} from './profile';

describe('profileDisplayName', () => {
  it('guarda o nome do cadastro sem espaço nas pontas', () => {
    expect(profileDisplayName('  Camila Ribeiro ')).toBe('Camila Ribeiro');
  });

  it('sem nome, fica null para o fã preencher', () => {
    expect(profileDisplayName(undefined)).toBeNull();
    expect(profileDisplayName(null)).toBeNull();
    expect(profileDisplayName('   ')).toBeNull();
  });

  it('recusa nome que o celular não conseguiria gravar', () => {
    for (const name of ['\u034F', 'Camila\u2028Oficial', 'a' + '\u0336'.repeat(30), 'A\u200DB']) {
      expect(profileDisplayName(name)).toBeNull();
    }
  });

  it('nome longo perde as últimas palavras até caber', () => {
    const name = 'Maria da Conceição dos Santos Oliveira Albuquerque de Souza Lima Ferreira';
    const fitted = profileDisplayName(name);
    expect(fitted).toBe('Maria da Conceição dos Santos Oliveira Albuquerque de Souza');
  });

  it('uma palavra só maior que o limite fica null', () => {
    expect(profileDisplayName('x'.repeat(DISPLAY_NAME_MAX + 1))).toBeNull();
    expect(profileDisplayName('x'.repeat(DISPLAY_NAME_MAX))).toBe('x'.repeat(DISPLAY_NAME_MAX));
  });

  it('guarda o nome em NFC', () => {
    expect(profileDisplayName('Cámila'.normalize('NFD'))).toBe('Cámila'.normalize('NFC'));
  });
});

describe('usernameBase', () => {
  it.each([
    ['Camila Ribeiro', 'camilarib'],
    ['Camila', 'camila'],
    ['José Antônio da Conceição', 'josecon'],
    ['Ana Lú', 'analu'],
    ['MC Kevinho 2', 'mc2'],
    ['Maria-Clara Souza', 'mariasou'],
    ['Admilson Souza', 'admilsonsou'],
    ['Isaac Newton', 'isaacnew'],
    ['Modesto Lima', 'modestolim'],
    ['Bernardo Souza', 'bernardosou'],
  ])('%s vira %s', (name, base) => {
    expect(usernameBase(name)).toBe(base);
  });

  it.each([
    ['sem nome', null],
    ['nome curto', 'Jo'],
    ['sem letra latina', '张伟'],
    ['só emoji', '🎶'],
    ['parecido com a marca', 'Imagine Music'],
    ['parecido com a equipe', 'Admin Silva'],
    ['moderador em inglês', 'Moderator'],
    ['moderação', 'Moderação'],
    ['número no lugar de letra', 'Adm1n'],
    ['número no começo', '1magine'],
    ['número no meio', 'Imag1ne Up'],
    ['rn no lugar de m', 'Irnagineup'],
    ['atendimento', 'Atendimento Silva'],
    ['@ reservado das centrais: ajuda', 'Ajuda'],
    ['@ reservado das centrais: contato', 'Contato'],
    ['@ reservado com número no lugar de letra', 'C0ntat0'],
  ])('%s vira "fa"', (_, name) => {
    expect(usernameBase(name)).toBe('fa');
  });

  it('nenhum @ reservado das centrais sai como base de fã', () => {
    for (const handle of RESERVED_HANDLES) {
      expect(usernameBase(handle.charAt(0).toUpperCase() + handle.slice(1))).toBe('fa');
    }
  });

  it('reservado das centrais vale só exato: nome que começa com a palavra segue', () => {
    expect(usernameBase('Contato Silva')).toBe('contatosil');
    expect(usernameBase('Ajudante')).toBe('ajudante');
  });

  it('corta a base em 15 caracteres', () => {
    expect(usernameBase('Bartholomeuzinho Souza')).toBe('bartholomeuzinh');
  });
});

describe('usernameCandidates', () => {
  const sequence = (values: string[]) => {
    let index = 0;
    return (count: number) => values[index++ % values.length].slice(0, count).padStart(count, '0');
  };

  it('tenta a base pura, depois com 2 e 4 dígitos, e por fim "fa" com 8', () => {
    const candidates = usernameCandidates(
      'camilarib',
      sequence(['17', '42', '93', '2025', '7777', '12345678']),
    );
    expect(candidates).toEqual([
      'camilarib',
      'camilarib17',
      'camilarib42',
      'camilarib93',
      'camilarib2025',
      'camilarib7777',
      'fa12345678',
    ]);
  });

  it('para a base "fa", só números', () => {
    const candidates = usernameCandidates('fa');
    expect(candidates.every((candidate) => /^fa\d{6}$|^fa\d{8}$/.test(candidate))).toBe(true);
  });

  it('todo candidato tem formato de @ e não repete', () => {
    for (const base of ['camilarib', 'maximilianobart', 'ana', 'fa']) {
      const candidates = usernameCandidates(base);
      expect(new Set(candidates).size).toBe(candidates.length);
      for (const candidate of candidates) expect(candidate).toMatch(USERNAME_PATTERN);
    }
  });
});
