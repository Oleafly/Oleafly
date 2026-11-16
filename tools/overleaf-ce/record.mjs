import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
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
    const jar = await signIn(site, email, password, secrets)
    await this.open(site, jar, projectId, secrets)
    await until(`${this.name} to join the project`, () =>
      this.events.some(event => event.name === 'joinProjectResponse')
    )
  }

  async open(site, jar, projectId, secrets, { websocket = false, query: extra = '' } = {}) {
    this.jar = jar ?? cookieJar()
    const query = `projectId=${encodeURIComponent(projectId)}${extra}`
    const handshake = await fetch(`${site}/socket.io/1/?${query}&t=${Date.now()}`, {
      headers: { cookie: this.jar.header() },
    })
    this.jar.absorb(handshake)
    for (const value of this.jar.values()) secrets.add(value)
    const sid = (await handshake.text()).split(':')[0]
    if (websocket) {
      this.socket = new WebSocket(`${site.replace('http', 'ws')}/socket.io/1/websocket/${sid}?${query}`, {
        headers: { cookie: this.jar.header() },
      })
      this.socket.onmessage = message => this.receive(String(message.data))
      this.socket.onclose = () => {
        this.closed = true
      }
      await until(`${this.name}'s websocket to open`, () => this.socket.readyState === 1 || this.closed)
    } else {
      this.channel = `${site}/socket.io/1/xhr-polling/${sid}?${query}`
      this.loop = this.poll()
    }
  }

  outcome() {
    return until(`${this.name} to be accepted or rejected`, () =>
      this.closed || this.events.some(event => ['joinProjectResponse', 'connectionRejected'].includes(event.name))
    )
  }

  receive(packet) {
    this.note('in', packet)
    if (packet.startsWith('2::')) this.send('2::')
    else if (packet.startsWith('0::') || packet.startsWith('7:')) this.closed = true
    else if (packet.startsWith('5:')) this.events.push(JSON.parse(packet.slice(packet.indexOf('{'))))
    else if (packet.startsWith('6:::')) {
      const body = packet.slice(4)
      const plus = body.indexOf('+')
      this.acks.set(Number(plus < 0 ? body : body.slice(0, plus)), plus < 0 ? [] : JSON.parse(body.slice(plus + 1)))
    }
  }

  async poll() {
    while (!this.closed) {
      const response = await fetch(`${this.channel}&t=${Date.now()}`, {
        headers: { cookie: this.jar.header() },
      }).catch(() => null)
      if (!response || !response.ok) {
        this.closed = true
        break
      }
      for (const packet of packets(await response.text())) this.receive(packet)
    }
  }

  async send(packet) {
    this.note('out', packet)
    if (this.socket) {
      if (this.socket.readyState === 1) this.socket.send(packet)
      return
    }
    await fetch(`${this.channel}&t=${Date.now()}`, {
      method: 'POST',
      headers: { cookie: this.jar.header(), 'content-type': 'text/plain;charset=UTF-8' },
      body: packet,
    }).catch(() => {})
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
    await this.send('0::')
    this.closed = true
    this.socket?.close()
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


const keptHeaders = new Set(['content-type', 'retry-after', 'location', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'])

async function csrfFor(site, jar, projectId) {
  const page = await fetch(`${site}/project/${projectId}`, { headers: { cookie: jar.header() } })
  jar.absorb(page)
  return (await page.text()).match(/name="ol-csrfToken" content="([^"]+)"/)?.[1]
}

async function httpStep(site, jar, method, route, { body, token, secrets } = {}) {
  if (token) secrets.add(token)
  const response = await fetch(`${site}${route}`, {
    method,
    redirect: 'manual',
    headers: {
      accept: 'application/json',
      cookie: jar?.header() ?? '',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { 'x-csrf-token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const headers = Object.fromEntries([...response.headers].filter(([name]) => keptHeaders.has(name)))
  const text = await response.text()
  let parsed = text
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = text.length > 400 ? `${text.slice(0, 400)}…` : text
  }
  return { request: { method, route }, status: response.status, headers, body: parsed }
}

function dockerExec(command) {
  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      ['compose', '--env-file', '.env.local', '-f', 'compose.yml', 'exec', '-T', 'overleaf', 'bash', '-c', command],
      { cwd: here },
      (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve(stdout))
    )
  })
}

async function rejectionProbe(ctx, who, projectId, notes) {
  const steps = []
  for (const websocket of [true, false]) {
    const client = new ScriptedClient(who ?? 'anonymous', ctx.clock)
    const jar = who ? await ctx.signInAs(who) : null
    await client.open(ctx.site, jar, projectId, ctx.secrets, { websocket })
    await client.outcome()
    await sleep(500)
    await client.close()
    const transport = websocket ? 'websocket' : 'xhr-polling'
    const rejected = client.events.find(event => event.name === 'connectionRejected')
    const error = client.frames.find(frame => frame.dir === 'in' && frame.frame.startsWith('7:'))
    notes.push(
      `${transport}: ${rejected ? `connectionRejected ${JSON.stringify(rejected.args)}` : error ? `error packet ${error.frame}` : 'not rejected'}`
    )
    steps.push({ socket: { user: who, projectId, transport, frames: client.frames } })
  }
  return steps
}

async function uploadStep(site, jar, projectId, folderId, name, bytes, { token, secrets }) {
  const form = new FormData()
  form.append('name', name)
  form.append('qqfile', new Blob([bytes]), name)
  const response = await fetch(`${site}/project/${projectId}/upload?folder_id=${folderId}`, {
    method: 'POST',
    headers: { accept: 'application/json', cookie: jar.header(), 'x-csrf-token': token },
    body: form,
  })
  secrets.add(token)
  const text = await response.text()
  let body = text
  try {
    body = JSON.parse(text)
  } catch {}
  return { request: { method: 'POST', route: `/project/${projectId}/upload?folder_id=${folderId}`, name }, status: response.status, body }
}

async function watcher(ctx, who, projectId) {
  const client = new ScriptedClient(who, ctx.clock)
  await client.open(ctx.site, await ctx.signInAs(who), projectId, ctx.secrets, { websocket: true })
  await client.outcome()
  return client
}

function eventsAfter(client, seen, names) {
  return client.events.slice(seen).filter(event => names.includes(event.name))
}

const probes = {
  'connection-rejected-no-session': {
    description: 'A socket handshake with no session cookie.',
    run: (ctx, notes) => rejectionProbe(ctx, null, ctx.state.projects['sharejs-project'].id, notes),
  },
  'connection-rejected-not-a-member': {
    description: 'Erin is signed in but has no access to the project.',
    run: (ctx, notes) => rejectionProbe(ctx, 'erin', ctx.state.projects['sharejs-project'].id, notes),
  },
  'connection-rejected-project-not-found': {
    description: 'Alice connects to a well-formed project id that does not exist.',
    run: (ctx, notes) => rejectionProbe(ctx, 'alice', 'ffffffffffffffffffffffff', notes),
  },
  'connection-rejected-bad-project-id': {
    description: 'Alice connects with a projectId that is not an ObjectId.',
    run: (ctx, notes) => rejectionProbe(ctx, 'alice', 'not-a-project', notes),
  },
  'connection-rejected-rate-limit': {
    description: 'Dave joins the same project over and over until the join rate limit refuses him.',
    async run(ctx, notes) {
      const jar = await ctx.signInAs('dave')
      const projectId = ctx.state.projects['sharejs-project'].id
      for (let attempt = 1; attempt <= 80; attempt++) {
        const client = new ScriptedClient('dave', ctx.clock)
        await client.open(ctx.site, jar, projectId, ctx.secrets)
        await client.outcome()
        const rejected = client.events.find(event => event.name === 'connectionRejected')
        await client.close()
        if (rejected) {
          notes.push(`attempt ${attempt} was refused with ${JSON.stringify(rejected.args)}`)
          return [{ socket: { user: 'dave', projectId, attempt, frames: client.frames } }]
        }
      }
      throw new Error('80 joins in a row were never rate limited')
    },
  },
  'server-ping': {
    description: 'A websocket client that asks for server pings (esh=1&ssp=1) waits for one and answers with clientPong.',
    async run(ctx, notes) {
      const client = new ScriptedClient('alice', ctx.clock)
      const projectId = ctx.state.projects['sharejs-project'].id
      await client.open(ctx.site, await ctx.signInAs('alice'), projectId, ctx.secrets, { websocket: true, query: '&esh=1&ssp=1' })
      await client.outcome()
      await until('a serverPing', () => client.events.some(event => event.name === 'serverPing'), 40000)
      const ping = client.events.find(event => event.name === 'serverPing')
      await client.send(`5:::${JSON.stringify({ name: 'clientPong', args: [...ping.args, 'websocket', ping.args[3]] })}`)
      await sleep(1000)
      await client.close()
      notes.push(`serverPing args ${JSON.stringify(ping.args.map(arg => typeof arg))}`)
      return [{ socket: { user: 'alice', projectId, transport: 'websocket', frames: client.frames } }]
    },
  },
  'reconnect-gracefully': {
    description: 'Real-time is asked to drain (its internal POST /drain), which sends reconnectGracefully to every client.',
    async run(ctx, notes) {
      const client = new ScriptedClient('bob', ctx.clock)
      const projectId = ctx.state.projects['sharejs-project'].id
      await client.open(ctx.site, await ctx.signInAs('bob'), projectId, ctx.secrets)
      await client.outcome()
      try {
        await dockerExec("curl -fsS -X POST 'http://127.0.0.1:3026/drain?rate=50'")
        await until('reconnectGracefully', () => client.events.some(event => event.name === 'reconnectGracefully'), 20000)
      } finally {
        await dockerExec("curl -fsS -X POST 'http://127.0.0.1:3026/drain?rate=0'")
      }
      await sleep(1000)
      notes.push(`still connected after the drain request: ${!client.closed}`)
      await client.close()
      return [{ socket: { user: 'bob', projectId, frames: client.frames } }]
    },
  },
  'force-disconnect': {
    description: 'A site admin (Alice) uses POST /admin/disconnectAllUsers?delay=2, which sends forceDisconnect(message, delay) to every client.',
    async run(ctx, notes) {
      const client = new ScriptedClient('bob', ctx.clock)
      const projectId = ctx.state.projects['sharejs-project'].id
      await client.open(ctx.site, await ctx.signInAs('bob'), projectId, ctx.secrets)
      await client.outcome()
      const admin = await ctx.signInAs('alice')
      const token = await csrfFor(ctx.site, admin, projectId)
      const request = await httpStep(ctx.site, admin, 'POST', '/admin/disconnectAllUsers?delay=2', { token, secrets: ctx.secrets })
      await until('forceDisconnect', () => client.events.some(event => event.name === 'forceDisconnect'), 20000)
      await sleep(10000)
      notes.push(
        client.closed
          ? 'the server closed the socket within 10 s of forceDisconnect'
          : 'the server left the socket open for 10 s after forceDisconnect; the client is expected to leave'
      )
      await client.close()
      return [request, { socket: { user: 'bob', projectId, frames: client.frames } }]
    },
  },
  'join-doc-missing-ops': {
    description: 'Alice applies 110 updates to a new doc, then asks joinDoc for ops from version 0 (no longer kept) and from a version ahead of the doc.',
    async run(ctx, notes) {
      const projectId = ctx.state.projects['sharejs-project'].id
      const jar = await ctx.signInAs('alice')
      const token = await csrfFor(ctx.site, jar, projectId)
      const created = await httpStep(ctx.site, jar, 'POST', `/project/${projectId}/doc`, {
        token,
        secrets: ctx.secrets,
        body: { name: `missing-ops-${stamp()}.tex`, parent_folder_id: ctx.state.projects['sharejs-project'].rootFolderId },
      })
      const docId = created.body._id
      const client = new ScriptedClient('alice', ctx.clock)
      await client.open(ctx.site, jar, projectId, ctx.secrets)
      await client.outcome()
      const options = { encodeRanges: true, supportsHistoryOT: true }
      const joined = await client.call('joinDoc', [docId, options])
      let version = joined[2]
      for (let n = 0; n < 110; n++) {
        await client.update(docId, { doc: docId, op: [{ p: n, i: 'x' }], v: version })
        version += 1
      }
      const missing = await client.call('joinDoc', [docId, 0, options])
      const ahead = await client.call('joinDoc', [docId, version + 5, options])
      notes.push(`from 0: ${JSON.stringify(missing[0])}`)
      notes.push(`from ${version + 5}: ${JSON.stringify(ahead[0] ?? ahead.slice(2, 4))}`)
      await client.close()
      return [created, { socket: { user: 'alice', projectId, docId, frames: client.frames } }]
    },
  },
  'join-doc-without-history-ot-support': {
    description: 'Alice joins a history-ot doc without supportsHistoryOT.',
    async run(ctx, notes) {
      const project = ctx.state.projects['history-ot-project']
      const client = new ScriptedClient('alice', ctx.clock)
      await client.open(ctx.site, await ctx.signInAs('alice'), project.id, ctx.secrets)
      await client.outcome()
      const reply = await client.call('joinDoc', [project.rootDocId, { encodeRanges: true }])
      notes.push(`reply ${JSON.stringify(reply[0])}`)
      await sleep(500)
      await client.close()
      return [{ socket: { user: 'alice', projectId: project.id, frames: client.frames } }]
    },
  },
  'rest-refusals': {
    description: 'A tree write without the anti-forgery token, one from a viewer, and reads without a session.',
    async run(ctx) {
      const project = ctx.state.projects['sharejs-project']
      const body = { name: 'refused.tex', parent_folder_id: project.rootFolderId }
      const alice = await ctx.signInAs('alice')
      const dave = await ctx.signInAs('dave')
      const daveToken = await csrfFor(ctx.site, dave, project.id)
      return [
        await httpStep(ctx.site, alice, 'POST', `/project/${project.id}/doc`, { body, secrets: ctx.secrets }),
        await httpStep(ctx.site, dave, 'POST', `/project/${project.id}/doc`, { body, token: daveToken, secrets: ctx.secrets }),
        await httpStep(ctx.site, null, 'GET', `/project/${project.id}`, { secrets: ctx.secrets }),
        await httpStep(ctx.site, null, 'GET', `/project/${project.id}/entities`, { secrets: ctx.secrets }),
      ]
    },
  },
  'rest-rate-limited': {
    description: 'Bob creates docs in a throwaway project until the doc-creation rate limit answers 429.',
    async run(ctx, notes) {
      const bob = await ctx.signInAs('bob')
      const anyProject = ctx.state.projects['sharejs-project'].id
      const token = await csrfFor(ctx.site, bob, anyProject)
      const created = await httpStep(ctx.site, bob, 'POST', '/project/new', {
        token,
        secrets: ctx.secrets,
        body: { projectName: `rate-limit-probe-${stamp()}`, template: 'none' },
      })
      const projectId = created.body.project_id
      const client = new ScriptedClient('bob', ctx.clock)
      await client.open(ctx.site, bob, projectId, ctx.secrets)
      await client.outcome()
      const root = client.events.find(event => event.name === 'joinProjectResponse').args[0].project.rootFolder[0]._id
      await client.close()
      for (let attempt = 1; attempt <= 60; attempt++) {
        const step = await httpStep(ctx.site, bob, 'POST', `/project/${projectId}/doc`, {
          token,
          secrets: ctx.secrets,
          body: { name: `doc-${attempt}.tex`, parent_folder_id: root },
        })
        if (step.status === 429) {
          notes.push(`doc ${attempt} got 429 with headers ${JSON.stringify(step.headers)}`)
          step.attempt = attempt
          return [created, step]
        }
      }
      throw new Error('60 doc creations were never rate limited')
    },
  },
  'settings-events': {
    description:
      'Alice changes the compiler, name, spell-check language, main document and main bibliography in project settings while Bob watches, then puts them back.',
    async run(ctx, notes) {
      const project = ctx.state.projects['sharejs-project']
      const bob = await watcher(ctx, 'bob', project.id)
      const original = bob.events.find(event => event.name === 'joinProjectResponse').args[0].project
      const alice = await ctx.signInAs('alice')
      const token = await csrfFor(ctx.site, alice, project.id)
      const names = ['compilerUpdated', 'imageNameUpdated', 'projectNameUpdated', 'spellCheckLanguageUpdated', 'rootDocUpdated', 'mainBibliographyDocUpdated']
      const seen = bob.events.length
      const change = await httpStep(ctx.site, alice, 'POST', `/project/${project.id}/settings`, {
        token,
        secrets: ctx.secrets,
        body: {
          compiler: 'xelatex',
          name: `${original.name} (settings probe)`,
          spellCheckLanguage: 'de',
          rootDocId: project.docs['sections/intro.tex'],
          mainBibliographyDocId: project.docs['refs.bib'],
        },
      })
      await until('five settings events', () => eventsAfter(bob, seen, names).length >= 5, 20000)
      const image = await httpStep(ctx.site, alice, 'POST', `/project/${project.id}/settings`, {
        token,
        secrets: ctx.secrets,
        body: { imageName: 'texlive-full:2025.1' },
      })
      await sleep(1500)
      const changed = eventsAfter(bob, seen, names)
      notes.push(`events in order: ${changed.map(event => `${event.name}(${JSON.stringify(event.args)})`).join(', ')}`)
      notes.push(`imageName answered ${image.status}`)
      const restore = await httpStep(ctx.site, alice, 'POST', `/project/${project.id}/settings`, {
        token,
        secrets: ctx.secrets,
        body: {
          compiler: original.compiler,
          name: original.name,
          spellCheckLanguage: original.spellCheckLanguage,
          rootDocId: original.rootDoc_id,
        },
      })
      await sleep(1500)
      await bob.close()
      return [change, image, restore, { socket: { user: 'bob', projectId: project.id, transport: 'websocket', frames: bob.frames } }]
    },
  },
  'upload-replace-and-convert': {
    description:
      'Alice uploads over existing entries while Bob watches: a binary over a binary (replace), a binary over a doc (convertDocToFile) and text over a binary (convertFileToDoc). Throwaway names, deleted afterwards.',
    async run(ctx, notes) {
      const project = ctx.state.projects['sharejs-project']
      const bob = await watcher(ctx, 'bob', project.id)
      const alice = await ctx.signInAs('alice')
      const token = await csrfFor(ctx.site, alice, project.id)
      const tree = ['reciveNewDoc', 'reciveNewFile', 'reciveNewFolder', 'removeEntity', 'reciveEntityRename', 'reciveEntityMove']
      const name = `convert-probe-${stamp()}`
      const steps = []
      const watch = async (label, act, count) => {
        const seen = bob.events.length
        steps.push(await act())
        await until(`${label}: ${count} tree events`, () => eventsAfter(bob, seen, tree).length >= count, 20000)
        await sleep(500)
        notes.push(`${label}: ${eventsAfter(bob, seen, tree).map(event => `${event.name}(${JSON.stringify(event.args)})`).join(', ')}`)
      }
      const binary = suffix => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, ...new TextEncoder().encode(suffix)])
      await watch('a new doc', () =>
        httpStep(ctx.site, alice, 'POST', `/project/${project.id}/doc`, {
          token,
          secrets: ctx.secrets,
          body: { name: `${name}.tex`, parent_folder_id: project.rootFolderId },
        }), 1)
      await watch('a binary over the doc', () => uploadStep(ctx.site, alice, project.id, project.rootFolderId, `${name}.tex`, binary('one'), { token, secrets: ctx.secrets }), 2)
      await watch('text over the binary', () => uploadStep(ctx.site, alice, project.id, project.rootFolderId, `${name}.tex`, new TextEncoder().encode('text again'), { token, secrets: ctx.secrets }), 2)
      await watch('a new binary', () => uploadStep(ctx.site, alice, project.id, project.rootFolderId, `${name}.png`, binary('two'), { token, secrets: ctx.secrets }), 1)
      await watch('a binary over the binary', () => uploadStep(ctx.site, alice, project.id, project.rootFolderId, `${name}.png`, binary('three'), { token, secrets: ctx.secrets }), 2)
      const ids = steps.map(step => step.body?.entity_id ?? step.body?._id).filter(Boolean)
      const last = (kind, at) => ({ kind, id: ids[at] })
      for (const { kind, id } of [last('doc', 2), last('file', 4)]) {
        steps.push(await httpStep(ctx.site, alice, 'DELETE', `/project/${project.id}/${kind}/${id}`, { token, secrets: ctx.secrets }))
      }
      await sleep(1000)
      await bob.close()
      return [...steps, { socket: { user: 'bob', projectId: project.id, transport: 'websocket', frames: bob.frames } }]
    },
  },
  'collaborator-access-change': {
    description: "Alice makes Dave a reviewer, then a viewer again, while Bob watches the room's access events.",
    async run(ctx, notes) {
      const project = ctx.state.projects['sharejs-project']
      const bob = await watcher(ctx, 'bob', project.id)
      const alice = await ctx.signInAs('alice')
      const token = await csrfFor(ctx.site, alice, project.id)
      const names = ['project:collaboratorAccessLevel:changed', 'project:membership:changed', 'toggle-track-changes', 'userRemovedFromProject']
      const dave = ctx.state.users.dave.id
      const steps = []
      for (const level of ['review', 'readOnly']) {
        const seen = bob.events.length
        steps.push(await httpStep(ctx.site, alice, 'PUT', `/project/${project.id}/users/${dave}`, { token, secrets: ctx.secrets, body: { privilegeLevel: level } }))
        await until(`access events for ${level}`, () => eventsAfter(bob, seen, names).length >= 1, 20000)
        await sleep(1500)
        notes.push(`${level}: ${eventsAfter(bob, seen, names).map(event => `${event.name}(${JSON.stringify(event.args)})`).join(', ')}`)
      }
      steps.push(await httpStep(ctx.site, alice, 'GET', `/project/${project.id}/members`, { secrets: ctx.secrets }))
      await bob.close()
      return [...steps, { socket: { user: 'bob', projectId: project.id, transport: 'websocket', frames: bob.frames } }]
    },
  },
  'restricted-link-join': {
    description:
      'Alice turns on link sharing for a throwaway project, and Erin opens its read-only link and joins: the join a restricted (token read-only) user gets, and whether the members route refuses her.',
    async run(ctx, notes) {
      const alice = await ctx.signInAs('alice')
      const anyProject = ctx.state.projects['sharejs-project'].id
      const token = await csrfFor(ctx.site, alice, anyProject)
      const created = await httpStep(ctx.site, alice, 'POST', '/project/new', {
        token,
        secrets: ctx.secrets,
        body: { projectName: `link-probe-${stamp()}`, template: 'none' },
      })
      const projectId = created.body.project_id
      const share = await httpStep(ctx.site, alice, 'POST', `/project/${projectId}/settings/admin`, { token, secrets: ctx.secrets, body: { publicAccessLevel: 'tokenBased' } })
      const tokens = await httpStep(ctx.site, alice, 'GET', `/project/${projectId}/tokens`, { secrets: ctx.secrets })
      notes.push(`link sharing answered ${share.status}, tokens answered ${tokens.status}`)
      const readOnly = tokens.body?.readOnly
      if (!readOnly) return [created, share, tokens]
      ctx.secrets.add(readOnly)
      const erin = await ctx.signInAs('erin')
      const landing = await fetch(`${ctx.site}/read/${readOnly}`, { headers: { cookie: erin.header() } })
      erin.absorb(landing)
      const erinToken = (await landing.text()).match(/name="ol-csrfToken" content="([^"]+)"/)?.[1]
      const grant = await httpStep(ctx.site, erin, 'POST', `/read/${readOnly}/grant`, { token: erinToken, secrets: ctx.secrets, body: { confirmedByUser: true } })
      notes.push(`grant answered ${grant.status} ${JSON.stringify(grant.body).slice(0, 120)}`)
      const client = new ScriptedClient('erin', ctx.clock)
      await client.open(ctx.site, erin, projectId, ctx.secrets, { websocket: true })
      await client.outcome()
      const join = client.events.find(event => event.name === 'joinProjectResponse')?.args?.[0]
      if (join) {
        notes.push(`permissionsLevel ${join.permissionsLevel}; owner keys ${Object.keys(join.project.owner).join(',')}; members ${join.project.members.length}; invites ${join.project.invites.length}`)
      } else {
        notes.push(`no join: ${JSON.stringify(client.events.map(event => event.name))}`)
      }
      const members = await httpStep(ctx.site, erin, 'GET', `/project/${projectId}/members`, { secrets: ctx.secrets })
      notes.push(`members answered ${members.status}`)
      await client.close()
      return [created, share, grant, members, { socket: { user: 'erin', projectId, transport: 'websocket', frames: client.frames } }]
    },
  },
  'rest-reads': {
    description: 'The read routes a live session uses: entities, members, history updates, the file-tree diff, threads and chat.',
    async run(ctx) {
      const project = ctx.state.projects['sharejs-project']
      const alice = await ctx.signInAs('alice')
      const updates = await httpStep(ctx.site, alice, 'GET', `/project/${project.id}/updates?min_count=3`, { secrets: ctx.secrets })
      if (Array.isArray(updates.body?.updates)) updates.body.updates = updates.body.updates.slice(0, 3)
      const to = updates.body?.updates?.[0]?.toV ?? 1
      const diff = await httpStep(ctx.site, alice, 'GET', `/project/${project.id}/filetree/diff?from=${Math.max(0, to - 1)}&to=${to}`, { secrets: ctx.secrets })
      if (Array.isArray(diff.body?.diff)) {
        diff.body.diff = diff.body.diff.filter(entry => entry.operation || /^(main\.tex|refs\.bib|figure\.png)$/.test(entry.pathname)).slice(0, 8)
      }
      const entities = await httpStep(ctx.site, alice, 'GET', `/project/${project.id}/entities`, { secrets: ctx.secrets })
      if (Array.isArray(entities.body?.entities)) entities.body.entities = entities.body.entities.filter(entity => !/-\d{8}-\d{6}/.test(entity.path))
      return [
        entities,
        await httpStep(ctx.site, alice, 'GET', `/project/${project.id}/members`, { secrets: ctx.secrets }),
        updates,
        diff,
        await httpStep(ctx.site, alice, 'GET', `/project/${project.id}/threads`, { secrets: ctx.secrets }),
        await httpStep(ctx.site, alice, 'GET', `/project/${project.id}/messages?limit=5`, { secrets: ctx.secrets }),
      ]
    },
  },
}

async function runProbe(name, env, state) {
  const probe = probes[name]
  if (!probe) throw new Error(`unknown probe ${name}`)
  const secrets = new Set(
    Object.entries(env)
      .filter(([key]) => /PASSWORD|SECRET/.test(key))
      .map(([, value]) => value)
  )
  const ctx = {
    site: state.site,
    state,
    secrets,
    clock: { start: Date.now() },
    signInAs: key => signIn(state.site, state.users[key].email, env[`${key.toUpperCase()}_PASSWORD`], secrets),
  }
  const notes = []
  const steps = await probe.run(ctx, notes)
  const summary = {
    probe: name,
    description: probe.description,
    server: `Overleaf Community Edition 6.3.3 (${image})`,
    recordedAt: new Date().toISOString().slice(0, 10),
    notes,
    steps,
  }
  const clean = redact(`${JSON.stringify(summary, null, 2)}\n`, secrets)
  const leak = clean.match(forbidden)
  if (leak) throw new Error(`probe ${name} still contains "${leak[0]}" after redaction`)
  const target = path.join(fixtures, 'probes')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, `${name}.json`), clean)
  console.log(`probed ${name}`)
  for (const note of notes) console.log(`  ${note}`)
}

const gateBinary = path.join(repo, 'src-tauri/target/debug/examples/live_doc_gate')

class GateClient {
  constructor(name) {
    this.name = name
    this.nextId = 1
    this.waiting = new Map()
    this.errors = []
  }

  async start(site, projectId, jar, carrier) {
    this.child = spawn(gateBinary, ['--server', site, '--project', projectId, '--carrier', carrier], {
      env: { ...process.env, GATE_COOKIE: jar.header() },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stderr.on('data', data => this.errors.push(String(data)))
    const ready = new Promise((resolve, reject) => {
      this.child.once('exit', code => reject(new Error(`${this.name}'s gate client exited with ${code}: ${this.errors.join('')}`)))
      readline.createInterface({ input: this.child.stdout }).on('line', line => {
        const message = JSON.parse(line)
        if (message.ready) return resolve(message)
        const waiter = this.waiting.get(message.id)
        if (!waiter) return
        this.waiting.delete(message.id)
        if (message.ok) waiter.resolve(message.result)
        else waiter.reject(new Error(`${this.name}: ${message.error}`))
      })
    })
    this.user = (await ready).user
    return this
  }

  send(cmd, args = {}) {
    const id = this.nextId++
    const reply = new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }))
    this.child.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`)
    return reply
  }

  async doc(docId) {
    const { docs } = await this.send('state')
    return docs.find(doc => doc.doc === docId)
  }

  async stop() {
    this.child.stdin.end()
    await new Promise(resolve => this.child.once('exit', resolve))
  }
}

function snapshotOf(reply) {
  if (reply[0]) throw new Error(`the final joinDoc failed: ${JSON.stringify(reply[0])}`)
  if (reply[5] === 'history-ot') {
    const raw = reply[1]
    const tracked = (raw.trackedChanges ?? []).map(change => ({
      pos: change.range.pos,
      length: change.range.length,
      type: change.tracking.type,
      user: change.tracking.userId,
    }))
    let visible = ''
    let at = 0
    for (const change of [...tracked].sort((a, b) => a.pos - b.pos)) {
      if (change.type !== 'delete') continue
      visible += raw.content.slice(at, change.pos)
      at = change.pos + change.length
    }
    visible += raw.content.slice(at)
    return { format: 'history-ot', text: visible, content: raw.content, tracked }
  }
  const text = reply[1].map(line => Buffer.from(line, 'latin1').toString('utf8')).join('\n')
  const changes = (reply[4]?.changes ?? []).map(change => ({
    kind: change.op.i !== undefined ? 'Insert' : 'Delete',
    at: change.op.p,
    text: change.op.i ?? change.op.d,
    user: change.metadata?.user_id ?? null,
  }))
  return { format: 'sharejs-text-ot', text, changes }
}

const shareJsChange = change => ({ kind: change.kind, at: change.at, text: change.text, user: change.user })
const trackedRange = range => ({ pos: range.pos, length: range.length, type: range.type, user: range.user })
const byPosition = list => [...list].sort((a, b) => (a.at ?? a.pos) - (b.at ?? b.pos) || JSON.stringify(a).localeCompare(JSON.stringify(b)))

function rangesOf(state) {
  return state.ranges.format === 'history-ot'
    ? { content: state.ranges.content, tracked: byPosition(state.ranges.tracked.map(trackedRange)) }
    : { changes: byPosition(state.ranges.changes.map(shareJsChange)) }
}

function webHealth(person) {
  const incoming = person.frames.filter(frame => frame.dir === 'in').map(frame => frame.frame)
  return {
    closed: person.closed,
    disconnects: incoming.filter(frame => frame.startsWith('0::')).length,
    updateErrors: incoming.filter(frame => frame.includes('"otUpdateError"')),
    rejections: incoming.filter(frame => frame.includes('"connectionRejected"')),
  }
}

async function gateProject(key, browser, env, state, folder) {
  const project = state.projects[key]
  const history = project.format === 'history-ot'
  const webTyping = !history || process.env.GATE_HISTORY_WEB === '1'
  const site = state.site
  const secrets = new Set(Object.entries(env).filter(([name]) => /PASSWORD|SECRET/.test(name)).map(([, value]) => value))
  const signInAs = who => signIn(site, state.users[who].email, env[`${who.toUpperCase()}_PASSWORD`], secrets)
  const steps = []
  const note = (step, detail) => {
    steps.push({ step, ...detail })
    console.log(`  ${key}: ${step}${detail.ok === false ? ' FAILED' : ''}`)
  }
  const aliceJar = await signInAs('alice')
  const token = await csrfFor(site, aliceJar, project.id)
  const name = `gate-${stamp()}.tex`
  const created = await httpStep(site, aliceJar, 'POST', `/project/${project.id}/doc`, {
    token,
    secrets,
    body: { name, parent_folder_id: project.rootFolderId },
  })
  const docId = created.body._id
  const alice = await new GateClient('alice').start(site, project.id, aliceJar, 'websocket')
  const carol = await new GateClient('carol').start(site, project.id, await signInAs('carol'), 'xhr-polling')
  const rust = [alice, carol]
  for (const client of rust) {
    note(`${client.name} connects`, { ok: true, ...(await client.send('connect')) })
    await client.send('open', { doc: docId })
  }
  await carol.send('suggest', { ts: new Date().toISOString() })
  const harPath = path.join(folder, `${key}-bob.har`)
  let bob = null
  const startBob = async () => {
    bob = new Participant('bob', { start: Date.now() })
    await bob.start(browser, site, state.users.bob.email, env.BOB_PASSWORD, harPath, secrets)
    await bob.openProject(site, project.id)
    await bob.openDoc(name, docId)
  }
  const settleAll = async label => {
    const settled = await Promise.all(rust.map(client => client.send('settle', { quietMs: 2500, limitMs: 90000 })))
    const target = settled[0].docs[0].text
    const texts = { alice: target, carol: settled[1].docs[0].text }
    if (bob) {
      await settle([bob], { open: false })
      texts.bob = await bob.text()
      for (let tries = 0; tries < 100 && texts.bob !== target; tries++) {
        await sleep(200)
        texts.bob = await bob.text()
      }
    }
    const ok = settled.every(result => result.settled) && Object.values(texts).every(text => text === target)
    note(label, { ok, texts })
    return ok
  }
  if (webTyping) await startBob()
  const end = async () => (await alice.doc(docId)).text.length
  await alice.send('type', { doc: docId, at: 0, text: 'Gate base text for live editing, with words to change.\n' })
  await settleAll('base text from Alice')
  if (webTyping) {
    bob.hold()
    await bob.cursor(0)
    await bob.type('B1 ')
    await until('Bob to queue his update', () => bob.queue.some(message => String(message).includes('"applyOtUpdate"')), 15000)
    await alice.send('type', { doc: docId, at: await end(), text: ' A1' })
    await alice.send('settle', { quietMs: 1500, limitMs: 30000 })
    bob.release()
    await settleAll('the server transforms the web editor against Alice')
    await alice.send('deafen')
    await bob.cursor((await bob.text()).length)
    await bob.type(' B2')
    await settle([bob], { open: false })
    await alice.send('type', { doc: docId, at: 0, text: 'A2 ' })
    await sleep(1500)
    await alice.send('hear')
    await settleAll('the server transforms Alice against the web editor')
  }
  await alice.send('deafen')
  await carol.send('deafen')
  const middle = Math.floor((await end()) / 2)
  await alice.send('type', { doc: docId, at: middle, text: '[A3]' })
  await carol.send('type', { doc: docId, at: middle, text: '[C3]' })
  await sleep(1500)
  await alice.send('hear')
  await carol.send('hear')
  await settleAll('Alice and a suggesting Carol type at the same spot')
  if (!webTyping) await startBob()
  const words = (await alice.doc(docId)).text.indexOf('words')
  await carol.send('type', { doc: docId, at: 0, text: 'Suggested opening. ' })
  await carol.send('delete', { doc: docId, at: words + 'Suggested opening. '.length, length: 'words'.length })
  await settleAll('Carol suggests an insert and a delete')
  await bob.cursor((await bob.text()).length)
  await bob.type(' bob turn')
  await settleAll('Bob types on his own')
  for (const [client, sent, label] of [
    [alice, true, 'Alice drops mid-op after sending'],
    [alice, false, 'Alice drops mid-op before sending'],
    [carol, true, 'Carol drops mid-op after sending a suggestion over polling'],
  ]) {
    await client.send('hold')
    await client.send('type', { doc: docId, at: await end(), text: ` ${client.name[0].toUpperCase()}R` })
    if (webTyping) {
      await bob.cursor(0)
      await bob.type('b ')
    }
    const dropped = await client.send('drop', { sent })
    await client.send('release')
    note(`${label}: reconnected`, { ok: true, dropped })
    await settleAll(label)
  }
  const checker = new ScriptedClient('dave', { start: Date.now() })
  await checker.open(site, await signInAs('dave'), project.id, secrets)
  await checker.outcome()
  const server = snapshotOf(await checker.call('joinDoc', [docId, { encodeRanges: true, supportsHistoryOT: true }]))
  await checker.close()
  const finals = Object.fromEntries(await Promise.all(rust.map(async client => [client.name, await client.doc(docId)])))
  const serverRanges = server.format === 'history-ot'
    ? { content: server.content, tracked: byPosition(server.tracked.map(trackedRange)) }
    : { changes: byPosition(server.changes.map(shareJsChange)) }
  const texts = { server: server.text, alice: finals.alice.text, carol: finals.carol.text, bob: await bob.text() }
  const textsAgree = Object.values(texts).every(text => text === texts.server)
  const rangesAgree = rust.every(client => JSON.stringify(rangesOf(finals[client.name])) === JSON.stringify(serverRanges))
  const trackedSeen = server.format === 'history-ot' ? server.tracked.length > 0 : server.changes.length > 0
  note('final texts match the server', { ok: textsAgree, texts })
  note('tracked changes match the server', { ok: rangesAgree && trackedSeen, server: serverRanges, alice: rangesOf(finals.alice), carol: rangesOf(finals.carol) })
  const health = {}
  for (const client of rust) health[client.name] = await client.send('health')
  health.bob = webHealth(bob)
  const rustHealthy = rust.every(client => {
    const found = health[client.name].health
    return client.errors.length === 0 && !found.updateErrors.length && !found.refusals.length && !found.drops.length && !found.unexpected.length && !found.rejoins.some(rejoin => rejoin.includes('conflict')) && health[client.name].connected
  })
  const webHealthy = !health.bob.closed && !health.bob.disconnects && !health.bob.updateErrors.length && !health.bob.rejections.length
  note('no client was disconnected or refused', { ok: rustHealthy && webHealthy, health })
  for (const client of rust) await client.stop()
  await bob.context.close()
  await fs.rm(harPath, { force: true })
  await httpStep(site, aliceJar, 'DELETE', `/project/${project.id}/doc/${docId}`, { token, secrets })
  return { project: key, format: project.format, doc: name, ok: steps.every(step => step.ok !== false), steps }
}

async function runGate(env, state, only) {
  const folder = path.join(here, `.gate-${stamp()}`)
  await fs.mkdir(folder, { recursive: true })
  const browser = await chromium.launch()
  const results = []
  try {
    for (const key of only.length ? only : ['sharejs-project', 'history-ot-project']) results.push(await gateProject(key, browser, env, state, folder))
  } finally {
    await browser.close()
  }
  await fs.writeFile(path.join(folder, 'report.json'), `${JSON.stringify({ server: image, results }, null, 2)}\n`)
  for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.project} (${result.format})`)
  console.log(`report: ${path.join(folder, 'report.json')}`)
  if (results.some(result => !result.ok)) process.exitCode = 1
}

async function main() {
  const asked = process.argv.slice(2)
  if (asked.includes('--list')) {
    for (const [name, scenario] of Object.entries(scenarios)) console.log(`${name}: ${scenario.description}`)
    for (const [name, probe] of Object.entries(probes)) console.log(`--probes ${name}: ${probe.description}`)
    console.log('--gate [sharejs-project|history-ot-project]: drive the live doc client, a web editor and a suggesting reviewer at once, with reconnects mid-op, and check that everyone converges')
    return
  }
  const env = await readEnv()
  const state = JSON.parse(await fs.readFile(path.join(here, 'seed-state.json'), 'utf8'))
  if (asked.includes('--gate')) {
    await runGate(env, state, asked.filter(arg => arg !== '--gate'))
    return
  }
  if (asked.includes('--probes')) {
    const wanted = asked.filter(arg => arg !== '--probes')
    for (const name of wanted.length ? wanted : Object.keys(probes)) await runProbe(name, env, state)
    return
  }
  const names = asked.length === 0 || asked.includes('--all') ? Object.keys(scenarios) : asked
  const browser = await chromium.launch()
  try {
    for (const name of names) await record(name, browser, env, state)
  } finally {
    await browser.close()
  }
}

await main()
