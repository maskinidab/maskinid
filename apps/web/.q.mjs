import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
const dir = "public/demo-db/";
const f = dir + readdirSync(dir).find((x) => x.startsWith("maskinid-"));
const db = await PGlite.create({ loadDataDir: new Blob([readFileSync(f)]), extensions: { pgcrypto, pg_trgm } });
for (const q of process.argv.slice(2)) console.log(JSON.stringify((await db.query(q)).rows));
