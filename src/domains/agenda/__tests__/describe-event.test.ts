import {
  eventArtists,
  eventArtistsSpoken,
  eventDateBadge,
  eventMeta,
  eventPlace,
  eventPlaceSpoken,
  eventRowLabel,
  featuredEventLabel,
  inviteButtonText,
} from '../describe-event';
import type { AgendaArtist, AgendaEvent } from '../types';

const NOW = new Date(2026, 8, 29, 20, 0);
const NETTO: AgendaArtist = { id: 'netto-brito', name: 'Netto Brito' };
const NENHO: AgendaArtist = { id: 'nenho', name: 'Nenho' };
const JUNINHO: AgendaArtist = { id: 'juninho-moraes', name: 'Juninho Moraes' };

const IRARA: AgendaEvent = {
  id: 'sao-joao-irara',
  title: 'São João de Irará',
  artists: [NETTO, NENHO],
  city: 'Irará',
  state: 'BA',
  startsAt: new Date(2026, 9, 21, 22, 0).toISOString(),
  imageUrl: null,
  invitePointsPerSignup: 10,
};

describe('textos de um show', () => {
  it('a meta do destaque junta artistas, lugar e hora, como no protótipo', () => {
    expect(eventArtists(IRARA)).toBe('Netto Brito + Nenho');
    expect(eventMeta(IRARA)).toBe('Netto Brito + Nenho · Irará, BA · 22 h');
    expect(eventMeta({ ...IRARA, startsAt: new Date(2026, 9, 21, 21, 30).toISOString() })).toBe(
      'Netto Brito + Nenho · Irará, BA · 21 h 30',
    );
  });

  it('sem artista na resposta, a meta começa pelo lugar, sem separador sobrando', () => {
    expect(eventMeta({ ...IRARA, artists: [] })).toBe('Irará, BA · 22 h');
  });

  it.each([
    [[NETTO], 'Netto Brito'],
    [[NETTO, NENHO], 'Netto Brito e Nenho'],
    [[NETTO, NENHO, JUNINHO], 'Netto Brito, Nenho e Juninho Moraes'],
    [[], ''],
  ])('para o leitor, os artistas saem por extenso: %j', (artists, spoken) => {
    expect(eventArtistsSpoken({ ...IRARA, artists })).toBe(spoken);
  });

  it('a tela mostra a UF e o leitor diz o nome do estado', () => {
    expect(eventPlace(IRARA)).toBe('Irará, BA');
    expect(eventPlaceSpoken(IRARA)).toBe('Irará, Bahia');
    expect(eventPlaceSpoken({ ...IRARA, city: 'Aracaju', state: 'se' })).toBe('Aracaju, Sergipe');
    // UF que a tabela não conhece fica como veio.
    expect(eventPlaceSpoken({ ...IRARA, state: 'XX' })).toBe('Irará, XX');
  });

  it('o destaque é lido num rótulo só, com data e hora por extenso', () => {
    expect(featuredEventLabel(IRARA, NOW)).toBe(
      'Show em destaque. 21 de outubro, São João de Irará, Netto Brito e Nenho, Irará, Bahia, 22 horas',
    );
    expect(featuredEventLabel({ ...IRARA, artists: [] }, NOW)).toBe(
      'Show em destaque. 21 de outubro, São João de Irará, Irará, Bahia, 22 horas',
    );
  });

  it('a linha lê o que mostra: data, show e lugar', () => {
    expect(eventRowLabel(IRARA, NOW)).toBe('21 de outubro, São João de Irará, Irará, Bahia');
  });

  it('no dia do show, o selo diz "Hoje" no lugar do mês, e o leitor também', () => {
    const today = { ...IRARA, startsAt: new Date(2026, 8, 29, 22).toISOString() };
    expect(eventDateBadge(today, NOW)).toEqual({ day: '29', month: 'Hoje' });
    expect(eventRowLabel(today, NOW)).toBe('hoje, São João de Irará, Irará, Bahia');
    expect(eventDateBadge(IRARA, NOW)).toEqual({ day: '21', month: 'OUT' });
  });

  it('o convite mostra os pontos por cadastro, e o leitor ouve para qual show é', () => {
    expect(inviteButtonText(IRARA)).toEqual({
      label: 'Chamar amigos +10',
      accessibilityLabel: 'Chamar amigos para São João de Irará, 10 pontos por cadastro',
    });
  });

  it.each([null, 0])('sem regra de pontos (%s), o convite sai sem o "+N"', (points) => {
    expect(inviteButtonText({ ...IRARA, invitePointsPerSignup: points })).toEqual({
      label: 'Chamar amigos',
      accessibilityLabel: 'Chamar amigos para São João de Irará',
    });
  });
});
