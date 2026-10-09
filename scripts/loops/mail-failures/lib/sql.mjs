// Runs one statement against an instance's encrypted database and prints the rows as JSON.
// A separate process, so the same helper reaches a data directory on the host or inside a container.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const [dataDir, statement, paramsJson = "[]"] = process.argv.slice(2);
const root = new URL("../../../../", import.meta.url).pathname;
const Database = createRequire(`${root}packages/db/package.json`)("better-sqlite3");

const db = new Database(`${dataDir}/kickrocks.db`);
db.pragma("cipher='sqlcipher'");
db.pragma("legacy=4");
db.pragma(`key="x'${readFileSync(`${dataDir}/db.key`, "utf8").trim()}'"`);
db.pragma("busy_timeout=5000");
const params = JSON.parse(paramsJson);
const query = db.prepare(statement);
console.log(JSON.stringify(query.reader ? query.all(...params) : [query.run(...params)]));
db.close();
