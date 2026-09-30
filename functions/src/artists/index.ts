// Artistas e centrais: o painel cria, edita, publica e ordena as centrais dos
// artistas. As callables ficam em src/index.ts, depois do setGlobalOptions.
export { artistError, errorReason, type ArtistErrorReason } from './errors';
export { bucketFiles, type ArtistFiles, type Bucket, type StoredFile } from './files';
export {
  GENRES,
  HANDLE_PATTERN,
  RESERVED_HANDLES,
  suggestHandle,
  type ArtistImage,
  type ArtistStatus,
  type Genre,
} from './model';
export {
  addArtist,
  changeArtistStatus,
  checkHandle,
  editArtist,
  removeArtist,
  reorderArtistList,
  type Artist,
  type ArtistPrivate,
  type ArtistDeps,
  type ArtistHandleReservation,
  type HandleCheck,
} from './service';
