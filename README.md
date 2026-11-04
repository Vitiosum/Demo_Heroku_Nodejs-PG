# Heroku's Getting Started, moved — Node.js and PostgreSQL on Clever Cloud

> Heroku's *nodejs-getting-started* app (Express 5, EJS), with the database steps of its tutorial, moved to Clever Cloud as it is: the home page still says « Getting Started on Heroku », and `/db` lists the rows of a PostgreSQL table. The move changed **one line of code**: the pool reads Heroku's `DATABASE_URL` or, when it is absent, `POSTGRESQL_ADDON_URI`, which the **PostgreSQL add-on** injects into the linked app. The rest carries over: the **Node.js runtime** runs `npm start` (the same `node index.js` as the `Procfile`, which it does not read), gives the app its `PORT` and takes the Node version from `engines` in `package.json`. `heroku create`, `addons:create`, `config:set` and `git push heroku` become `clever create`, `clever addon create` with `clever service link-addon`, `clever env set` and `clever deploy`.

![Heroku's Getting Started home page, unchanged, served by the app run locally](docs/screenshot-desktop.png)

<img src="docs/screenshot-phone.png" alt="The /db page on a phone, run locally: two rows of test_table read from PostgreSQL" width="300">

**Run it yourself.** The hosted demo was taken down after the presales review (November 2026). The steps in [Deploy on Clever Cloud](#deploy-on-clever-cloud) recreate it from scratch in about 5 minutes.

## What changes from Heroku to Clever Cloud

| On Heroku | On Clever Cloud | In this repo |
|---|---|---|
| `heroku create` | `clever create --type node` | — |
| `git push heroku main` | `clever deploy`, which pushes to the app's Clever Cloud git remote | — |
| `Procfile`: `web: node index.js` | Not read: the Node.js runtime runs `npm start`, and `scripts.start` is `node index.js` | `Procfile` and `package.json` unchanged |
| `PORT` given to the dyno | `PORT` given by Clever Cloud (8080) | `process.env.PORT \|\| 5006`, unchanged |
| `heroku addons:create heroku-postgresql`, which sets `DATABASE_URL` | `clever addon create postgresql-addon` then `clever service link-addon`, which inject `POSTGRESQL_ADDON_URI` (and `_HOST`, `_PORT`, `_DB`, `_USER`, `_PASSWORD`) | **The one changed line** (commit `5f1cfec`): `process.env.DATABASE_URL \|\| process.env.POSTGRESQL_ADDON_URI` |
| TLS to the database, `ssl: { rejectUnauthorized: false }` | The same: the add-on accepts TLS | Unchanged |
| `heroku pg:psql`, then `create table` | `/db-init` creates `test_table`; rows go in with `psql "$POSTGRESQL_ADDON_URI"` | `/db-init` added for the move (commit `f7ab34a`) |
| `heroku config:set`, and `.env` read by `heroku local` | `clever env set`; nothing reads `.env` (no dotenv in the app) | `.env` (`TIMES=2`) kept |
| `app.json` (Heroku Button) | Not read | Kept |
| `engines.node`: 20.x, 22.x or 24.x | Read the same way by the Node.js runtime | Unchanged |
| `heroku logs --tail`, `heroku open` | `clever logs`, `clever open` | — |

## Deploy on Clever Cloud

You need [clever-tools](https://www.clever.cloud/developers/doc/cli/) (`clever login` done), `psql`, and the ID of the organisation that will own the resources (`orga_…`, shown in the Console). Run the commands from the repo root: `clever create` links the folder to the new app.

```bash
# 1. The app and its size (heroku create)
clever create --type node demo-heroku-nodejs-pg --org <org_id> --region par
clever scale --min-flavor nano --max-flavor XS --min-instances 1 --max-instances 2

# 2. PostgreSQL (dedicated xxs_sml, encrypted at rest), linked to the app (heroku addons:create heroku-postgresql)
clever addon create postgresql-addon demo-heroku-db --plan xxs_sml --option encryption=true --region par --org <org_id> --yes
clever service link-addon demo-heroku-db

# 3. Variables (heroku config:set): optional, /times counts to 5 without it
clever env set TIMES 2

# 4. Deploy (git push heroku main)
clever deploy
clever open

# 5. The table and a first row (heroku pg:psql); eval loads the app's variables into this shell without printing them
curl -s https://<app-domain>/db-init     # "Database initialized"; clever domain gives <app-domain>
eval "$(clever env -F shell)"
psql "$POSTGRESQL_ADDON_URI" -c "INSERT INTO test_table (name) VALUES ('hello database')"
```

Then open `/db`. Before step 5 it answers `Error error: relation "test_table" does not exist`: the app turns database errors into text, with an HTTP 200.

## Variables

| Variable | Set by | Role |
|---|---|---|
| `POSTGRESQL_ADDON_URI` | PostgreSQL add-on (linked) | Connection string, read when `DATABASE_URL` is absent |
| `DATABASE_URL` | Heroku Postgres; nobody on Clever Cloud | Read first: set it locally |
| `PORT` | Clever Cloud | Listening port: 8080; `5006` locally by default |
| `TIMES` | you, optional | `/times` counts from 1 to it; default 5 |

## Routes

`/` Heroku's Getting Started page (EJS) · `/cool` a random ASCII face (`cool-ascii-faces`) · `/times` `1 2 3 4 5` · `/db-init` creates `test_table (id SERIAL PRIMARY KEY, name VARCHAR(100))` if missing · `/db` the rows of `test_table` · `/lang-logo.png`, `/node.svg`, `/stylesheets/main.css` (static).

## Code tour

```
index.js                Express 5 app: routes, pg pool (DATABASE_URL || POSTGRESQL_ADDON_URI, TLS without CA check), SIGTERM
views/pages/index.ejs   Heroku's home page, unchanged
views/pages/db.ejs      the rows of test_table
views/partials/         header (Bootstrap 3 and jQuery from CDNs), Heroku nav bar
public/                 logo and stylesheet
Procfile                web: node index.js (Heroku only)
app.json                Heroku Button manifest (Heroku only)
.env                    TIMES=2, read by `heroku local` only
test.js                 jest: GET / answers on IPv4 and IPv6 (npm test)
```

Forked from [heroku/nodejs-getting-started](https://github.com/heroku/nodejs-getting-started); the tutorial's `/cool`, `/times` and `/db` steps were added on top (`views/pages/db.ejs` comes from upstream). The Heroku guides linked from the page still describe Heroku.

## Run locally

```bash
npm install
createdb readme_heroku    # any local PostgreSQL
DATABASE_URL="postgresql://localhost/readme_heroku?sslmode=disable" PORT=8303 npm start
curl -s localhost:8303/db-init
```

`?sslmode=disable` is needed with a local PostgreSQL without TLS (`The server does not support SSL connections` otherwise): the parameters of the connection string override the `ssl` option of the code. Node 20, 22 or 24 (`engines`); on a newer version npm warns and the app still runs.

MIT License (`package.json`).
