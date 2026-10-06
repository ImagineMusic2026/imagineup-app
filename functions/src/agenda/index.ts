// Agenda (bloco 6): os shows das centrais, o "Eu vou" (a mesma presença do
// post de show), as callables do painel e o seed. A API
// (src/api/routes/agenda.ts) usa daqui; o seed dos emuladores carrega o build
// (functions/lib/agenda). docs/arquitetura-api.md, seção 21.
export { eventPanelError, type EventPanelErrorReason } from './errors';
export {
  AGENDA_LIMIT_DEFAULT,
  agendaCutoff,
  AgendaError,
  BRAZIL_STATES,
  BRAZIL_TIME_ZONES,
  DEFAULT_TIME_ZONE_BY_STATE,
  isEventOpen,
  RSVP_READ_MAX,
  zonedLocalToUtc,
  type AgendaErrorReason,
  type EventRecord,
} from './model';
export { addEvent, changeEventStatus, editEvent, removeEvent } from './panel';
export { SEED_EVENTS, seedEventLocal, seedEvents } from './seed';
export {
  readAgenda,
  readMyRsvps,
  rsvpEvent,
  runRsvp,
  unrsvpEvent,
  type RsvpOutcome,
} from './service';
export { eventRef, eventsRef, rsvpRef, rsvpsRef } from './store';
