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
});

app.use(express.static(path.join(__dirname, "public")));
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.get("/", (req, res) => {
  console.log(`Rendering 'pages/index' for route '/'`);
  res.render("pages/index");
});

app.get("/cool", (req, res) => {
  console.log(`Rendering a cool ascii face for route '/cool'`);
  res.send(cool());
});

app.get("/times", (req, res) => {
  const times = process.env.TIMES || 5;
  console.log(`Rendering a count from 1 to ${times} for route '/times'`);
  let result = "";
  for (let i = 1; i <= times; i++) {
    result += i + " ";
  }
  res.send(result);
});
app.get("/db-init", async (req, res) => {
  console.log(`Initializing database for route '/db-init'`);
  try {
    const client = await pool.connect();
    await client.query(
      "CREATE TABLE IF NOT EXISTS test_table (id SERIAL PRIMARY KEY, name VARCHAR(100))"
    );
    res.send("Database initialized");
    client.release();
  } catch (err) {
    console.error(err);
    res.send("Error " + err);
  }
});

app.get("/db", async (req, res) => {
  console.log(`Rendering the results of a database query for route '/db'`);
  try {
    const client = await pool.connect();
    const result = await client.query("SELECT * FROM test_table");
    res.render("pages/db", {
      results: result ? result.rows : null,
    });
    client.release();
  } catch (err) {
    console.error(err);
    res.send("Error " + err);
  }
});

const server = app.listen(port, () => {
  console.log(`Listening on ${port}`);
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM signal received: gracefully shutting down");
  if (server) {
    server.close(() => {
      console.log("HTTP server closed");
    });
  }
});
