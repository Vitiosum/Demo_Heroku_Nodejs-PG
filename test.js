const { spawn } = require('child_process')
const { request } = require('http')

const PORT = process.env.PORT || 5006

// Nothing listens on port 1: PostgreSQL "does not answer" without touching any real database.
const NO_DATABASE = 'postgresql://127.0.0.1:1/none?sslmode=disable'

// Starts index.js with the given variables, without the database variables of the shell.
function start(env = {}) {
  const base = { ...process.env, PORT: String(PORT) }
  delete base.DATABASE_URL
  delete base.POSTGRESQL_ADDON_URI
  delete base.TIMES
  const app = spawn('node', ['index.js'], { env: { ...base, ...env } })
  return new Promise((resolve, reject) => {
    app.on('error', reject)
    app.stdout.on('data', (data) => {
      if (data.toString().includes(`Listening on ${PORT}`)) resolve(app)
    })
  })
}

function stop(app) {
  if (app && app.exitCode === null) {
    app.stdout.removeAllListeners()
    app.kill('SIGTERM')
    return new Promise((resolve) => app.on('exit', resolve))
  }
}

describe('getting started guide', () => {
  let app

  beforeEach(async () => {
    app = await start()
  })

  afterEach(() => stop(app))

  it('should bind to IPv4 and respond to GET /', async () => {
    const response = await get(`http://127.0.0.1:${PORT}`)
    expect(response.statusCode).toBe(200)
    expect(response.body).toMatch("<title>Node.js Getting Started, moved to Clever Cloud</title>")
    expect(response.body).toMatch("Getting Started on Heroku with Node.js")
  })

  it('should bind to IPv6 and respond to GET /', async () => {
    const response = await get(`http://[::1]:${PORT}`)
    expect(response.statusCode).toBe(200)
    expect(response.body).toMatch("<title>Node.js Getting Started, moved to Clever Cloud</title>")
    expect(response.body).toMatch("Getting Started on Heroku with Node.js")
  })

  it('shows the inventory and the Clever Cloud frame on GET /', async () => {
    const response = await get(`http://127.0.0.1:${PORT}`)
    expect(response.body).toMatch('The inventory')
    expect(response.body).toMatch('Box 12/12')
    expect(response.body).toMatch('Running on Clever Cloud')
    expect(response.body).toMatch('https://academy.clever.cloud')
    expect(response.body).toMatch('This app runs on Clever Cloud. You can get certified on it too.')
  })

  it('keeps /cool and /times as plain text', async () => {
    const cool = await get(`http://127.0.0.1:${PORT}/cool`)
    expect(cool.statusCode).toBe(200)
    expect(cool.body.length).toBeGreaterThan(0)
    const times = await get(`http://127.0.0.1:${PORT}/times`)
    expect(times.statusCode).toBe(200)
    expect(times.body).toBe('1 2 3 4 5 ')
  })
})

describe('without a reachable PostgreSQL', () => {
  let app

  beforeEach(async () => {
    app = await start({ DATABASE_URL: NO_DATABASE })
  })

  afterEach(() => stop(app))

  it('answers 503 on /db with a clear message', async () => {
    const response = await get(`http://127.0.0.1:${PORT}/db`)
    expect(response.statusCode).toBe(503)
    expect(response.body).toMatch('Nothing to unpack')
    expect(response.body).toMatch('PostgreSQL did not answer (ECONNREFUSED)')
  })

  it('answers 503 in plain text on /db-init for curl', async () => {
    const response = await get(`http://127.0.0.1:${PORT}/db-init`)
    expect(response.statusCode).toBe(503)
    expect(response.body).toBe('Error: PostgreSQL did not answer (ECONNREFUSED)')
  })

  it('still renders the home page', async () => {
    const response = await get(`http://127.0.0.1:${PORT}/`)
    expect(response.statusCode).toBe(200)
    expect(response.body).toMatch('PostgreSQL did not answer (ECONNREFUSED)')
  })
})

describe('shutdown', () => {
  it('exits on SIGTERM', async () => {
    const app = await start({ DATABASE_URL: NO_DATABASE })
    await get(`http://127.0.0.1:${PORT}/db`)
    const started = Date.now()
    const code = await new Promise((resolve) => {
      app.on('exit', resolve)
      app.kill('SIGTERM')
    })
    expect(code).toBe(0)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

// Runs only with a disposable database: TEST_DATABASE_URL=postgresql://... npm test
const withDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip
withDatabase('with PostgreSQL', () => {
  let app

  beforeEach(async () => {
    app = await start({ DATABASE_URL: process.env.TEST_DATABASE_URL })
  })

  afterEach(() => stop(app))

  it('builds the table on /db-init, then unpacks it on /db', async () => {
    const init = await get(`http://127.0.0.1:${PORT}/db-init`)
    expect(init.statusCode).toBe(200)
    expect(init.body).toBe('Database initialized')
    const page = await get(`http://127.0.0.1:${PORT}/db-init`, { Accept: 'text/html' })
    expect(page.body).toMatch('Box already built')
    const db = await get(`http://127.0.0.1:${PORT}/db`)
    expect(db.statusCode).toBe(200)
    expect(db.body).toMatch('SELECT * FROM test_table')
  })
})

async function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, {method: 'GET', headers}, (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (data) => body += data)
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: body
        })
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}
