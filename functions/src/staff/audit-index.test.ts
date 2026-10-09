import { describe, expect, it } from 'vitest';

import { AUDIT_TARGETS_MAX, auditIndex, auditSection, type AuditSection } from './audit-index';
import type { AuditAction } from './service';

// A seção e os alvos de cada ação da auditoria (26.8), uma linha por ação, com
// o `details` que a função grava de verdade. A tabela é um Record de todo o
// AuditAction: ação nova sem linha aqui quebra o `npm --prefix functions run
// typecheck`.

type Row = {
  targetUid?: string | null;
  details: Record<string, unknown>;
  section: AuditSection;
  targets: string[];
};

const ROWS: Record<AuditAction, Row> = {
  'invite.created': {
    details: {
      inviteId: 'conv1',
      role: 'editor',
      sections: ['fans'],
      replacedInviteIds: ['conv0'],
    },
    section: 'team',
    targets: ['invite:conv1', 'invite:conv0'],
  },
  'invite.resent': {
    details: { inviteId: 'conv1', sendCount: 2 },
    section: 'team',
    targets: ['invite:conv1'],
  },
  'invite.canceled': {
    details: { inviteId: 'conv1', reason: 'admin', issuerLostAdmin: 'uid-admin' },
    section: 'team',
    targets: ['invite:conv1'],
  },
  'invite.accepted': {
    targetUid: 'uid-nova',
    details: { inviteId: 'conv1', role: 'viewer', sections: [], accountCreatedByInvite: true },
    section: 'team',
    targets: ['staff:uid-nova', 'invite:conv1'],
  },
  'member.updated': {
    targetUid: 'uid-membro',
    details: { from: { role: 'admin' }, to: { role: 'editor' }, canceledInviteIds: ['conv2'] },
    section: 'team',
    targets: ['staff:uid-membro', 'invite:conv2'],
  },
  'member.disabled': {
    targetUid: 'uid-membro',
    details: { role: 'editor', from: 'active', to: 'disabled' },
    section: 'team',
    targets: ['staff:uid-membro'],
  },
  'member.enabled': {
    targetUid: 'uid-membro',
    details: { role: 'editor', from: 'disabled', to: 'active' },
    section: 'team',
    targets: ['staff:uid-membro'],
  },
  'member.removed': {
    targetUid: 'uid-membro',
    details: { role: 'editor', managedArtistIds: ['nenho', 'nettobrito'] },
    section: 'team',
    targets: ['staff:uid-membro', 'artist:nenho', 'artist:nettobrito'],
  },
  'artist.created': {
    details: { artistId: 'nenho', name: 'Nenho' },
    section: 'artists',
    targets: ['artist:nenho'],
  },
  'artist.updated': {
    details: { artistId: 'nenho', name: 'Nenho', changed: ['bio'] },
    section: 'artists',
    targets: ['artist:nenho'],
  },
  'artist.published': {
    details: { artistId: 'nenho', name: 'Nenho', from: 'draft' },
    section: 'artists',
    targets: ['artist:nenho'],
  },
  'artist.unpublished': {
    details: { artistId: 'nenho', name: 'Nenho', from: 'published' },
    section: 'artists',
    targets: ['artist:nenho'],
  },
  'artist.deleted': {
    details: { artistId: 'artista7', name: 'Artista 7', status: 'draft', wasPublished: false },
    section: 'artists',
    targets: ['artist:artista7'],
  },
  'artist.reordered': {
    details: { artistIds: ['nenho', 'nettobrito'], moved: ['nenho'] },
    section: 'artists',
    targets: ['artist:nenho', 'artist:nettobrito'],
  },
  'post.created': {
    details: { postId: 'p-clipe', artistId: 'nettobrito', kind: 'video' },
    section: 'artists',
    targets: ['artist:nettobrito', 'post:p-clipe'],
  },
  'post.updated': {
    details: { postId: 'p-clipe', artistId: 'nettobrito', kind: 'video', changed: ['text'] },
    section: 'artists',
    targets: ['artist:nettobrito', 'post:p-clipe'],
  },
  'post.published': {
    details: { postId: 'p-clipe', artistId: 'nettobrito', from: 'draft' },
    section: 'artists',
    targets: ['artist:nettobrito', 'post:p-clipe'],
  },
  'post.unpublished': {
    details: { postId: 'p-clipe', artistId: 'nettobrito', from: 'published' },
    section: 'artists',
    targets: ['artist:nettobrito', 'post:p-clipe'],
  },
  'post.deleted': {
    details: { postId: 'p-rascunho', artistId: 'nenho', kind: 'text' },
    section: 'artists',
    targets: ['artist:nenho', 'post:p-rascunho'],
  },
  'event.created': {
    details: { eventId: 'e-irara', title: 'São João', artistIds: ['nenho', 'nettobrito'] },
    section: 'artists',
    targets: ['artist:nenho', 'artist:nettobrito', 'event:e-irara'],
  },
  'event.updated': {
    details: { eventId: 'e-irara', title: 'São João', changed: ['city'] },
    section: 'artists',
    targets: ['event:e-irara'],
  },
  'event.published': {
    details: { eventId: 'e-irara', title: 'São João', from: 'draft' },
    section: 'artists',
    targets: ['event:e-irara'],
  },
  'event.unpublished': {
    details: { eventId: 'e-irara', title: 'São João', from: 'published' },
    section: 'artists',
    targets: ['event:e-irara'],
  },
  'event.deleted': {
    details: { eventId: 'e-rascunho', title: 'Rascunho', artistIds: ['nenho'] },
    section: 'artists',
    targets: ['artist:nenho', 'event:e-rascunho'],
  },
  'comment.hidden': {
    details: { postId: 'p-clipe', commentId: 'c1', artistId: 'nettobrito', authorUid: 'uid-spam' },
    section: 'moderation',
    targets: ['artist:nettobrito', 'post:p-clipe', 'comment:c1', 'fan:uid-spam'],
  },
  'comment.kept': {
    details: { postId: 'p-clipe', commentId: 'c1', artistId: null, authorUid: 'uid-enzo' },
    section: 'moderation',
    targets: ['post:p-clipe', 'comment:c1', 'fan:uid-enzo'],
  },
  'comment.restored': {
    details: { postId: 'p-clipe', commentId: 'c1', artistId: 'nettobrito', authorUid: null },
    section: 'moderation',
    targets: ['artist:nettobrito', 'post:p-clipe', 'comment:c1'],
  },
  'fan.username.reset': {
    targetUid: 'uid-fa',
    details: { uid: 'uid-fa', previous: 'nettobrito', username: 'fa123456' },
    section: 'moderation',
    targets: ['fan:uid-fa'],
  },
  'fan.photo.removed': {
    targetUid: 'uid-fa',
    details: { uid: 'uid-fa' },
    section: 'moderation',
    targets: ['fan:uid-fa'],
  },
  // O perfil novo (28.6): os campos que saíram, nunca o texto.
  'fan.profile.cleared': {
    targetUid: 'uid-fa',
    details: { uid: 'uid-fa', fields: ['bio', 'socials'] },
    section: 'moderation',
    targets: ['fan:uid-fa'],
  },
  'fan.suspended': {
    targetUid: 'uid-fa',
    details: { uid: 'uid-fa', reason: 'spam', note: 'Propaganda' },
    section: 'moderation',
    targets: ['fan:uid-fa'],
  },
  'fan.unsuspended': {
    targetUid: 'uid-fa',
    details: { uid: 'uid-fa' },
    section: 'moderation',
    targets: ['fan:uid-fa'],
  },
  'fan.comments.hidden': {
    targetUid: 'uid-fa',
    details: {
      uid: 'uid-fa',
      count: 3,
      postIds: ['p-clipe', 'p-show'],
      commentIds: ['c1', 'c2', 'c3'],
    },
    section: 'moderation',
    targets: [
      'fan:uid-fa',
      'post:p-clipe',
      'post:p-show',
      'comment:c1',
      'comment:c2',
      'comment:c3',
    ],
  },
  'points.config.updated': {
    details: { fields: ['values'], fromVersion: 1, toVersion: 2 },
    section: 'missions',
    targets: [],
  },
  'mission.created': {
    details: { missionId: 'm1', title: 'Curta 5 posts', fromVersion: 1, toVersion: 2 },
    section: 'missions',
    targets: ['mission:m1'],
  },
  'mission.updated': {
    details: { missionId: 'm1', fields: ['title'] },
    section: 'missions',
    targets: ['mission:m1'],
  },
  'mission.published': {
    details: { missionId: 'm1', restored: true },
    section: 'missions',
    targets: ['mission:m1'],
  },
  'mission.archived': {
    details: { missionId: 'm1' },
    section: 'missions',
    targets: ['mission:m1'],
  },
  'mission.reordered': {
    details: { missionIds: ['m2', 'm1'] },
    section: 'missions',
    targets: ['mission:m2', 'mission:m1'],
  },
  'season.goal.updated': {
    details: { seasonId: 'sao-joao', metric: 'missions' },
    section: 'missions',
    targets: ['season:sao-joao'],
  },
  'achievement.created': {
    details: { achievementId: 'a1', title: 'Fã de show' },
    section: 'missions',
    targets: ['achievement:a1'],
  },
  'achievement.updated': {
    details: { achievementId: 'a1', fields: ['title'] },
    section: 'missions',
    targets: ['achievement:a1'],
  },
  'achievement.published': {
    details: { achievementId: 'a1' },
    section: 'missions',
    targets: ['achievement:a1'],
  },
  'achievement.archived': {
    details: { achievementId: 'a1' },
    section: 'missions',
    targets: ['achievement:a1'],
  },
  'achievement.reordered': {
    details: { achievementIds: ['a2', 'a1'] },
    section: 'missions',
    targets: ['achievement:a2', 'achievement:a1'],
  },
  'config.seeded': { details: { doc: 'points', version: 1 }, section: 'missions', targets: [] },
  'season.updated': {
    details: { seasonId: 'sao-joao', previousSeasonId: null },
    section: 'ranking',
    targets: ['season:sao-joao'],
  },
  'season.next.updated': {
    details: { seasonId: 'primavera', previousSeasonId: 'outono' },
    section: 'ranking',
    targets: ['season:primavera', 'season:outono'],
  },
  'season.ended': {
    details: { seasonId: 'sao-joao', plannedEndsAt: '2026-10-20T03:00:00.000Z' },
    section: 'ranking',
    targets: ['season:sao-joao'],
  },
  'season.close.requested': {
    details: { seasonId: 'sao-joao', status: 'closed', pages: 1 },
    section: 'ranking',
    targets: ['season:sao-joao'],
  },
  'season.closed': {
    details: {
      seasonId: 'carnaval',
      rankedFans: 48,
      nextSeasonId: 'sao-joao',
      expiredNextSeasonId: null,
    },
    section: 'ranking',
    targets: ['season:carnaval', 'season:sao-joao'],
  },
  'reward.created': {
    details: { rewardId: 'r1', title: 'Meet & greet', kind: 'experience' },
    section: 'rewards',
    targets: ['reward:r1'],
  },
  'reward.updated': {
    details: { rewardId: 'r1', changed: ['cost'] },
    section: 'rewards',
    targets: ['reward:r1'],
  },
  'reward.published': {
    details: { rewardId: 'r1', title: 'Meet', reopened: true },
    section: 'rewards',
    targets: ['reward:r1'],
  },
  'reward.closed': {
    details: { rewardId: 'r1', title: 'Meet' },
    section: 'rewards',
    targets: ['reward:r1'],
  },
  'reward.stock.updated': {
    details: { rewardId: 'r1', before: 20, after: 25, redeemed: 3 },
    section: 'rewards',
    targets: ['reward:r1'],
  },
  'reward.reordered': {
    details: { rewardIds: ['r2', 'r1'] },
    section: 'rewards',
    targets: ['reward:r2', 'reward:r1'],
  },
  'reward.deleted': {
    details: { rewardId: 'r9', kind: 'product', title: 'Rascunho' },
    section: 'rewards',
    targets: ['reward:r9'],
  },
  'redemption.approved': {
    details: { code: 'UP-7QXH2R', rewardId: 'r1', from: 'requested', to: 'approved' },
    section: 'rewards',
    targets: ['reward:r1', 'redemption:UP-7QXH2R'],
  },
  'redemption.delivered': {
    details: { code: 'UP-7QXH2R', rewardId: 'r1', from: 'approved', to: 'delivered' },
    section: 'rewards',
    targets: ['reward:r1', 'redemption:UP-7QXH2R'],
  },
  'redemption.refused': {
    details: { code: 'UP-9FJT6V', rewardId: 'r1', refundedPoints: 8500, restocked: true },
    section: 'rewards',
    targets: ['reward:r1', 'redemption:UP-9FJT6V'],
  },
  'redemption.contacts.viewed': {
    details: { codes: ['UP-C3NWPB', 'UP-7QXH2R'], count: 2 },
    section: 'rewards',
    targets: ['redemption:UP-C3NWPB', 'redemption:UP-7QXH2R'],
  },
  'wallet.adjusted': {
    targetUid: 'uid-camila',
    details: {
      entryId: 'adjustment:aj12345678',
      balance: 100,
      central: { artistId: 'nenho', season: 10 },
      seasonId: 'sao-joao',
      note: 'Devolução',
    },
    section: 'fans',
    targets: ['fan:uid-camila', 'season:sao-joao', 'artist:nenho'],
  },
  'fan.email.lookup': {
    targetUid: 'uid-bia',
    details: { found: true },
    section: 'fans',
    targets: ['fan:uid-bia'],
  },
};

describe('auditIndex: uma linha por ação', () => {
  it.each(Object.entries(ROWS))('%s', (action, row) => {
    expect(auditIndex({ action, targetUid: row.targetUid ?? null, details: row.details })).toEqual({
      section: row.section,
      targets: row.targets,
    });
  });
});

describe('auditIndex: as pontas', () => {
  it('a busca por e-mail sem resultado não tem alvo', () => {
    expect(
      auditIndex({ action: 'fan.email.lookup', targetUid: null, details: { found: false } }),
    ).toEqual({ section: 'fans', targets: [] });
  });

  it('listas longas entram até o teto de 50, sem repetir', () => {
    const artistIds = Array.from({ length: 240 }, (_, index) => `central${index}`);
    const { targets } = auditIndex({
      action: 'artist.reordered',
      details: { artistIds: [...artistIds.slice(0, 2), ...artistIds] },
    });
    expect(AUDIT_TARGETS_MAX).toBe(50);
    expect(targets).toHaveLength(50);
    expect(targets.slice(0, 3)).toEqual(['artist:central0', 'artist:central1', 'artist:central2']);
  });

  it('details torto não quebra: o que não é id fica de fora', () => {
    expect(auditIndex({ action: 'comment.hidden', targetUid: 42, details: 'texto' })).toEqual({
      section: 'moderation',
      targets: [],
    });
    expect(
      auditIndex({
        action: 'post.created',
        details: { postId: ['p1', 7, null, '', 'a/b'], artistId: { x: 1 }, rewardIds: 'r1' },
      }),
    ).toEqual({ section: 'artists', targets: ['post:p1', 'reward:r1'] });
    expect(auditIndex({ action: undefined, details: null })).toEqual({
      section: null,
      targets: [],
    });
  });

  it('a ação que o painel não conhece fica sem seção, com os alvos que der', () => {
    expect(auditIndex({ action: 'futuro.qualquer', details: { postId: 'p1' } })).toEqual({
      section: null,
      targets: ['post:p1'],
    });
    expect(auditSection('fan.algo-novo')).toBeNull();
  });
});
