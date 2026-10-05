/** Production builds never open the embedded database. Supabase is required. */
export class PGlite {
  constructor() {
    throw new Error("DATABASE_URL is required. Connect the Supabase session pooler.");
  }
}
