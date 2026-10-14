// Length limits shared by the UI and the server. Deliberately dependency-free: Client
// Components import from here rather than from validators.ts, which would drag zod into
// the browser bundle (and uses Buffer, which does not exist there).

// Maximum card description length, the same in the UI, the API and the import.
export const CARD_DESCRIPTION_MAX = 5000;
