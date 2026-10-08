import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regras da equipe do painel (staff/, staffInvites/, staffAudit/) contra o
 * emulador. Rode com `npm run test:rules`. Tudo aqui é gravado pelo servidor;
 * o painel só lê, e o que ele lê depende de staff/{uid} com status 'active'.
 */
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'imagine-up-app',
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

const ALL_SECTIONS = [
  'overview',
  'growth',
  'ranking',
  'fans',
  'artists',
  'missions',
  'rewards',
  'moderation',
  'audit',
];

type Member = {
  role: 'admin' | 'editor' | 'viewer';
  status: 'pending' | 'active' | 'disabled';
  sections?: string[];
};

/** Membros gravados como o servidor grava. */
async function seedStaff(members: Record<string, Member>): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, member] of Object.entries(members)) {
      await setDoc(doc(db, `staff/${uid}`), {
        uid,
        email: `${uid}@imagine.music`,
        displayName: uid,
        role: member.role,
        sections: member.role === 'admin' ? ALL_SECTIONS : (member.sections ?? []),
        status: member.status,
        accountCreatedByInvite: true,
        inviteId: `convite-${uid}`,
        invitedBy: null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        updatedBy: null,
      });
    }
  });
}

/** Um convite pendente e uma entrada de auditoria. */
async function seedInviteAndAudit(): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'staffInvites/convite1'), {
      email: 'nova@imagine.music',
      suggestedName: 'Nova',
      role: 'viewer',
      sections: ['fans'],
      tokenHash: 'a'.repeat(64),
      status: 'pending',
      expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000),
      invitedBy: 'admin',
      invitedByName: 'admin',
    });
    await setDoc(doc(db, 'staffAudit/entrada1'), {
      action: 'invite.created',
      actorUid: 'admin',
      actorName: 'admin',
      targetEmail: 'nova@imagine.music',
      targetUid: null,
      details: { role: 'viewer' },
      createdAt: Timestamp.now(),
    });
  });
}

/** Firestore de um contexto de teste (logado ou não). */
type Db = ReturnType<RulesTestContext['firestore']>;

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

const listStaff = (db: Db) => getDocs(collection(db, 'staff'));
const listInvites = (db: Db) => getDocs(collection(db, 'staffInvites'));
const pendingInvites = (db: Db) =>
  getDocs(query(collection(db, 'staffInvites'), where('status', '==', 'pending')));
const recentAudit = (db: Db) =>
  getDocs(query(collection(db, 'staffAudit'), orderBy('createdAt', 'desc'), limit(50)));

/** Nenhuma leitura da equipe passa para esta pessoa (`other` é o doc de outra pessoa). */
async function readsNothing(db: Db, other = 'admin'): Promise<void> {
  await assertFails(getDoc(doc(db, `staff/${other}`)));
  await assertFails(listStaff(db));
  await assertFails(getDoc(doc(db, 'staffInvites/convite1')));
  await assertFails(listInvites(db));
  await assertFails(pendingInvites(db));
  await assertFails(getDoc(doc(db, 'staffAudit/entrada1')));
  await assertFails(recentAudit(db));
}

describe('equipe do painel: quem lê', () => {
  beforeEach(async () => {
    await seedStaff({
      admin: { role: 'admin', status: 'active' },
      editor: { role: 'editor', status: 'active', sections: ['fans', 'missions'] },
      auditor: { role: 'editor', status: 'active', sections: ['audit'] },
      leitor: { role: 'viewer', status: 'active', sections: ['ranking'] },
      desativado: { role: 'editor', status: 'disabled', sections: ['audit'] },
      pendente: { role: 'admin', status: 'pending' },
    });
    await seedInviteAndAudit();
  });

  it('fã (logado, sem staff) não lê nada da equipe', async () => {
    await readsNothing(as('fa'));
  });

  it('fã lê o próprio staff/{uid}, que não existe: é assim que o painel vê "sem acesso"', async () => {
    const own = await assertSucceeds(getDoc(doc(as('fa'), 'staff/fa')));
    expect(own.exists()).toBe(false);
  });

  it('sem login, nada', async () => {
    await readsNothing(anonymous());
  });

  it('custom claim de admin não vale nada sem o doc em staff', async () => {
    const claims = env.authenticatedContext('fa', { staff: true, role: 'admin' }).firestore();
    await readsNothing(claims);
  });

  it('admin ativo lê e lista a equipe e os convites', async () => {
    const db = as('admin');
    await assertSucceeds(getDoc(doc(db, 'staff/editor')));
    await assertSucceeds(getDoc(doc(db, 'staff/desativado')));
    await assertSucceeds(listStaff(db));
    await assertSucceeds(getDoc(doc(db, 'staffInvites/convite1')));
    await assertSucceeds(listInvites(db));
    await assertSucceeds(pendingInvites(db));
  });

  it('editor e leitor sem a seção audit não listam a equipe nem os convites', async () => {
    for (const uid of ['editor', 'leitor']) {
      const db = as(uid);
      await assertFails(listStaff(db));
      await assertFails(getDoc(doc(db, 'staff/admin')));
      await assertFails(listInvites(db));
      await assertFails(pendingInvites(db));
      await assertFails(getDoc(doc(db, 'staffInvites/convite1')));
    }
  });

  it('quem tem a seção audit lê e lista a equipe (o filtro por pessoa dos Logs), e não os convites (bloco 11)', async () => {
    const db = as('auditor');
    await assertSucceeds(listStaff(db));
    await assertSucceeds(getDoc(doc(db, 'staff/admin')));
    await assertSucceeds(getDoc(doc(db, 'staff/desativado')));
    await assertFails(listInvites(db));
    await assertFails(pendingInvites(db));
    await assertFails(getDoc(doc(db, 'staffInvites/convite1')));
    // O desativado com audit não lê a equipe.
    await assertFails(listStaff(as('desativado')));
    await assertFails(getDoc(doc(as('desativado'), 'staff/admin')));
  });

  it('os filtros dos Logs (seção, pessoa, ação e alvo) passam para quem tem audit (bloco 11)', async () => {
    const db = as('auditor');
    const audit = collection(db, 'staffAudit');
    for (const filter of [
      where('section', '==', 'team'),
      where('actorUid', '==', 'admin'),
      where('action', '==', 'invite.created'),
      where('targets', 'array-contains', 'invite:convite1'),
    ]) {
      await assertSucceeds(getDocs(query(audit, filter, orderBy('createdAt', 'desc'), limit(50))));
      await assertFails(
        getDocs(
          query(collection(as('editor'), 'staffAudit'), filter, orderBy('createdAt', 'desc')),
        ),
      );
    }
  });

  it('cada membro lê o próprio doc, em qualquer status', async () => {
    for (const uid of ['editor', 'leitor', 'desativado', 'pendente']) {
      await assertSucceeds(getDoc(doc(as(uid), `staff/${uid}`)));
    }
  });

  it('auditoria: só admin ou quem tem a seção audit', async () => {
    for (const uid of ['admin', 'auditor']) {
      await assertSucceeds(getDoc(doc(as(uid), 'staffAudit/entrada1')));
      await assertSucceeds(recentAudit(as(uid)));
    }
    for (const uid of ['editor', 'leitor', 'desativado', 'pendente']) {
      await assertFails(getDoc(doc(as(uid), 'staffAudit/entrada1')));
      await assertFails(recentAudit(as(uid)));
    }
  });

  it('membro desativado, ou ainda pendente, não tem leitura de admin', async () => {
    await readsNothing(as('pendente'));
    await readsNothing(as('desativado'));
  });
});

describe('equipe do painel: desativar corta na hora', () => {
  it('admin desativado perde as leituras de admin no pedido seguinte', async () => {
    await seedStaff({
      admin: { role: 'admin', status: 'active' },
      outro: { role: 'admin', status: 'active' },
    });
    await seedInviteAndAudit();
    const db = as('outro');
    await assertSucceeds(listStaff(db));
    await assertSucceeds(recentAudit(db));

    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'staff/outro'), { status: 'disabled' });
    });

    await assertFails(listStaff(db));
    await assertFails(getDoc(doc(db, 'staff/admin')));
    await assertFails(listInvites(db));
    await assertFails(recentAudit(db));
    // O próprio doc continua legível, para o painel dizer que o acesso foi desativado.
    await assertSucceeds(getDoc(doc(db, 'staff/outro')));
  });

  it('removido (sem doc) não lê mais nada', async () => {
    await seedStaff({ admin: { role: 'admin', status: 'active' } });
    await seedInviteAndAudit();
    await env.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'staff/admin'));
    });
    await readsNothing(as('admin'), 'alguem');
    // O próprio doc sumiu: o painel lê "não existe" e tira a pessoa.
    const own = await assertSucceeds(getDoc(doc(as('admin'), 'staff/admin')));
    expect(own.exists()).toBe(false);
  });
});

describe('equipe do painel: conta ligada vale só a partir do login que ligou', () => {
  // authValidAfter é o auth_time do login que chamou o linkStaffInvite.
  const LINKED_AT = 1_800_000_000;
  const session = (authTime: number) =>
    env.authenticatedContext('ligada', { auth_time: authTime }).firestore();

  beforeEach(async () => {
    await seedStaff({ ligada: { role: 'admin', status: 'active' } });
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'staff/ligada'), { authValidAfter: LINKED_AT });
    });
    await seedInviteAndAudit();
  });

  it('sessão com login anterior (token de quem criou a conta) não lê nada da equipe', async () => {
    await readsNothing(session(LINKED_AT - 1));
    // O próprio doc continua legível; o resto da equipe, não.
    await assertSucceeds(getDoc(doc(session(LINKED_AT - 1), 'staff/ligada')));
  });

  it('o login que ligou e os seguintes leem como admin', async () => {
    for (const authTime of [LINKED_AT, LINKED_AT + 3600]) {
      const db = session(authTime);
      await assertSucceeds(listStaff(db));
      await assertSucceeds(pendingInvites(db));
      await assertSucceeds(recentAudit(db));
    }
  });
});

describe('equipe do painel: ninguém grava pelo cliente', () => {
  beforeEach(async () => {
    await seedStaff({
      admin: { role: 'admin', status: 'active' },
      editor: { role: 'editor', status: 'active', sections: ['fans'] },
    });
    await seedInviteAndAudit();
  });

  it('fã não se põe na equipe', async () => {
    await assertFails(
      setDoc(doc(as('fa'), 'staff/fa'), {
        uid: 'fa',
        role: 'admin',
        sections: ALL_SECTIONS,
        status: 'active',
      }),
    );
  });

  it('nem admin ativo grava staff, convites ou auditoria', async () => {
    const db = as('admin');
    await assertFails(setDoc(doc(db, 'staff/nova'), { role: 'admin', status: 'active' }));
    await assertFails(updateDoc(doc(db, 'staff/editor'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'staff/admin'), { displayName: 'Outro nome' }));
    await assertFails(deleteDoc(doc(db, 'staff/editor')));
    await assertFails(setDoc(doc(db, 'staffInvites/convite2'), { email: 'x@y.io' }));
    await assertFails(updateDoc(doc(db, 'staffInvites/convite1'), { status: 'canceled' }));
    await assertFails(deleteDoc(doc(db, 'staffInvites/convite1')));
    await assertFails(setDoc(doc(db, 'staffAudit/entrada2'), { action: 'member.updated' }));
    await assertFails(deleteDoc(doc(db, 'staffAudit/entrada1')));
  });

  it('editor não muda o próprio papel nem as seções', async () => {
    await assertFails(updateDoc(doc(as('editor'), 'staff/editor'), { role: 'admin' }));
    await assertFails(updateDoc(doc(as('editor'), 'staff/editor'), { sections: ALL_SECTIONS }));
  });

  it('subcoleções da equipe também são do servidor', async () => {
    await assertFails(getDoc(doc(as('admin'), 'staff/admin/notas/1')));
    await assertFails(setDoc(doc(as('admin'), 'staff/admin/notas/1'), { texto: 'x' }));
  });
});
