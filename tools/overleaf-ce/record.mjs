import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const fixtures = path.join(repo, 'crates/oleafly-online/tests/fixtures/overleaf-rt')
const forbidden = /overleaf_session2|sharelatex\.sid|overleaf\.sid|csrf|"cookie"|"set-cookie"/i
const image =
  'sharelatex/sharelatex:6.3.3@sha256:fcdae66d4b642537d4f5ca8c814b9b2c7771395de5d5c51d14b52c4f542e5712'
const keptMeta = [
  'ol-wsUrl',
  'ol-wsRetryHandshake',
  'ol-maxDocLength',
  'ol-maxReconnectGracefullyIntervalMs',
  'ol-useShareJsHash',
  'ol-otMigrationStage',
  'ol-hasTrackChangesFeature',
  'ol-user_id',
]

async function readEnv() {
  const text = await fs.readFile(path.join(here, '.env.local'), 'utf8')
  return Object.fromEntries(
    text
      .split('\n')
      .filter(line => line.includes('='))
      .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  )
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function until(what, check, timeout = 60000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${what}`)
}

function cookieJar() {
  const jar = new Map()
  return {
    absorb(response) {
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(';')
        const at = pair.indexOf('=')
        jar.set(pair.slice(0, at), pair.slice(at + 1))
      }
    },
    header() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
    },
    values() {
      return [...jar.values()]
    },
  }
}

async function signIn(site, email, password, secrets) {
  const jar = cookieJar()
  const login = await fetch(`${site}/login`)
  jar.absorb(login)
  const loginToken = (await login.text()).match(/name="ol-csrfToken" content="([^"]+)"/)[1]
  const signedIn = await fetch(`${site}/login`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', cookie: jar.header() },
    body: JSON.stringify({ email, password, _csrf: loginToken }),
  })
  jar.absorb(signedIn)
  if (!signedIn.ok) throw new Error(`sign-in as ${email} failed with HTTP ${signedIn.status}`)
  secrets.add(loginToken)
  for (const value of jar.values()) secrets.add(value)
  return jar
}

function packets(payload) {
  if (!payload.startsWith('\ufffd')) return payload ? [payload] : []
  const found = []
  let rest = payload
  while (rest.startsWith('\ufffd')) {
    const end = rest.indexOf('\ufffd', 1)
    const length = Number(rest.slice(1, end))
    found.push(rest.slice(end + 1, end + 1 + length))
    rest = rest.slice(end + 1 + length)
  }
  return found
}

class ScriptedClient {
  constructor(name, clock) {
    this.name = name
    this.clock = clock
    this.frames = []
    this.events = []
    this.acks = new Map()
    this.nextId = 1
    this.closed = false
  }

  note(dir, frame) {
    this.frames.push({ t: Date.now() - this.clock.start, dir, frame })
  }

  async connect(site, email, password, projectId, secrets) {
    this.jar = await signIn(site, email, password, secrets)
    const query = `projectId=${projectId}`
    const handshake = await fetch(`${site}/socket.io/1/?${query}&t=${Date.now()}`, {
      headers: { cookie: this.jar.header() },
    })
    this.jar.absorb(handshake)
    for (const value of this.jar.values()) secrets.add(value)
    const sid = (await handshake.text()).split(':')[0]
    this.channel = `${site}/socket.io/1/xhr-polling/${sid}?${query}`
    this.loop = this.poll()
    await until(`${this.name} to join the project`, () =>
      this.events.some(event => event.name === 'joinProjectResponse')
    )
  }

  async poll() {
    while (!this.closed) {
      const response = await fetch(`${this.channel}&t=${Date.now()}`, {
        headers: { cookie: this.jar.header() },
      }).catch(() => null)
      if (!response || !response.ok) break
      for (const packet of packets(await response.text())) {
        this.note('in', packet)
        if (packet.startsWith('2::')) await this.send('2::')
        else if (packet.startsWith('0::')) this.closed = true
        else if (packet.startsWith('5:')) this.events.push(JSON.parse(packet.slice(packet.indexOf('{'))))
        else if (packet.startsWith('6:::')) {
          const body = packet.slice(4)
          const plus = body.indexOf('+')
          this.acks.set(Number(plus < 0 ? body : body.slice(0, plus)), plus < 0 ? [] : JSON.parse(body.slice(plus + 1)))
        }
      }
    }
  }

  async send(packet) {
    this.note('out', packet)
    await fetch(`${this.channel}&t=${Date.now()}`, {
      method: 'POST',
      headers: { cookie: this.jar.header(), 'content-type': 'text/plain;charset=UTF-8' },
      body: packet,
    })
  }

  async call(name, args) {
    const id = this.nextId++
    await this.send(`5:${id}+::${JSON.stringify({ name, args })}`)
    await until(`${this.name} to get a reply to ${name}`, () => this.acks.has(id), 30000)
    return this.acks.get(id)
  }

  async update(docId, update) {
    const seen = this.events.length
    const reply = await this.call('applyOtUpdate', [docId, update])
    if (reply[0]) throw new Error(`${this.name}'s update was refused: ${JSON.stringify(reply[0])}`)
    await until(`${this.name}'s update to be applied`, () =>
      this.events
        .slice(seen)
        .some(event => event.name === 'otUpdateApplied' && event.args[0].doc === docId && !event.args[0].op)
    )
  }

  async close() {
    if (this.closed) return
    this.closed = true
    await this.send('0::').catch(() => {})
  }
}

async function restSession(site, email, password, projectId, secrets) {
  const jar = await signIn(site, email, password, secrets)
  const editor = await fetch(`${site}/project/${projectId}`, { headers: { cookie: jar.header() } })
  jar.absorb(editor)
  const token = (await editor.text()).match(/name="ol-csrfToken" content="([^"]+)"/)[1]
  secrets.add(token)
  for (const value of jar.values()) secrets.add(value)
  return {
    async post(route, body) {
      const response = await fetch(`${site}${route}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-csrf-token': token,
          cookie: jar.header(),
        },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`POST ${route} failed with HTTP ${response.status}`)
      return response.json()
    },
  }
}

class Participant {
  constructor(name, clock) {
    this.name = name
    this.clock = clock
    this.frames = []
    this.held = false
    this.queue = []
    this.joined = new Map()
    this.pendingJoins = new Map()
    this.lastTraffic = 0
    this.closed = false
  }

  note(dir, data) {
    const frame = typeof data === 'string' ? data : Buffer.from(data).toString('utf8')
    const t = Date.now() - this.clock.start
    this.frames.push({ t, dir, frame })
    if (!frame.startsWith('2::')) this.lastTraffic = Date.now()
    if (dir === 'out') {
      const join = frame.match(/^5:(\d+)\+::(\{"name":"joinDoc".*)$/s)
      if (join) this.pendingJoins.set(join[1], JSON.parse(join[2]).args[0])
    } else {
      const reply = frame.match(/^6:::(\d+)\+(.*)$/s)
      if (reply && this.pendingJoins.has(reply[1])) {
        const docId = this.pendingJoins.get(reply[1])
        this.pendingJoins.delete(reply[1])
        const args = JSON.parse(reply[2])
        this.joined.set(docId, { error: args[0], type: args[5] })
      }
      if (frame.startsWith('0::')) this.closed = true
    }
  }

  async start(browser, site, email, password, harPath, secrets) {
    this.context = await browser.newContext({
      recordHar: { path: harPath, mode: 'minimal', content: 'omit' },
    })
    this.page = await this.context.newPage()
    await this.page.routeWebSocket(/\/socket\.io\//, ws => {
      const server = ws.connectToServer()
      this.server = server
      ws.onMessage(message => {
        if (this.held) {
          this.queue.push(message)
          return
        }
        this.note('out', message)
        server.send(message)
      })
      server.onMessage(message => {
        this.note('in', message)
        ws.send(message)
      })
      ws.onClose(() => {
        this.closed = true
      })
    })
    await this.page.goto(`${site}/login`)
    await this.page.fill('input[name=email]', email)
    await this.page.fill('input[name=password]', password)
    await this.page.click('button[type=submit]')
    await this.page.waitForURL(/\/project/)
    this.secrets = secrets
  }

  async openProject(site, projectId) {
    await this.page.goto(`${site}/project/${projectId}`)
    await this.page.waitForSelector('.cm-content', { timeout: 120000 })
    const token = await this.page.evaluate(
      () => document.querySelector('meta[name="ol-csrfToken"]')?.content
    )
    if (token) this.secrets.add(token)
    for (const cookie of await this.context.cookies()) this.secrets.add(cookie.value)
    this.meta = await this.page.evaluate(names => {
      const found = {}
      for (const name of names) {
        const tag = document.querySelector(`meta[name="${name}"]`)
        if (tag) found[name] = tag.content
      }
      return found
    }, keptMeta)
  }

  async openDoc(name, docId) {
    await this.page.getByRole('treeitem', { name, exact: true }).click()
    await until(`${this.name} to join ${name}`, () => this.joined.has(docId), 60000)
    await this.page.waitForTimeout(500)
  }

  text() {
    return this.page.evaluate(() => document.querySelector('.cm-content').cmView.view.state.doc.toString())
  }

  cursor(position) {
    return this.page.evaluate(at => {
      const view = document.querySelector('.cm-content').cmView.view
      view.focus()
      view.dispatch({ selection: { anchor: at } })
    }, position)
  }

  select(from, to) {
    return this.page.evaluate(
      ([anchor, head]) => {
        const view = document.querySelector('.cm-content').cmView.view
        view.focus()
        view.dispatch({ selection: { anchor, head } })
      },
      [from, to]
    )
  }

  change(changes, userEvent = 'input.type') {
    return this.page.evaluate(
      ([given, event]) => {
        const view = document.querySelector('.cm-content').cmView.view
        view.dispatch({ changes: given, userEvent: event })
      },
      [changes, userEvent]
    )
  }

  type(text, delay = 25) {
    return this.page.keyboard.type(text, { delay })
  }

  press(key) {
    return this.page.keyboard.press(key)
  }

  hold() {
    this.held = true
  }

  release() {
    this.held = false
    for (const message of this.queue.splice(0)) {
      this.note('out', message)
      this.server.send(message)
    }
  }

  fetchFromPage(route, method, body) {
    return this.page.evaluate(
      async ([target, verb, payload]) => {
        const token = document.querySelector('meta[name="ol-csrfToken"]').content
        const response = await fetch(target, {
          method: verb,
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          body: payload ? JSON.stringify(payload) : undefined,
        })
        return response.status
      },
      [route, method, body]
    )
  }
}

async function settle(people, { quiet = 2500, timeout = 120000, open = true, giveUp = 20000 } = {}) {
  const started = Date.now()
  let idleSince = null
  while (Date.now() - started < timeout) {
    const idle = people.every(person => !person.queue.length && Date.now() - person.lastTraffic > quiet)
    if (idle) {
      if (!open) return { converged: true, texts: null }
      const texts = await Promise.all(people.map(person => person.text()))
      if (texts.every(text => text === texts[0])) return { converged: true, texts }
      idleSince ??= Date.now()
      if (Date.now() - idleSince > giveUp) return { converged: false, texts }
    } else {
      idleSince = null
    }
    await sleep(200)
  }
  const tails = people.map(
    person =>
      `${person.name}:\n` +
      person.frames
        .filter(frame => !frame.frame.startsWith('2::'))
        .slice(-8)
        .map(frame => `  ${frame.dir} ${frame.frame.slice(0, 400)}`)
        .join('\n')
  )
  throw new Error(`the editors never went quiet\n${tails.join('\n')}`)
}

async function releaseAll(people) {
  await until(
    'every held client to queue its update',
    () => people.every(person => !person.held || person.queue.some(message => String(message).includes('"applyOtUpdate"'))),
    15000
  )
  for (const person of people) person.release()
}

const pasteBlock = (() => {
  const lines = []
  let size = 0
  for (let n = 1; size < 1_100_000; n++) {
    const line = `Line ${n} of the pasted block, repeated to make a large paste.\n`
    lines.push(line)
    size += line.length
  }
  return lines.join('')
})()

const scenarios = {
  'two-users-typing': {
    description:
      'Alice and Bob put their cursors at the same spot and type at the same time, first with both sends held so the ops are concurrent, then freely.',
    project: 'sharejs-project',
    people: ['alice', 'bob'],
    async run({ alice, bob, people, notes, settle }) {
      await alice.change({ from: 0, insert: 'The quick brown fox jumps over the lazy dog.\n' })
      await settle()
      const spot = 'The quick '.length
      await alice.cursor(spot)
      await bob.cursor(spot)
      people.forEach(person => person.hold())
      await Promise.all([alice.type('red '), bob.type('blue ')])
      await releaseAll(people)
      await settle()
      await alice.cursor(spot)
      await bob.cursor(spot)
      await Promise.all([alice.type('Alice types here. ', 40), bob.type('Bob types here too. ', 35)])
      notes.push('The first round is concurrent by construction; the second interleaves naturally.')
    },
  },
  'overlapping-deletes': {
    description:
      'Alice and Bob delete overlapping ranges at the same time, then both delete the same range.',
    project: 'sharejs-project',
    people: ['alice', 'bob'],
    async run({ alice, bob, people, settle }) {
      await alice.change({ from: 0, insert: 'abcdefghijklmnopqrstuvwxyz\n0123456789\nend\n' })
      await settle()
      people.forEach(person => person.hold())
      await alice.change({ from: 3, to: 12 }, 'delete')
      await bob.change({ from: 8, to: 18 }, 'delete')
      await releaseAll(people)
      await settle()
      people.forEach(person => person.hold())
      await alice.change({ from: 0, to: 3 }, 'delete')
      await bob.change({ from: 0, to: 3 }, 'delete')
      await releaseAll(people)
    },
  },
  'large-paste': {
    description: `Alice pastes ${pasteBlock.length} characters in one go while Bob types at the start of the doc.`,
    project: 'sharejs-project',
    people: ['alice', 'bob'],
    settle: { quiet: 4000, timeout: 300000 },
    async run({ alice, bob, people, settle }) {
      await alice.change({ from: 0, insert: 'Before the paste.\nAfter the paste.\n' })
      await settle()
      await bob.cursor(0)
      people.forEach(person => person.hold())
      await alice.change({ from: 'Before the paste.\n'.length, insert: pasteBlock }, 'input.paste')
      await bob.type('Bob was here. ')
      await releaseAll(people)
    },
  },
  emoji: {
    description:
      'Alice types emoji and accented text with the keyboard; Bob inserts emoji through a direct editor change.',
    project: 'sharejs-project',
    people: ['alice', 'bob'],
    async run({ alice, bob, people, settle }) {
      await alice.change({ from: 0, insert: 'Start.\n' })
      await settle()
      await alice.cursor('Start.'.length)
      await alice.type(' Smile \u{1F600} flag \u{1F1EB}\u{1F1F7} accents éüß CJK 中文.', 60)
      await settle()
      await bob.change({ from: 0, insert: 'Rocket \u{1F680} first. ' })
    },
  },
  'history-ot-typing': {
    description:
      'The two-users-typing session on the history-ot project: concurrent typing at one spot, then free typing.',
    project: 'history-ot-project',
    people: ['alice', 'bob'],
    async run(context) {
      await scenarios['two-users-typing'].run(context)
    },
  },
  'history-ot-turns': {
    description:
      'Alice and Bob take turns on the history-ot project, each edit seen by the other before the next: insert, type, delete, replace.',
    project: 'history-ot-project',
    people: ['alice', 'bob'],
    async run({ alice, bob, settle }) {
      await alice.change({ from: 0, insert: 'Line one.\nLine two.\nLine three.\n' })
      await settle()
      await bob.cursor('Line one.'.length)
      await bob.type(' Bob adds words.')
      await settle()
      await alice.change({ from: 0, to: 'Line '.length }, 'delete')
      await settle()
      const text = await bob.text()
      const two = text.indexOf('two')
      await bob.select(two, two + 'two'.length)
      await bob.type('2')
      await settle()
      await alice.change({ from: (await alice.text()).length, insert: 'Alice ends here.\n' })
    },
  },
  'history-ot-tracked-delete': {
    description:
      'A scripted client signed in as Carol (a reviewer) sends a tracked delete and then a tracked insert on the history-ot project, in the shape Overleaf web sends with track changes on. Alice and Bob watch in the web editor, then Bob types next to the hidden deleted text.',
    project: 'history-ot-project',
    people: ['alice', 'bob'],
    scripted: ['carol'],
    async run({ alice, bob, carol, doc, state, settle, notes, extra }) {
      const content = 'Keep this sentence. Remove this word please.\nSecond line.\n'
      await alice.change({ from: 0, insert: content })
      await settle()
      const options = { encodeRanges: true, supportsHistoryOT: true }
      const joined = await carol.call('joinDoc', [doc.id, options])
      let version = joined[2]
      const tracking = type => ({ type, userId: state.users.carol.id, ts: new Date().toISOString() })
      const removeAt = 'Keep this sentence. Remove this '.length
      const removed = 'word '.length
      await carol.update(doc.id, {
        doc: doc.id,
        op: [{ textOperation: [removeAt, { r: removed, tracking: tracking('delete') }, content.length - removeAt - removed] }],
        v: version,
      })
      version += 1
      const insertAt = 'Keep this '.length
      await carol.update(doc.id, {
        doc: doc.id,
        op: [{ textOperation: [insertAt, { i: 'whole ', tracking: tracking('insert') }, content.length - insertAt] }],
        v: version,
      })
      await settle()
      const visible = await bob.text()
      await bob.cursor(visible.indexOf('please'))
      await bob.type('big ')
      await settle()
      const after = await carol.call('joinDoc', [doc.id, options])
      extra.set('final.raw.json', `${JSON.stringify({ version: after[2], raw: after[1], ranges: after[4] }, null, 2)}\n`)
      notes.push('final.raw.json is the raw history-ot snapshot a fresh joinDoc returned at the end')
    },
  },
  'history-ot-reviewer-plain-edit': {
    description:
      'Carol, a reviewer (track changes on for her), deletes a word and types a word in the CE web editor on the history-ot project while Alice edits plainly.',
    project: 'history-ot-project',
    people: ['alice', 'carol'],
    async run({ alice, carol, people, notes, settle }) {
      await alice.change({ from: 0, insert: 'Keep this sentence. Remove this word please.\nSecond line.\n' })
      await settle()
      const word = 'Keep this sentence. Remove this '.length
      await carol.select(word, word + 'word '.length)
      await carol.press('Backspace')
      await sleep(1500)
      await carol.cursor('Keep this '.length)
      await carol.type('whole ')
      await sleep(1500)
      await alice.cursor((await alice.text()).length)
      await alice.type('Alice adds a line.')
      const carolOps = carol.frames.filter(frame => frame.dir === 'out' && frame.frame.includes('applyOtUpdate'))
      notes.push(`carol sent ${carolOps.length} applyOtUpdate frames`)
      const refusals = carol.frames.filter(
        frame => frame.dir === 'in' && /otUpdateError|forceDisconnect|"message":"not authorized"/.test(frame.frame)
      )
      notes.push(
        refusals.length
          ? `the server refused carol’s update: ${refusals[0].frame.slice(0, 120)}`
          : 'the server accepted carol’s updates'
      )
    },
  },
  'project-room-broadcast': {
    description:
      'A scripted client signed in as Dave (a viewer) connects to the project and never joins the doc while Alice and Bob edit it, to show whether applied ops reach the whole project room.',
    project: 'sharejs-project',
    people: ['alice', 'bob'],
    scripted: ['dave'],
    async run({ alice, bob, dave, doc, settle, notes }) {
      await alice.change({ from: 0, insert: 'Seen by the whole project room.\n' })
      await settle()
      await bob.cursor(0)
      await bob.type('Bob edits too. ')
      await settle()
      const reached = dave.events.filter(event => event.name === 'otUpdateApplied' && event.args[0].doc === doc.id)
      notes.push(`dave received ${reached.length} otUpdateApplied events for a doc he never joined`)
    },
  },
  'rename-while-open': {
    description: 'Bob renames the doc while both have it open and Alice keeps typing across the rename.',
    project: 'sharejs-project',
    people: ['alice', 'bob'],
    async run({ alice, bob, people, doc, settle }) {
      await alice.change({ from: 0, insert: 'Text before the rename.\n' })
      await settle()
      await alice.cursor(0)
      const typing = alice.type('Typing across the rename. ', 50)
      await sleep(300)
      const status = await bob.fetchFromPage(`/project/${doc.projectId}/doc/${doc.id}/rename`, 'POST', {
        name: doc.name.replace(/\.tex$/, '-renamed.tex'),
      })
      if (status >= 300) throw new Error(`rename failed with HTTP ${status}`)
      await typing
    },
  },
  'delete-open-file': {
    description:
      'Alice has an unsent edit held when Bob deletes the open doc; then her edit is released to the server.',
    project: 'sharejs-project',
    people: ['alice', 'bob'],
    settle: { open: false },
    async run({ alice, bob, people, doc, settle }) {
      await alice.change({ from: 0, insert: 'This file is about to be deleted.\n' })
      await settle()
      alice.hold()
      await alice.cursor(0)
      await alice.type('Unsent words. ')
      const status = await bob.fetchFromPage(`/project/${doc.projectId}/doc/${doc.id}`, 'DELETE')
      if (status >= 300) throw new Error(`delete failed with HTTP ${status}`)
      await sleep(1500)
      await releaseAll(people)
    },
  },
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
}

function redact(text, secrets) {
  let clean = text
  for (const secret of secrets) {
    if (secret && secret.length >= 8) clean = clean.split(secret).join('[redacted]')
  }
  return clean
}

function cleanHar(raw) {
  const har = JSON.parse(raw)
  const drop = new Set(['cookie', 'set-cookie', 'x-csrf-token', 'authorization'])
  har.log.entries = har.log.entries.filter(entry => {
    const { pathname } = new URL(entry.request.url)
    return /^\/(socket\.io\/1|project\/[0-9a-f]{24}|login$)/.test(pathname)
  })
  delete har.log.pages
  for (const entry of har.log.entries) {
    delete entry.pageref
    entry.request.headers = (entry.request.headers || []).filter(header => !drop.has(header.name.toLowerCase()))
    entry.response.headers = (entry.response.headers || []).filter(header => !drop.has(header.name.toLowerCase()))
    delete entry.request.cookies
    delete entry.response.cookies
    if (entry.request.postData && /\/login|\/register/.test(entry.request.url)) {
      delete entry.request.postData
    }
  }
  return `${JSON.stringify(har, null, 1)}\n`
}

async function record(name, browser, env, state) {
  const scenario = scenarios[name]
  if (!scenario) throw new Error(`unknown scenario ${name}`)
  const project = state.projects[scenario.project]
  const site = state.site
  const secrets = new Set(
    Object.entries(env)
      .filter(([key]) => /PASSWORD|SECRET/.test(key))
      .map(([, value]) => value)
  )
  const owner = await restSession(site, state.users.alice.email, env.ALICE_PASSWORD, project.id, secrets)
  const docName = `${name}-${stamp()}.tex`
  const created = await owner.post(`/project/${project.id}/doc`, {
    name: docName,
    parent_folder_id: project.rootFolderId,
  })
  const doc = { id: created._id, name: docName, projectId: project.id }
  const scratch = await fs.mkdtemp(path.join(here, '.recording-'))
  const clock = { start: Date.now() }
  const people = []
  const scripted = []
  const notes = []
  const extra = new Map()
  try {
    for (const key of scenario.people) {
      const person = new Participant(key, clock)
      await person.start(
        browser,
        site,
        state.users[key].email,
        env[`${key.toUpperCase()}_PASSWORD`],
        path.join(scratch, `${key}.har`),
        secrets
      )
      people.push(person)
    }
    for (const person of people) {
      await person.openProject(site, project.id)
      await person.openDoc(docName, doc.id)
    }
    for (const key of scenario.scripted || []) {
      const client = new ScriptedClient(key, clock)
      await client.connect(site, state.users[key].email, env[`${key.toUpperCase()}_PASSWORD`], project.id, secrets)
      scripted.push(client)
    }
    const byName = Object.fromEntries([...people, ...scripted].map(person => [person.name, person]))
    let diverged = 0
    const step = async options => {
      const result = await settle(people, options)
      if (!result.converged) {
        diverged += 1
        notes.push(`the editors did not converge at step ${diverged}`)
      }
      return result
    }
    await scenario.run({ ...byName, people, notes, doc, state, extra, settle: step })
    await releaseAll(people)
    const final = await step(scenario.settle)
    const target = path.join(fixtures, name)
    await fs.rm(target, { recursive: true, force: true })
    await fs.mkdir(target, { recursive: true })
    const participants = []
    for (const person of people) {
      const joined = person.joined.get(doc.id)
      participants.push({
        name: person.name,
        email: state.users[person.name].email,
        userId: state.users[person.name].id,
        frames: `${person.name}.frames.jsonl`,
        har: `${person.name}.har`,
        client: 'web',
        joinDocType: joined?.type ?? null,
      })
    }
    for (const client of scripted) {
      participants.push({
        name: client.name,
        email: state.users[client.name].email,
        userId: state.users[client.name].id,
        frames: `${client.name}.frames.jsonl`,
        har: null,
        client: 'scripted',
        joinDocType: null,
      })
    }
    const summary = {
      scenario: name,
      description: scenario.description,
      server: `Overleaf Community Edition 6.3.3 (${image})`,
      recordedAt: new Date().toISOString().slice(0, 10),
      project: { name: scenario.project, id: project.id },
      doc: { id: doc.id, name: doc.name },
      format: participants[0].joinDocType,
      pageMeta: people[0].meta,
      participants,
      converged: diverged === 0,
      finalText:
        final.texts === null
          ? null
          : Object.fromEntries(
              people.map(person => [person.name, final.converged ? 'final.txt' : `final.${person.name}.txt`])
            ),
      notes,
    }
    const outputs = new Map()
    outputs.set('scenario.json', `${JSON.stringify(summary, null, 2)}\n`)
    for (const person of people) {
      outputs.set(
        `${person.name}.frames.jsonl`,
        person.frames.map(frame => JSON.stringify(frame)).join('\n') + '\n'
      )
    }
    for (const client of scripted) {
      await client.close()
      outputs.set(`${client.name}.frames.jsonl`, client.frames.map(frame => JSON.stringify(frame)).join('\n') + '\n')
    }
    for (const [file, content] of extra) outputs.set(file, content)
    if (final.texts !== null) {
      if (final.converged) outputs.set('final.txt', final.texts[0])
      else people.forEach((person, index) => outputs.set(`final.${person.name}.txt`, final.texts[index]))
    }
    for (const person of people) {
      await person.context.close()
      outputs.set(`${person.name}.har`, cleanHar(await fs.readFile(path.join(scratch, `${person.name}.har`), 'utf8')))
    }
    for (const [file, content] of outputs) {
      const clean = redact(content, secrets)
      const leak = clean.match(forbidden)
      if (leak) throw new Error(`${name}/${file} still contains "${leak[0]}" after redaction`)
      await fs.writeFile(path.join(target, file), clean)
    }
    console.log(`recorded ${name} into ${path.relative(repo, target)}`)
    for (const note of notes) console.log(`  ${note}`)
  } finally {
    for (const client of scripted) await client.close()
    for (const person of people) await person.context?.close().catch(() => {})
    await fs.rm(scratch, { recursive: true, force: true })
  }
}

async function main() {
  const asked = process.argv.slice(2)
  if (asked.includes('--list')) {
    for (const [name, scenario] of Object.entries(scenarios)) console.log(`${name}: ${scenario.description}`)
    return
  }
  const names = asked.length === 0 || asked.includes('--all') ? Object.keys(scenarios) : asked
  const env = await readEnv()
  const state = JSON.parse(await fs.readFile(path.join(here, 'seed-state.json'), 'utf8'))
  const browser = await chromium.launch()
  try {
    for (const name of names) await record(name, browser, env, state)
  } finally {
    await browser.close()
  }
}

await main()
