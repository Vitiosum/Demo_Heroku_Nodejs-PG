// Moving day: what the views show about the move from Heroku to Clever Cloud.
// The routes live in index.js; this file only builds the inventory of boxes,
// the "Running on Clever Cloud" panel and the barcode of the shipping label.

const STAMPS = {
  same: "Same",
  renamed: "Renamed",
  unneeded: "Not needed",
  added: "Added",
};

// The only environment variables the page ever prints.
const PLATFORM_VARS = [
  "CC_APP_NAME",
  "APP_ID",
  "INSTANCE_NUMBER",
  "INSTANCE_TYPE",
  "CC_PRETTY_INSTANCE_NAME",
  "CC_COMMIT_ID",
  "CC_DEPLOYMENT_ID",
];

function platform() {
  const env = process.env;
  const rows = PLATFORM_VARS.map((name) => {
    let value = env[name] || "";
    if (name === "CC_COMMIT_ID") value = value.slice(0, 7);
    return { name, value };
  });
  return {
    onClever: Boolean(env.CC_APP_NAME || env.APP_ID),
    appName: env.CC_APP_NAME || "",
    commit: (env.CC_COMMIT_ID || "").slice(0, 7),
    deployment: env.CC_DEPLOYMENT_ID || "",
    instance: env.INSTANCE_NUMBER !== undefined
      ? `Instance ${env.INSTANCE_NUMBER}${env.INSTANCE_TYPE ? `, ${env.INSTANCE_TYPE}` : ""}`
      : "",
    rows,
  };
}

// What the database box says right now, from the queries of the home page.
function databaseNow(db) {
  if (!db.configured) return "No database set: DATABASE_URL and POSTGRESQL_ADDON_URI are both empty";
  if (!db.ok) return `PostgreSQL did not answer (${db.problem.code})`;
  return `PostgreSQL ${db.version} answering`;
}

function tableNow(db) {
  if (!db.configured || !db.ok) return "Nothing to count without a database";
  if (db.rows === null) return "test_table not built yet: open /db-init";
  return `test_table holds ${db.rows} ${db.rows === 1 ? "row" : "rows"}`;
}

function tlsNow(db) {
  if (!db.configured || !db.ok || !db.tls) return null;
  if (db.tls.ssl) return `TLS on: ${db.tls.version}, ${db.tls.cipher}`;
  return "TLS off on this connection (sslmode=disable, local run)";
}

// One box per piece of the Heroku setup. `now` is what that piece is doing
// in this process, at this request; null when there is nothing live to show.
function inventory(live) {
  const { db, dbVar, port, times, startedBy, cc } = live;
  const boxes = [
    {
      name: "Deploy and CLI",
      stamp: "renamed",
      heroku: { code: "git push heroku main", note: "then heroku logs, heroku open" },
      clever: { code: "clever deploy", note: "then clever logs, clever open" },
      now: cc.commit ? `Commit ${cc.commit} deployed` : "Running from a local checkout",
    },
    {
      name: "Buildpack",
      stamp: "renamed",
      heroku: { code: "heroku/nodejs", note: "detected from package.json" },
      clever: { code: "clever create --type node", note: "the Node.js runtime: no buildpack to pick" },
      now: null,
    },
    {
      name: "engines.node",
      stamp: "same",
      heroku: { code: "20.x || 22.x || 24.x", note: "chooses the Node.js version" },
      clever: { code: "20.x || 22.x || 24.x", note: "read the same way by the runtime" },
      now: `Running Node.js ${process.version}`,
    },
    {
      name: "Procfile",
      stamp: "unneeded",
      heroku: { code: "web: node index.js", note: "the web process" },
      clever: { code: "npm start", note: "scripts.start is the same node index.js; the Procfile stays, unread" },
      now: `Started by ${startedBy}`,
    },
    {
      name: "PORT",
      stamp: "same",
      heroku: { code: "process.env.PORT", note: "given to the dyno" },
      clever: { code: "process.env.PORT", note: "8080 on Clever Cloud" },
      now: `Listening on port ${port}`,
    },
    {
      name: "Dynos",
      stamp: "renamed",
      heroku: { code: "web.1", note: "dyno size and count" },
      clever: { code: "clever scale", note: "nano to XS, 1 to 2 instances" },
      now: cc.instance || "One process on this machine",
    },
    {
      name: "Database add-on",
      stamp: "renamed",
      heroku: { code: "heroku addons:create heroku-postgresql", note: null },
      clever: { code: "clever addon create postgresql-addon", note: "dedicated, encrypted, then clever service link-addon" },
      now: databaseNow(db),
    },
    {
      name: "DATABASE_URL",
      stamp: "renamed",
      heroku: { code: "DATABASE_URL", note: "set by Heroku Postgres" },
      clever: { code: "POSTGRESQL_ADDON_URI", note: "injected by the linked add-on: the one changed line reads it when DATABASE_URL is absent" },
      now: dbVar ? `Read at startup: ${dbVar}` : "Neither variable is set",
    },
    {
      name: "TLS to the database",
      stamp: "same",
      heroku: { code: "ssl: { rejectUnauthorized: false }", note: null },
      clever: { code: "ssl: { rejectUnauthorized: false }", note: "the add-on accepts TLS" },
      now: tlsNow(db),
    },
    {
      name: "Config vars",
      stamp: "renamed",
      heroku: { code: "heroku config:set TIMES=2", note: ".env read by heroku local" },
      clever: { code: "clever env set TIMES 2", note: ".env read by npm run local" },
      now: `/times answers ${times.trim() || "nothing"}`,
    },
    {
      name: "The table",
      stamp: "added",
      heroku: { code: "heroku pg:psql", note: "then CREATE TABLE by hand" },
      clever: { code: "/db-init", note: "creates test_table; rows go in with psql" },
      now: tableNow(db),
    },
    {
      name: "app.json",
      stamp: "unneeded",
      heroku: { code: "app.json", note: "the Heroku Button manifest" },
      clever: { code: null, note: "not read; kept in the repo" },
      now: null,
    },
  ];
  return boxes.map((box, i) => ({ ...box, no: i + 1, stampLabel: STAMPS[box.stamp] }));
}

function stampCounts(boxes) {
  return Object.keys(STAMPS).map((key) => ({
    key,
    label: STAMPS[key],
    count: boxes.filter((box) => box.stamp === key).length,
  }));
}

// Bars of the shipping-label barcode, drawn from the deployment ID (or "local").
function barcode(text) {
  let seed = 7;
  for (const ch of text) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const bars = [];
  let x = 0;
  for (let i = 0; i < 46; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const w = 1 + ((seed >>> 16) % 3);
    bars.push({ x, w });
    x += w + 1 + ((seed >>> 9) % 2);
  }
  return { bars, width: x };
}

module.exports = { platform, inventory, stampCounts, barcode };
