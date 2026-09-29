// Equipe do painel admin: convites, aceite e gestão de quem entra no painel.
// As callables ficam em src/index.ts, depois do setGlobalOptions.
export {
  DEFAULT_PANEL_URL,
  emailConfig,
  EMAILJS_PRIVATE_KEY,
  PANEL_ORIGINS,
  PANEL_URL,
  panelUrl,
} from './config';
export { sendInviteEmail } from './email';
export { staffError, type StaffErrorReason } from './errors';
export { ROLE_LABELS, SECTION_IDS, STAFF_ROLES, type SectionId, type StaffRole } from './model';
export {
  acceptInvite,
  cancelInvite,
  createBootstrapInvite,
  createInvite,
  getInvite,
  linkInvite,
  removeMember,
  resendInvite,
  setMemberActive,
  updateMember,
  type StaffDeps,
} from './service';
export { hashInviteToken, newInviteToken, tokenMatches } from './token';
