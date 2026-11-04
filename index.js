const express = require("express");
const path = require("path");
const cool = require("cool-ascii-faces");

const port = process.env.PORT || 5006;

const app = express();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || process.env.POSTGRESQL_ADDON_URI,
  ssl: {
    rejectUnauthorized: false,
  },
  // Answer 503 within 5 s when PostgreSQL is unreachable, instead of hanging.
  connectionTimeoutMillis: 5000,
});
// A pooled connection dropped by the server must not crash the app.
pool.on("error", (err) => console.error("PostgreSQL pool error:", err.code || err.message));

// Moving day: the inventory and the Clever Cloud panel shown by the views.
const move = require("./moving-day");

// Which variable the pool read, by name only (never its value).
const dbVar = process.env.DATABASE_URL
  ? "DATABASE_URL"
  : process.env.POSTGRESQL_ADDON_URI
    ? "POSTGRESQL_ADDON_URI"
    : null;

app.use(express.static(path.join(__dirname, "public")));
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Every page carries a delivery note: the SQL it ran, numbered per instance.
let deliveries = 0;
app.use((req, res, next) => {
  res.locals.cc = move.platform();
  res.locals.current = req.path;
  next();
});

function newNote() {
  return { number: ++deliveries, connection: null, log: [], problem: null };
}

// Borrows a client from the pool, noting whether it was reused and how long it took.
async function connect(note) {
  const reused = pool.idleCount > 0;
  const started = performance.now();
  const client = await pool.connect();
  note.connection = { reused, ms: performance.now() - started };
  return client;
}

// Runs one SQL statement and writes it on the delivery note with its duration.
async function run(client, note, sql, outcome) {
  const started = performance.now();
  try {
    const result = await client.query(sql);
    note.log.push({ sql, ms: performance.now() - started, outcome: outcome(result) });
    return result;
  } catch (err) {
    note.log.push({ sql, ms: performance.now() - started, outcome: `error ${err.code || ""}`.trim(), failed: true });
    throw err;
  }
}

// What went wrong, without the connection details of the error message.
function problem(err) {
  if (err.code === "42P01") return { kind: "no-table", code: err.code };
  return { kind: dbVar ? "unreachable" : "unconfigured", code: err.code || "no error code" };
}

function problemText(p) {
  if (p.kind === "no-table") return "test_table does not exist yet: open /db-init to create it";
  if (p.kind === "unconfigured") return `no DATABASE_URL or POSTGRESQL_ADDON_URI set (${p.code})`;
  return `PostgreSQL did not answer (${p.code})`;
}

function countTo(times) {
  let result = "";
  for (let i = 1; i <= times; i++) {
    result += i + " ";
  }
  return result;
}

// The live facts of the home page: TLS, server version, rows in test_table.
async function inspectDatabase(note) {
  if (!dbVar) return { configured: false };
  let client;
  try {
    client = await connect(note);
    const tls = await run(client, note,
      "SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
      (r) => (r.rows[0] && r.rows[0].ssl ? `TLS on, ${r.rows[0].version}` : "TLS off"));
    const version = await run(client, note, "SHOW server_version",
      (r) => `PostgreSQL ${r.rows[0].server_version.split(" ")[0]}`);
    let rows = null;
    try {
      const count = await run(client, note, "SELECT count(*)::int AS n FROM test_table",
        (r) => `${r.rows[0].n} ${r.rows[0].n === 1 ? "row" : "rows"}`);
      rows = count.rows[0].n;
    } catch (err) {
      if (err.code !== "42P01") throw err;
    }
    return { configured: true, ok: true, tls: tls.rows[0], version: version.rows[0].server_version.split(" ")[0], rows };
  } catch (err) {
    console.error(err);
    note.problem = problem(err);
    return { configured: true, ok: false, problem: note.problem };
  } finally {
    if (client) client.release();
  }
}

app.get("/", async (req, res) => {
  console.log(`Rendering 'pages/index' for route '/'`);
  const note = newNote();
  const db = await inspectDatabase(note);
  const event = process.env.npm_lifecycle_event;
  const boxes = move.inventory({
    db,
    dbVar,
    port,
    times: countTo(process.env.TIMES || 5),
    startedBy: event ? `npm ${event === "start" ? "start" : `run ${event}`}` : `node ${path.basename(process.argv[1])}`,
    cc: res.locals.cc,
  });
  res.render("pages/index", {
    note,
    db,
    boxes,
    counts: move.stampCounts(boxes),
    face: cool(),
    host: req.hostname,
    barcode: move.barcode(res.locals.cc.deployment || "local"),
  });
});

app.get("/cool", (req, res) => {
  console.log(`Rendering a cool ascii face for route '/cool'`);
  res.send(cool());
});

app.get("/times", (req, res) => {
  const times = process.env.TIMES || 5;
  console.log(`Rendering a count from 1 to ${times} for route '/times'`);
  res.send(countTo(times));
});

// Browsers get the page; curl (Accept: */*) still gets the plain text answer.
app.get("/db-init", async (req, res) => {
  console.log(`Initializing database for route '/db-init'`);
  const note = newNote();
  let client;
  try {
    client = await connect(note);
    const before = await run(client, note, "SELECT to_regclass('test_table') IS NOT NULL AS existed",
      (r) => (r.rows[0].existed ? "already there" : "not there yet"));
    await run(client, note,
      "CREATE TABLE IF NOT EXISTS test_table (id SERIAL PRIMARY KEY, name VARCHAR(100))",
      () => (before.rows[0].existed ? "left as it was" : "created"));
    res.format({
      text: () => res.send("Database initialized"),
      html: () => res.render("pages/db-init", { note, existed: before.rows[0].existed }),
      default: () => res.send("Database initialized"),
    });
  } catch (err) {
    console.error(err);
    note.problem = problem(err);
    res.status(503).format({
      text: () => res.send(`Error: ${problemText(note.problem)}`),
      html: () => res.render("pages/db-init", { note, existed: null }),
      default: () => res.send(`Error: ${problemText(note.problem)}`),
    });
  } finally {
    if (client) client.release();
  }
});

app.get("/db", async (req, res) => {
  console.log(`Rendering the results of a database query for route '/db'`);
  const note = newNote();
  let client;
  try {
    client = await connect(note);
    const result = await run(client, note, "SELECT * FROM test_table",
      (r) => `${r.rowCount} ${r.rowCount === 1 ? "row" : "rows"}`);
    res.render("pages/db", {
      note,
      results: result ? result.rows : null,
    });
  } catch (err) {
    // Before /db-init (or without PostgreSQL) there is nothing to unpack: 503, not an error text in a 200.
    console.error(err);
    note.problem = problem(err);
    res.status(503).render("pages/db", { note, results: null, message: problemText(note.problem) });
  } finally {
    if (client) client.release();
  }
});

const server = app.listen(port, () => {
  console.log(`Listening on ${port}`);
});

// Clever Cloud (like Heroku) sends SIGTERM before stopping an instance:
// finish the requests in flight, close the PostgreSQL pool, then exit.
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: gracefully shutting down");
  server.close(() => {
    console.log("HTTP server closed");
  });
  pool.end().then(() => {
    console.log("PostgreSQL pool closed");
  });
  setTimeout(() => process.exit(0), 5000).unref();
});
