import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * The SQL files this version of the site needs on the database, beyond those recorded by
 * supabase/app_v1.sql. Add a file here in the same change that adds the code using it, and add it
 * to the end of supabase/manifest.txt. The admin panel warns while any of them has not run.
 */
export const REQUIRED_SQL = ["app_v1.sql", "court_v9.sql", "court_cases_v7.sql", "mafia_v8.sql", "site_v1.sql", "grid_v2.sql", "grid_fakes_v1.sql", "mafia_v9.sql", "mafia_v10.sql", "mafia_v11.sql", "mafia_v12.sql"];

export type SchemaStatus = { missing: string[]; last?: string | null; noTracking?: boolean } | null;

/** Which required SQL files have not run yet on this database (admins only; null while loading). */
export function useSchemaStatus(enabled: boolean): SchemaStatus {
  const [status, setStatus] = useState<SchemaStatus>(null);
  useEffect(() => {
    if (!enabled || !supabase) return;
    void supabase.rpc("app_schema_status", { p_files: REQUIRED_SQL }).then(({ data, error }) => {
      if (error) {
        // app_v1.sql itself has not run: everything from it on is missing.
        if (error.code === "PGRST202" || error.code === "42883") setStatus({ missing: REQUIRED_SQL, noTracking: true });
        return;
      }
      setStatus(data as SchemaStatus);
    });
  }, [enabled]);
  return status;
}
