import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { featureProbes } from './feature-probes.mjs'
import { reviewSafe } from './review-safe.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const fixtures = path.join(repo, 'crates/oleafly-online/tests/fixtures/overleaf-rt')
const forbidden = /overleaf_session2|sharelatex\.sid|overleaf\.sid|csrf|password|"cookie"|"set-cookie"/i
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
  for (let attempt = 1; ; attempt++) {
    const jar = cookieJar()
    const login = await fetch(`${site}/login`)
    jar.absorb(login)
    const loginToken = (await login.text()).match(/name="ol-csrfToken" content="([^"]+)"/)[1]
    secrets.add(loginToken)
    const signedIn = await fetch(`${site}/login`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', cookie: jar.header() },
      body: JSON.stringify({ email, password, _csrf: loginToken }),
    })
    jar.absorb(signedIn)
    if (signedIn.status === 429 && attempt < 4) {
      await sleep(20000 * attempt)
      continue
    }
    if (!signedIn.ok) throw new Error(`sign-in as ${email} failed with HTTP ${signedIn.status}`)
    for (const value of jar.values()) secrets.add(value)
    return jar
  }
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

  async connect(site, email, password, projectId, secrets, options = {}) {
    const jar = await signIn(site, email, password, secrets)
    await this.open(site, jar, projectId, secrets, options)
    await until(`${this.name} to join the project`, () =>
      this.events.some(event => event.name === 'joinProjectResponse')
    )
  }

  async reconnect() {
    if (!this.closed) await this.close()
    await this.loop
    const seen = this.events.length
    this.closed = false
    this.socket = null
    await this.open(this.site, this.jar, this.projectId, this.secrets, this.options)
    await until(`${this.name} to join the project again`, () =>
      this.events.slice(seen).some(event => event.name === 'joinProjectResponse')
    )
  }

  async open(site, jar, projectId, secrets, options = {}) {
    const { websocket = false, query: extra = '' } = options
    Object.assign(this, { site, projectId, secrets, options })
    this.jar = jar ?? cookieJar()
    const query = `projectId=${encodeURIComponent(projectId)}${extra}`
    const handshake = await fetch(`${site}/socket.io/1/?${query}&t=${Date.now()}`, {
      headers: { cookie: this.jar.header() },
    })
    this.jar.absorb(handshake)
    for (const value of this.jar.values()) secrets.add(value)
    const sid = (await handshake.text()).split(':')[0]
    if (websocket) {
      const socket = new WebSocket(`${site.replace('http', 'ws')}/socket.io/1/websocket/${sid}?${query}`, {
        headers: { cookie: this.jar.header() },
      })
      this.socket = socket
      socket.onmessage = message => this.receive(String(message.data))
      socket.onclose = () => {
        if (this.socket === socket) this.closed = true
      }
      await until(`${this.name}'s websocket to open`, () => socket.readyState === 1 || this.closed)
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
    await until(`${this.name} to get a reply to ${name}`, () => this.acks.has(id) || this.closed, 30000)
    if (!this.acks.has(id)) throw new Error(`${this.name} was disconnected before ${name} was answered`)
    return this.acks.get(id)
  }

  joinDoc(docId) {
    return this.call('joinDoc', [docId, { encodeRanges: true, supportsHistoryOT: true }])
  }

  async attempt(docId, update, wait = 10000) {
    const seen = this.events.length
    const reply = await this.call('applyOtUpdate', [docId, update]).catch(() => null)
    if (!reply) return { outcome: 'disconnected', disconnected: true }
    const disconnect = () => until(`${this.name} to be disconnected`, () => this.closed, 5000).catch(() => {})
    if (reply[0]) {
      await disconnect()
      return { outcome: 'refused', error: reply[0], disconnected: this.closed }
    }
    const started = Date.now()
    while (Date.now() - started < wait) {
      const later = this.events.slice(seen)
      const ack = later.find(
        event => event.name === 'otUpdateApplied' && event.args[0].doc === docId && !event.args[0].op
      )
      if (ack) return { outcome: 'applied', ack: ack.args[0] }
      const error = later.find(event => event.name === 'otUpdateError')
      if (error) {
        await disconnect()
        return { outcome: 'error', error: error.args, disconnected: this.closed }
      }
      if (this.closed) return { outcome: 'disconnected', disconnected: true }
      await sleep(100)
    }
    return { outcome: 'no ack' }
  }

  async update(docId, update) {
    const result = await this.attempt(docId, update, 60000)
    if (result.outcome !== 'applied') {
      throw new Error(`${this.name}'s update was not applied: ${JSON.stringify(result)}`)
    }
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
    this.console = []
    this.listening = false
  }

  log(type, text) {
    if (!this.listening) return
    const clean = forbidden.test(text) ? '[dropped: matched the fixture secrets filter]' : text.slice(0, 2000)
    this.console.push({ t: Date.now() - this.clock.start, type, text: clean })
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
    this.page.on('console', message => this.log(message.type(), message.text()))
    this.page.on('pageerror', error => this.log('pageerror', String(error?.stack ?? error)))
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
    this.listening = true
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

  async undo() {
    await this.page.evaluate(() => document.querySelector('.cm-content').cmView.view.focus())
    await this.page.keyboard.press('ControlOrMeta+z')
  }

  marks() {
    return this.page.evaluate(() =>
      Object.fromEntries(
        ['c', 'i', 'd'].map(kind => [kind, document.querySelectorAll(`.cm-content .ol-cm-change-${kind}`).length])
      )
    )
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

let seeds = 0

function idSeed() {
  seeds += 1
  return `${Math.floor(Date.now() / 1000).toString(16).padStart(8, '0')}c0ffee${seeds.toString(16).padStart(4, '0')}`
}

const objectId = () => `${idSeed()}000001`
const changeId = (seed, n) => `${seed}${n.toString(16).padStart(6, '0')}`

function at(text, needle, offset = 0) {
  const index = text.indexOf(needle)
  if (index < 0) throw new Error(`${JSON.stringify(needle)} is not in ${JSON.stringify(text)}`)
  return index + offset
}

function textOperation(length, start, ...parts) {
  const consumed = parts.reduce((sum, part) => {
    if (typeof part === 'number') return sum + Math.abs(part)
    if (typeof part === 'object' && 'r' in part) return sum + part.r
    return sum
  }, 0)
  const rest = length - start - consumed
  if (rest < 0) throw new Error('the text operation runs past the end of the document')
  return { textOperation: [...(start > 0 ? [start] : []), ...parts, ...(rest > 0 ? [rest] : [])] }
}

function changeOf(server, kind, text) {
  const found = (server.ranges.changes ?? []).find(change => change.op[kind] === text)
  if (!found) throw new Error(`no tracked ${kind === 'i' ? 'insert' : 'delete'} of ${JSON.stringify(text)}`)
  return found
}

function trackedAt(raw, type, text) {
  const found = (raw.trackedChanges ?? []).find(
    change =>
      change.tracking.type === type &&
      raw.content.slice(change.range.pos, change.range.pos + change.range.length) === text
  )
  if (!found) throw new Error(`no tracked ${type} of ${JSON.stringify(text)}`)
  return found.range.pos
}

async function failure(act) {
  try {
    await act()
    return {}
  } catch (error) {
    return { error: String(error.message).split('\n').slice(0, 2).join(' ') }
  }
}

function reviewKit({ people, doc, format, settle, extra }) {
  const steps = []
  const seen = new Map(people.map(person => [person, { frames: 0, console: 0 }]))
  let known = []
  const kit = {
    matched: true,
    server: () => documentUpdater(doc.projectId, doc.id),
    async join(...clients) {
      for (const client of clients) {
        const reply = await client.joinDoc(doc.id)
        if (reply[0]) throw new Error(`${client.name} could not join the doc: ${JSON.stringify(reply[0])}`)
      }
    },
    async send(client, label, build, detail = {}) {
      const before = await kit.server()
      const update = { doc: doc.id, v: before.version, ...build(before) }
      const result = await client.attempt(doc.id, update)
      if (result.disconnected) {
        await client.reconnect()
        await kit.join(client)
      }
      return kit.capture(label, { who: client.name, sent: update, result, ...detail })
    },
    async edit(person, label, change, userEvent = 'input.type') {
      const changes = change(await person.text())
      const error = await failure(() => person.change(changes, userEvent))
      return kit.capture(label, { who: person.name, edit: { changes, userEvent, ...error } })
    },
    async undo(person, label) {
      const error = await failure(() => person.undo())
      return kit.capture(label, { who: person.name, edit: { undo: true, ...error } })
    },
    async capture(label, detail = {}) {
      await settle({ open: false })
      let server = await kit.server()
      const web = {}
      for (const person of people) {
        const read = () => person.text().catch(() => null)
        let text = await read()
        for (let tries = 1; tries <= 30 && text !== server.text; tries++) {
          await sleep(200)
          if (tries % 10 === 0) server = await kit.server()
          text = await read()
        }
        const mark = seen.get(person)
        web[person.name] = {
          matchesServer: text === server.text,
          ...(text === server.text ? {} : { text }),
          marks: await person.marks().catch(() => null),
          sent: person.frames
            .slice(mark.frames)
            .filter(frame => frame.dir === 'out' && frame.frame.includes('"applyOtUpdate"'))
            .map(frame => JSON.parse(frame.frame.slice(frame.frame.indexOf('{'))).args[1]),
          ...webHealth(person, mark.frames),
          console: person.console
            .slice(mark.console)
            .filter(entry => ['error', 'warning', 'pageerror'].includes(entry.type)),
        }
        seen.set(person, { frames: person.frames.length, console: person.console.length })
      }
      const entry = { step: steps.length + 1, label, ...detail }
      if (format !== 'history-ot') {
        const ids = (server.ranges.changes ?? []).map(change => change.id)
        const beyond = (list, other) => {
          const left = [...other]
          return list.filter(id => {
            const index = left.indexOf(id)
            if (index < 0) return true
            left.splice(index, 1)
            return false
          })
        }
        entry.changeIds = { added: beyond(ids, known), removed: beyond(known, ids) }
        const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index)
        if (duplicated.length) entry.changeIds.duplicated = duplicated
        known = ids
        if (detail.expect) {
          entry.predictionHeld =
            JSON.stringify([...detail.expect].sort()) === JSON.stringify([...entry.changeIds.added].sort())
        }
      }
      entry.server = { version: server.version, text: server.text, ...(server.raw ? { raw: server.raw } : {}), ranges: server.ranges }
      entry.web = web
      kit.matched = Object.values(web).every(person => person.matchesServer)
      steps.push(entry)
      extra.set('steps.json', `${JSON.stringify({ doc: doc.id, format, steps }, null, 2)}\n`)
      const outcome = detail.result ? ` -> ${detail.result.outcome}` : ''
      const held = 'predictionHeld' in entry ? ` (prediction ${entry.predictionHeld ? 'held' : 'failed'})` : ''
      const desync = Object.values(web).some(person => !person.matchesServer) ? ' [web editor differs from the server]' : ''
      console.log(`  ${entry.step}. ${label}${outcome}${held}${desync}`)
      return entry
    },
  }
  return kit
}

const commentBase = 'The quick brown fox jumps over the lazy dog.\nA second line, with Größe ☕ to comment on.\n'
const suggestionBase =
  'Keep this sentence. Remove this word please.\nAnother line to change here.\nThird line with more words.\nFourth line to accept.\n'
const pasteBase =
  'First paragraph has a commented phrase in it.\nSecond paragraph is where the paste goes.\nThird paragraph has a word to delete.\n'

const shareJsAnchor = (needle, t, extra = {}) => ({ text }) => ({ op: [{ p: at(text, needle), c: needle, t }], ...extra })
const historyRange = (raw, needle) => ({ pos: at(raw.content, needle), length: needle.length })
const historyComment = (commentId, needles, extra = {}) => ({ raw }) => ({
  op: [{ commentId, ranges: needles.map(needle => historyRange(raw, needle)), ...extra }],
})
const historyText = (raw, start, ...parts) => ({ op: [textOperation(raw.content.length, start, ...parts)] })
const trackedShareJs = (...op) => ({ op, meta: { tc: idSeed() } })
const tracking = (state, who, type) => ({ type, userId: state.users[who].id, ts: new Date().toISOString() })
const untracked = { type: 'none' }

async function suggestOnHistoryOT(review, carol, state) {
  const by = type => tracking(state, 'carol', type)
  await review.send(carol, 'carol suggests inserting "whole "', ({ raw }) =>
    historyText(raw, at(raw.content, 'sentence'), { i: 'whole ', tracking: by('insert') })
  )
  await review.send(carol, 'carol suggests deleting "word "', ({ raw }) =>
    historyText(raw, at(raw.content, 'word '), { r: 5, tracking: by('delete') })
  )
  await review.send(carol, 'carol suggests inserting "NEW " on line 2', ({ raw }) =>
    historyText(raw, at(raw.content, 'line to change'), { i: 'NEW ', tracking: by('insert') })
  )
  await review.send(carol, 'carol suggests deleting "change " on line 2', ({ raw }) =>
    historyText(raw, at(raw.content, 'change '), { r: 7, tracking: by('delete') })
  )
  await review.send(carol, 'carol suggests an insert and a delete on line 3 in one text operation', ({ raw }) => {
    const x = at(raw.content, 'with')
    return historyText(raw, x, { i: 'X', tracking: by('insert') }, at(raw.content, 'more ') - x, {
      r: 5,
      tracking: by('delete'),
    })
  })
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
      const joined = await carol.joinDoc(doc.id)
      let version = joined[2]
      const removeAt = 'Keep this sentence. Remove this '.length
      const removed = 'word '.length
      await carol.update(doc.id, {
        doc: doc.id,
        op: [{ textOperation: [removeAt, { r: removed, tracking: tracking(state, 'carol', 'delete') }, content.length - removeAt - removed] }],
        v: version,
      })
      version += 1
      const insertAt = 'Keep this '.length
      await carol.update(doc.id, {
        doc: doc.id,
        op: [{ textOperation: [insertAt, { i: 'whole ', tracking: tracking(state, 'carol', 'insert') }, content.length - insertAt] }],
        v: version,
      })
      await settle()
      const visible = await bob.text()
      await bob.cursor(visible.indexOf('please'))
      await bob.type('big ')
      await settle()
      const after = await carol.joinDoc(doc.id)
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
  'sharejs-comment-anchors': {
    description:
      'Comment anchors on a ShareJS doc. Scripted clients for Dave (viewer), Carol (reviewer) and Alice (owner) send {p, c, t} ops, including mixes the server refuses, then Bob types inside, at the edges of and across the comments in the CE web editor. steps.json holds the document-updater ranges after every step.',
    project: 'sharejs-project',
    people: ['bob'],
    scripted: ['dave', 'carol', 'alice'],
    transport: 'websocket',
    server: true,
    async run({ bob, dave, carol, alice, doc, review, settle }) {
      await bob.change({ from: 0, insert: commentBase })
      await settle()
      await review.join(dave, carol, alice)
      await review.capture('bob types the base text', { who: 'bob' })
      const quick = objectId()
      const lazy = objectId()
      await review.send(dave, 'dave (viewer) comments on "quick brown"', shareJsAnchor('quick brown', quick))
      await review.send(carol, 'carol (reviewer) comments on "lazy dog"', shareJsAnchor('lazy dog', lazy))
      await review.send(alice, 'alice (owner) comments on "brown fox", overlapping the first comment', shareJsAnchor('brown fox', objectId()))
      await review.send(alice, 'alice comments on accented text and an emoji', shareJsAnchor('Größe ☕', objectId()))
      await review.send(
        carol,
        'carol (reviewer) comments on "second" with meta.tc set',
        shareJsAnchor('second', objectId(), { meta: { tc: idSeed() } })
      )
      await review.send(dave, 'dave (viewer) sends a comment and an insert in one update', ({ text }) => ({
        op: [{ p: at(text, 'jumps'), c: 'jumps', t: objectId() }, { p: 0, i: 'x' }],
      }))
      await review.send(dave, 'dave (viewer) sends a plain insert', () => ({ op: [{ p: 0, i: 'x' }] }))
      await review.edit(bob, 'bob types strictly inside "quick brown"', text => ({
        from: at(text, 'quick', 'quick'.length),
        insert: ' very',
      }))
      await review.edit(bob, 'bob types at the start edge of the first comment', text => ({ from: at(text, 'quick very'), insert: 'so ' }))
      await review.edit(bob, 'bob types at the end edge of the first comment, inside "brown fox"', text => ({
        from: at(text, 'quick very brown', 'quick very brown'.length),
        insert: '-ish',
      }))
      await review.edit(
        bob,
        'bob deletes across the start edge of "lazy dog"',
        text => ({ from: at(text, 'the lazy'), to: at(text, 'the lazy', 'the la'.length) }),
        'delete'
      )
      await review.edit(
        bob,
        'bob deletes the rest of the "lazy dog" comment',
        text => ({ from: at(text, 'zy dog'), to: at(text, 'zy dog', 'zy dog'.length) }),
        'delete'
      )
      await review.edit(bob, 'bob types where the detached comment sits', text => ({ from: at(text, 'over ', 'over '.length), insert: 'sleepy cat' }))
      await review.send(dave, 'dave (viewer) re-sends the detached comment with an empty c', ({ text }) => ({
        op: [{ p: at(text, 'sleepy'), c: '', t: lazy }],
      }))
      await review.send(dave, 'dave (viewer) re-anchors the detached comment on "sleepy cat"', shareJsAnchor('sleepy cat', lazy))
      await review.edit(bob, 'bob replaces text across the end of the accented comment', text => ({
        from: at(text, '☕'),
        to: at(text, '☕', '☕ to'.length),
        insert: 'tea for',
      }))
      const reply = await alice.joinDoc(doc.id)
      await review.capture('alice joins the doc again', { who: 'alice', joinDoc: { version: reply[2], ranges: reply[4] } })
    },
  },
  'history-ot-comment-anchors': {
    description:
      'Comment anchors on a history-ot doc. Dave (viewer), Carol (reviewer) and Alice (owner) send AddComment, SetCommentState and DeleteComment, with the refusals recorded, then Bob types inside, at the edges of and across the comments in the CE web editor, which adds commentIds itself. steps.json holds the raw snapshot after every step.',
    project: 'history-ot-project',
    people: ['bob'],
    scripted: ['dave', 'carol', 'alice'],
    transport: 'websocket',
    server: true,
    async run({ bob, dave, carol, alice, doc, review, settle }) {
      await bob.change({ from: 0, insert: commentBase })
      await settle()
      await review.join(dave, carol, alice)
      await review.capture('bob types the base text', { who: 'bob' })
      const quick = objectId()
      const lazy = objectId()
      const brown = objectId()
      await review.send(dave, 'dave (viewer) adds a comment on "quick brown"', historyComment(quick, ['quick brown']))
      await review.send(carol, 'carol (reviewer) adds a comment on "lazy dog"', historyComment(lazy, ['lazy dog']))
      await review.send(alice, 'alice (owner) adds a comment on "brown fox", overlapping the first', historyComment(brown, ['brown fox']))
      await review.send(dave, 'dave adds one comment with two ranges', historyComment(objectId(), ['The', 'second line']))
      await review.send(dave, 'dave adds two comments in one update', ({ raw }) => ({
        op: [
          { commentId: objectId(), ranges: [historyRange(raw, 'jumps')] },
          { commentId: objectId(), ranges: [historyRange(raw, 'Größe ☕')] },
        ],
      }))
      await review.send(dave, 'dave (viewer) resolves his comment with SetCommentState', () => ({ op: [{ commentId: quick, resolved: true }] }))
      await review.send(carol, 'carol (reviewer) resolves her own comment with SetCommentState', () => ({
        op: [{ commentId: lazy, resolved: true }],
      }))
      await review.send(carol, 'carol (reviewer) deletes her own comment with DeleteComment', () => ({ op: [{ deleteComment: lazy }] }))
      await review.send(dave, 'dave (viewer) re-adds his comment with resolved: true', historyComment(quick, ['quick brown'], { resolved: true }))
      await review.send(alice, 'alice (owner) reopens that comment with SetCommentState', () => ({ op: [{ commentId: quick, resolved: false }] }))
      await review.send(alice, 'alice resolves "brown fox" with SetCommentState', () => ({ op: [{ commentId: brown, resolved: true }] }))
      await review.send(dave, 'dave (viewer) sends AddComment and a text operation in one update', ({ raw }) => ({
        op: [{ commentId: objectId(), ranges: [historyRange(raw, 'dog')] }, textOperation(raw.content.length, 0, 'x')],
      }))
      await review.edit(bob, 'bob types strictly inside "quick brown"', text => ({
        from: at(text, 'quick', 'quick'.length),
        insert: ' very',
      }))
      await review.edit(bob, 'bob types at the start edge of the first comment', text => ({ from: at(text, 'quick very'), insert: 'so ' }))
      await review.edit(bob, 'bob types at the end edge of the first comment, inside the resolved "brown fox"', text => ({
        from: at(text, 'quick very brown', 'quick very brown'.length),
        insert: '-ish',
      }))
      await review.edit(
        bob,
        'bob deletes across the start edge of "lazy dog"',
        text => ({ from: at(text, 'the lazy'), to: at(text, 'the lazy', 'the la'.length) }),
        'delete'
      )
      await review.edit(
        bob,
        'bob deletes the rest of the "lazy dog" comment',
        text => ({ from: at(text, 'zy dog'), to: at(text, 'zy dog', 'zy dog'.length) }),
        'delete'
      )
      await review.edit(bob, 'bob types where the emptied comment sits', text => ({ from: at(text, 'over ', 'over '.length), insert: 'sleepy cat' }))
      await review.edit(bob, 'bob replaces text across the end of the accented comment', text => ({
        from: at(text, '☕'),
        to: at(text, '☕', '☕ to'.length),
        insert: 'tea for',
      }))
      await review.send(alice, 'alice (owner) deletes the "lazy dog" comment with DeleteComment', () => ({ op: [{ deleteComment: lazy }] }))
      const reply = await alice.joinDoc(doc.id)
      await review.capture('alice joins the doc again', { who: 'alice', joinDoc: { version: reply[2], comments: reply[1]?.comments ?? null } })
      await review.send(alice, 'alice sends DeleteComment for an id the doc does not have', () => ({ op: [{ deleteComment: objectId() }] }))
    },
  },
  'sharejs-tracked-change-ids': {
    description:
      "Tracked change ids on a ShareJS doc. Carol (reviewer) and Alice send tracked ops with known meta.tc seeds: one and two inserts per update, a delete, an insert that splits another user's insert, Bob's untracked typing in the CE web editor that splits one, a merge, a reused seed and a delete merge. Each step in steps.json lists the ids added and removed and the predicted ids.",
    project: 'sharejs-project',
    people: ['bob'],
    scripted: ['carol', 'alice'],
    transport: 'websocket',
    server: true,
    async run({ bob, carol, alice, review, settle }) {
      await bob.change({ from: 0, insert: 'Alpha beta gamma delta epsilon zeta eta theta iota kappa.\nA plain second line.\n' })
      await settle()
      await review.join(carol, alice)
      await review.capture('bob types the base text', { who: 'bob' })
      const tracked = (tc, ...op) => ({ op, meta: { tc } })
      const first = idSeed()
      await review.send(carol, 'carol inserts "NEW " before "beta"', ({ text }) => tracked(first, { p: at(text, 'beta'), i: 'NEW ' }), {
        tc: first,
        expect: [changeId(first, 1)],
      })
      const pair = idSeed()
      await review.send(
        carol,
        'carol sends two tracked inserts in one update, the later position first',
        ({ text }) => tracked(pair, { p: at(text, 'theta'), i: 'two ' }, { p: at(text, 'delta'), i: 'one ' }),
        { tc: pair, expect: [changeId(pair, 1), changeId(pair, 2)] }
      )
      const removal = idSeed()
      await review.send(carol, 'carol deletes "epsilon "', ({ text }) => tracked(removal, { p: at(text, 'epsilon '), d: 'epsilon ' }), {
        tc: removal,
        expect: [changeId(removal, 1)],
      })
      const split = idSeed()
      await review.send(
        alice,
        "alice inserts inside Carol's \"NEW \", splitting it",
        ({ text }) => tracked(split, { p: at(text, 'NEW ', 2), i: 'ALICE' }),
        { tc: split, expect: [changeId(split, 1), changeId(split, 2)] }
      )
      await review.edit(bob, "bob (untracked, web editor) types inside Carol's \"two \", splitting it", text => ({
        from: at(text, 'two ', 1),
        insert: 'bob',
      }))
      const merge = idSeed()
      await review.send(
        carol,
        'carol inserts "more " touching the end of her own "one "',
        ({ text }) => tracked(merge, { p: at(text, 'one ', 'one '.length), i: 'more ' }),
        { tc: merge, expect: [] }
      )
      const overlap = idSeed()
      await review.send(
        carol,
        'carol deletes "more delta", the end of her own insert and plain text',
        ({ text }) => tracked(overlap, { p: at(text, 'more delta'), d: 'more delta' }),
        { tc: overlap, expect: [changeId(overlap, 1)] }
      )
      await review.send(
        carol,
        'carol reuses the first seed for a new insert before "kappa"',
        ({ text }) => tracked(first, { p: at(text, 'kappa'), i: 'dup ' }),
        { tc: first, expect: [changeId(first, 1)] }
      )
      const touching = idSeed()
      await review.send(
        carol,
        'carol deletes "zeta ", touching her earlier delete of "epsilon "',
        ({ text }) => tracked(touching, { p: at(text, 'zeta '), d: 'zeta ' }),
        { tc: touching, expect: [] }
      )
      const cancel = idSeed()
      await review.send(
        alice,
        "alice (tracked) deletes \"NE\", the part of Carol's insert before her own",
        ({ text }) => tracked(cancel, { p: at(text, 'NEALICE'), d: 'NE' }),
        { tc: cancel, expect: [] }
      )
      await review.edit(
        bob,
        "bob (untracked) deletes \"W \", the rest of Carol's split insert",
        text => ({ from: at(text, 'ALICEW ', 5), to: at(text, 'ALICEW ', 7) }),
        'delete'
      )
      const twice = idSeed()
      await review.send(
        carol,
        'carol deletes two ranges in one update, the later position first',
        ({ text }) => tracked(twice, { p: at(text, 'plain'), d: 'plain' }, { p: at(text, 'Alpha'), d: 'Alpha' }),
        { tc: twice, expect: [changeId(twice, 1), changeId(twice, 2)] }
      )
    },
  },
  'sharejs-reject': {
    description:
      'Rejecting suggestions on a ShareJS doc with inverse ops. Carol (reviewer) suggests, then a scripted Bob (editor) sends deletes and re-inserts with u: true, one re-insert without u, several in one update, and the two-component ops that accept a change without the REST route CE lacks. Alice watches in the CE web editor.',
    project: 'sharejs-project',
    people: ['alice'],
    scripted: ['carol', 'bob'],
    transport: 'websocket',
    server: true,
    async run({ alice, carol, bob, review, settle }) {
      await alice.change({ from: 0, insert: suggestionBase })
      await settle()
      await review.join(carol, bob)
      await review.capture('alice types the base text', { who: 'alice' })
      await review.send(carol, 'carol suggests inserting "whole "', ({ text }) => trackedShareJs({ p: at(text, 'sentence'), i: 'whole ' }))
      await review.send(carol, 'carol suggests deleting "word "', ({ text }) => trackedShareJs({ p: at(text, 'word '), d: 'word ' }))
      await review.send(carol, 'carol suggests inserting "NEW " on line 2', ({ text }) => trackedShareJs({ p: at(text, 'line to change'), i: 'NEW ' }))
      await review.send(carol, 'carol suggests deleting "change " on line 2', ({ text }) => trackedShareJs({ p: at(text, 'change '), d: 'change ' }))
      await review.send(carol, 'carol suggests a delete and an insert on line 3 in one update', ({ text }) =>
        trackedShareJs({ p: at(text, 'more '), d: 'more ' }, { p: at(text, 'with'), i: 'X' })
      )
      await review.send(carol, 'carol suggests an insert and a delete on line 4 in one update', ({ text }) =>
        trackedShareJs({ p: at(text, 'to accept'), i: 'ACCEPT ' }, { p: at(text, 'Fourth line ', 'Fourth '.length), d: 'line ' })
      )
      await review.send(bob, 'bob rejects the insert "whole " with a delete marked u', server => ({
        op: [{ p: changeOf(server, 'i', 'whole ').op.p, d: 'whole ', u: true }],
      }))
      await review.send(bob, 'bob rejects the delete "word " by re-inserting it with u', server => ({
        op: [{ p: changeOf(server, 'd', 'word ').op.p, i: 'word ', u: true }],
      }))
      await review.send(bob, 'bob re-inserts the deleted "change " without u', server => ({
        op: [{ p: changeOf(server, 'd', 'change ').op.p, i: 'change ' }],
      }))
      await review.send(bob, 'bob rejects both line-3 suggestions in one update, highest position first', server => ({
        op: [
          { p: changeOf(server, 'd', 'more ').op.p, i: 'more ', u: true },
          { p: changeOf(server, 'i', 'X').op.p, d: 'X', u: true },
        ],
      }))
      await review.send(bob, 'bob accepts the insert "ACCEPT " by deleting and re-inserting it plainly', server => {
        const p = changeOf(server, 'i', 'ACCEPT ').op.p
        return { op: [{ p, d: 'ACCEPT ' }, { p, i: 'ACCEPT ' }] }
      })
      await review.send(bob, 'bob accepts the delete "line " by re-inserting it with u and deleting it plainly', server => {
        const p = changeOf(server, 'd', 'line ').op.p
        return { op: [{ p, i: 'line ', u: true }, { p, d: 'line ' }] }
      })
      await review.send(bob, 'bob rejects the insert "NEW " with a plain delete', server => ({
        op: [{ p: changeOf(server, 'i', 'NEW ').op.p, d: 'NEW ' }],
      }))
    },
  },
  'history-ot-reject': {
    description:
      'Rejecting suggestions on a history-ot doc with raw ops. Carol (reviewer) suggests, then a scripted Bob (editor) removes tracked inserts and clears the tracking on tracked deletes, one and several per text operation. Alice watches in the CE web editor and types once more at the end.',
    project: 'history-ot-project',
    people: ['alice'],
    scripted: ['carol', 'bob'],
    transport: 'websocket',
    server: true,
    async run({ alice, carol, bob, review, settle, state }) {
      await alice.change({ from: 0, insert: suggestionBase })
      await settle()
      await review.join(carol, bob)
      await review.capture('alice types the base text', { who: 'alice' })
      await suggestOnHistoryOT(review, carol, state)
      await review.send(bob, 'bob rejects the insert "whole " with a raw delete', ({ raw }) => historyText(raw, trackedAt(raw, 'insert', 'whole '), -6))
      await review.send(bob, 'bob rejects the inserts "NEW " and "X" in one text operation', ({ raw }) => {
        const first = trackedAt(raw, 'insert', 'NEW ')
        return historyText(raw, first, -4, trackedAt(raw, 'insert', 'X') - first - 4, -1)
      })
      await review.send(bob, 'bob rejects the delete "word " by clearing its tracking', ({ raw }) =>
        historyText(raw, trackedAt(raw, 'delete', 'word '), { r: 5, tracking: untracked })
      )
      await review.send(bob, 'bob rejects the deletes "change " and "more " in one text operation', ({ raw }) => {
        const first = trackedAt(raw, 'delete', 'change ')
        return historyText(raw, first, { r: 7, tracking: untracked }, trackedAt(raw, 'delete', 'more ') - first - 7, {
          r: 5,
          tracking: untracked,
        })
      })
      await review.edit(alice, 'alice types at the end of line 1 after the rejects', text => ({
        from: at(text, 'please.', 'please.'.length),
        insert: ' Alice was here.',
      }))
    },
  },
  'history-ot-accept': {
    description:
      'Accepting suggestions on a history-ot doc by op. Carol (reviewer) suggests and tries to accept her own, then a scripted Bob (editor) clears the tracking on tracked inserts and removes tracked deletes, one and several per text operation. Alice watches in the CE web editor.',
    project: 'history-ot-project',
    people: ['alice'],
    scripted: ['carol', 'bob'],
    transport: 'websocket',
    server: true,
    async run({ alice, carol, bob, review, settle, state }) {
      await alice.change({ from: 0, insert: suggestionBase })
      await settle()
      await review.join(carol, bob)
      await review.capture('alice types the base text', { who: 'alice' })
      await suggestOnHistoryOT(review, carol, state)
      await review.send(carol, 'carol (reviewer) accepts her own insert by clearing its tracking', ({ raw }) =>
        historyText(raw, trackedAt(raw, 'insert', 'whole '), { r: 6, tracking: untracked })
      )
      await review.send(carol, 'carol (reviewer) accepts her own delete with a raw delete', ({ raw }) =>
        historyText(raw, trackedAt(raw, 'delete', 'word '), -5)
      )
      await review.send(bob, 'bob accepts the insert "whole " by clearing its tracking', ({ raw }) =>
        historyText(raw, trackedAt(raw, 'insert', 'whole '), { r: 6, tracking: untracked })
      )
      await review.send(bob, 'bob accepts the delete "word " with a raw delete', ({ raw }) => historyText(raw, trackedAt(raw, 'delete', 'word '), -5))
      await review.send(bob, 'bob accepts the insert "NEW " and the delete "change " in one text operation', ({ raw }) => {
        const first = trackedAt(raw, 'insert', 'NEW ')
        return historyText(raw, first, { r: 4, tracking: untracked }, trackedAt(raw, 'delete', 'change ') - first - 4, -7)
      })
      await review.send(bob, 'bob accepts both line-3 suggestions in one text operation', ({ raw }) => {
        const first = trackedAt(raw, 'insert', 'X')
        return historyText(raw, first, { r: 1, tracking: untracked }, trackedAt(raw, 'delete', 'more ') - first - 1, -5)
      })
      await review.edit(alice, 'alice types at the end of line 1 after the accepts', text => ({
        from: at(text, 'please.', 'please.'.length),
        insert: ' Alice was here.',
      }))
    },
  },
  'sharejs-withdraw-own': {
    description:
      'Carol (reviewer) withdraws her own suggestions on a ShareJS doc: she deletes her own tracked insert and re-inserts her own tracked delete with u, each with meta.tc, plus the same ops without u or without meta.tc, a partial delete and a partial re-insert. Alice watches in the CE web editor.',
    project: 'sharejs-project',
    people: ['alice'],
    scripted: ['carol'],
    transport: 'websocket',
    server: true,
    async run({ alice, carol, review, settle }) {
      await alice.change({ from: 0, insert: suggestionBase })
      await settle()
      await review.join(carol)
      await review.capture('alice types the base text', { who: 'alice' })
      await review.send(carol, 'carol suggests inserting "MINE "', ({ text }) => trackedShareJs({ p: at(text, 'sentence'), i: 'MINE ' }))
      await review.send(carol, 'carol deletes her own insert "MINE " with meta.tc', server =>
        trackedShareJs({ p: changeOf(server, 'i', 'MINE ').op.p, d: 'MINE ' })
      )
      await review.send(carol, 'carol suggests deleting "word "', ({ text }) => trackedShareJs({ p: at(text, 'word '), d: 'word ' }))
      await review.send(carol, 'carol re-inserts her own deleted "word " with u and meta.tc', server =>
        trackedShareJs({ p: changeOf(server, 'd', 'word ').op.p, i: 'word ', u: true })
      )
      await review.send(carol, 'carol suggests deleting "change "', ({ text }) => trackedShareJs({ p: at(text, 'change '), d: 'change ' }))
      await review.send(carol, 'carol re-inserts "change " with meta.tc but without u', server =>
        trackedShareJs({ p: changeOf(server, 'd', 'change ').op.p, i: 'change ' })
      )
      await review.send(carol, 'carol re-inserts the still-deleted "change " with u but without meta.tc', server => ({
        op: [{ p: changeOf(server, 'd', 'change ').op.p, i: 'change ', u: true }],
      }))
      await review.send(carol, 'carol deletes her own tracked insert "change " without meta.tc', server => ({
        op: [{ p: changeOf(server, 'i', 'change ').op.p, d: 'change ' }],
      }))
      await review.send(carol, 'carol suggests inserting "PARTIAL "', ({ text }) => trackedShareJs({ p: at(text, 'Third'), i: 'PARTIAL ' }))
      await review.send(carol, 'carol deletes "TIA" from the middle of her own insert with meta.tc', server =>
        trackedShareJs({ p: changeOf(server, 'i', 'PARTIAL ').op.p + 'PAR'.length, d: 'TIA' })
      )
      await review.send(carol, 'carol suggests deleting "more words"', ({ text }) => trackedShareJs({ p: at(text, 'more words'), d: 'more words' }))
      await review.send(carol, 'carol re-inserts only "more " of her deleted "more words" with u and meta.tc', server =>
        trackedShareJs({ p: changeOf(server, 'd', 'more words').op.p, i: 'more ', u: true })
      )
    },
  },
  'history-ot-withdraw-own': {
    description:
      'What Carol (reviewer) can do to withdraw her own suggestions on a history-ot doc: remove her tracked insert, mark it deleted, clear or flip the tracking on her tracked delete, or insert the text again. Alice watches in the CE web editor.',
    project: 'history-ot-project',
    people: ['alice'],
    scripted: ['carol'],
    transport: 'websocket',
    server: true,
    async run({ alice, carol, review, settle, state }) {
      await alice.change({ from: 0, insert: suggestionBase })
      await settle()
      await review.join(carol)
      await review.capture('alice types the base text', { who: 'alice' })
      const by = type => tracking(state, 'carol', type)
      await review.send(carol, 'carol suggests inserting "MINE "', ({ raw }) =>
        historyText(raw, at(raw.content, 'sentence'), { i: 'MINE ', tracking: by('insert') })
      )
      await review.send(carol, 'carol suggests deleting "word "', ({ raw }) => historyText(raw, at(raw.content, 'word '), { r: 5, tracking: by('delete') }))
      await review.send(carol, 'carol removes her own insert "MINE " with a raw delete', ({ raw }) => historyText(raw, trackedAt(raw, 'insert', 'MINE '), -5))
      await review.send(carol, 'carol marks her own insert "MINE " as a tracked delete', ({ raw }) =>
        historyText(raw, trackedAt(raw, 'insert', 'MINE '), { r: 5, tracking: by('delete') })
      )
      await review.send(carol, 'carol clears the tracking on her own delete "word "', ({ raw }) =>
        historyText(raw, trackedAt(raw, 'delete', 'word '), { r: 5, tracking: untracked })
      )
      await review.send(carol, 'carol flips her own delete "word " to a tracked insert', ({ raw }) =>
        historyText(raw, trackedAt(raw, 'delete', 'word '), { r: 5, tracking: by('insert') })
      )
      await review.send(carol, 'carol suggests deleting "change "', ({ raw }) => historyText(raw, at(raw.content, 'change '), { r: 7, tracking: by('delete') }))
      await review.send(carol, 'carol inserts "change " again as a tracked insert just before her delete', ({ raw }) =>
        historyText(raw, trackedAt(raw, 'delete', 'change '), { i: 'change ', tracking: by('insert') })
      )
      await review.edit(alice, 'alice types at the end of line 1', text => ({ from: at(text, 'please.', 'please.'.length), insert: ' Alice was here.' }))
    },
  },
  'sharejs-cut-paste-comment': {
    description:
      'Comments through cut, paste and undo on a ShareJS doc. Bob cuts commented text and pastes it elsewhere in the CE web editor, then deletes a commented word and undoes; scripted clients re-send {p, c, t} with an existing thread id to move a comment.',
    project: 'sharejs-project',
    people: ['bob'],
    scripted: ['alice', 'dave'],
    transport: 'websocket',
    server: true,
    async run({ bob, alice, dave, review, settle }) {
      await bob.change({ from: 0, insert: pasteBase })
      await settle()
      await review.join(alice, dave)
      await review.capture('bob types the base text', { who: 'bob' })
      const phrase = objectId()
      const second = objectId()
      await review.send(alice, 'alice comments on "commented phrase"', shareJsAnchor('commented phrase', phrase))
      await review.send(alice, 'alice comments on "Second paragraph"', shareJsAnchor('Second paragraph', second))
      await review.send(alice, 'alice comments on "word"', shareJsAnchor('word', objectId()))
      const cut = 'a commented phrase '
      await review.edit(bob, 'bob cuts "a commented phrase " in the web editor', text => ({ from: at(text, cut), to: at(text, cut, cut.length) }), 'delete.cut')
      await review.edit(bob, 'bob pastes the same text into line 2', text => ({ from: at(text, 'goes.'), insert: cut }), 'input.paste')
      await review.send(dave, 'dave (viewer) re-sends the "Second paragraph" thread on "Third paragraph"', shareJsAnchor('Third paragraph', second))
      await review.send(dave, 'dave (viewer) re-sends the pasted comment on its new text', shareJsAnchor('commented phrase', phrase))
      await review.edit(bob, 'bob deletes "word " in the web editor', text => ({ from: at(text, 'word '), to: at(text, 'word ', 'word '.length) }), 'delete')
      await review.undo(bob, 'bob undoes the delete in the web editor')
    },
  },
  'sharejs-comment-mismatch': {
    description:
      'Dave (viewer) sends ShareJS comment anchors that do not fit the doc: one whose c is not the text at p and one that runs past the end, the failure a client gets when it builds an anchor against the wrong version. Bob has the doc open in the CE web editor and types after the errors.',
    project: 'sharejs-project',
    people: ['bob'],
    scripted: ['dave'],
    transport: 'websocket',
    server: true,
    settle: { open: false },
    async run({ bob, dave, review, settle }) {
      await bob.change({ from: 0, insert: commentBase })
      await settle()
      await review.join(dave)
      await review.capture('bob types the base text', { who: 'bob' })
      await review.send(dave, 'dave sends an anchor whose c is not the text at p', ({ text }) => ({
        op: [{ p: at(text, 'quick'), c: 'slow', t: objectId() }],
      }))
      await review.send(dave, 'dave sends an anchor that runs past the end of the doc', ({ text }) => ({
        op: [{ p: text.length - 2, c: 'beyond the end', t: objectId() }],
      }))
      await bob.page.waitForSelector('.cm-content', { timeout: 120000 })
      await review.edit(bob, 'bob types after the errors', () => ({ from: 0, insert: 'Still here. ' }))
    },
  },
  'history-ot-comment-out-of-range': {
    description:
      'Dave (viewer) sends history-ot AddComment ops that do not fit the doc: a range past the end, an empty range and an id that is not an ObjectId. Bob has the doc open in the CE web editor and types after them.',
    project: 'history-ot-project',
    people: ['bob'],
    scripted: ['dave'],
    transport: 'websocket',
    server: true,
    settle: { open: false },
    async run({ bob, dave, review, settle }) {
      await bob.change({ from: 0, insert: commentBase })
      await settle()
      await review.join(dave)
      await review.capture('bob types the base text', { who: 'bob' })
      await review.send(dave, 'dave adds a comment whose range runs past the end of the doc', ({ raw }) => ({
        op: [{ commentId: objectId(), ranges: [{ pos: raw.content.length - 2, length: 10 }] }],
      }))
      await review.send(dave, 'dave adds a comment with an empty range', ({ raw }) => ({
        op: [{ commentId: objectId(), ranges: [{ pos: at(raw.content, 'quick'), length: 0 }] }],
      }))
      await review.send(dave, 'dave adds a comment whose id is not an ObjectId', ({ raw }) => ({
        op: [{ commentId: 'not-an-object-id', ranges: [historyRange(raw, 'quick')] }],
      }))
      await bob.page.waitForSelector('.cm-content', { timeout: 120000 })
      await review.edit(bob, 'bob types after the bad comments', () => ({ from: 0, insert: 'Still here. ' }))
    },
  },
  'history-ot-cut-paste-comment': {
    description:
      'Comments through cut, paste and undo on a history-ot doc. Bob types inside a comment, cuts the commented text and pastes it in the CE web editor, then deletes a commented word and undoes; a scripted Alice inserts inside comments with and without commentIds, re-adds a comment by id in the same update as an insert, and re-adds a resolved comment without resolved.',
    project: 'history-ot-project',
    people: ['bob'],
    scripted: ['alice'],
    transport: 'websocket',
    server: true,
    async run({ bob, alice, review, settle }) {
      await bob.change({ from: 0, insert: pasteBase })
      await settle()
      await review.join(alice)
      await review.capture('bob types the base text', { who: 'bob' })
      const phrase = objectId()
      const third = objectId()
      await review.send(alice, 'alice comments on "commented phrase"', historyComment(phrase, ['commented phrase']))
      await review.send(alice, 'alice comments on "Second paragraph"', historyComment(objectId(), ['Second paragraph']))
      await review.send(alice, 'alice comments on "Third paragraph"', historyComment(third, ['Third paragraph']))
      await review.send(alice, 'alice comments on "word"', historyComment(objectId(), ['word']))
      await review.edit(bob, 'bob types strictly inside "commented phrase"', text => ({
        from: at(text, 'commented', 'commented'.length),
        insert: ' long',
      }))
      const cut = 'a commented long phrase '
      await review.edit(bob, 'bob cuts the commented text in the web editor', text => ({ from: at(text, cut), to: at(text, cut, cut.length) }), 'delete.cut')
      await review.edit(bob, 'bob pastes the same text into line 2', text => ({ from: at(text, 'goes.'), insert: cut }), 'input.paste')
      await review.send(alice, 'alice inserts strictly inside "Second paragraph" without commentIds', ({ raw }) =>
        historyText(raw, at(raw.content, 'Second', 'Second'.length), ' new')
      )
      await review.send(alice, 'alice inserts strictly inside "Third paragraph" with commentIds', ({ raw }) =>
        historyText(raw, at(raw.content, 'Third', 'Third'.length), { i: ' next', commentIds: [third] })
      )
      await review.send(alice, 'alice appends a line and re-adds the "Third paragraph" comment on it in the same update', ({ raw }) => {
        const line = 'Moved comment text.\n'
        const end = raw.content.length
        return {
          op: [textOperation(end, end, line), { commentId: third, ranges: [{ pos: end, length: line.length - 1 }] }],
        }
      })
      await review.send(alice, 'alice resolves the pasted comment', () => ({ op: [{ commentId: phrase, resolved: true }] }))
      await review.send(alice, 'alice re-adds the resolved comment with its ranges and no resolved field', ({ raw }) => ({
        op: [{ commentId: phrase, ranges: raw.comments.find(comment => comment.id === phrase).ranges }],
      }))
      await review.edit(bob, 'bob deletes "word " in the web editor', text => ({ from: at(text, 'word '), to: at(text, 'word ', 'word '.length) }), 'delete')
      await review.undo(bob, 'bob undoes the delete in the web editor')
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
  const site = state.site
  const secrets = new Set(
    Object.entries(env)
      .filter(([key]) => /PASSWORD|SECRET/.test(key))
      .map(([, value]) => value)
  )
  const context = { site, state, env, secrets }
  const project = scenario.prepare ? await scenario.prepare(context) : state.projects[scenario.project]
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
      await client.connect(site, state.users[key].email, env[`${key.toUpperCase()}_PASSWORD`], project.id, secrets, {
        websocket: scenario.transport === 'websocket',
      })
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
    const review = reviewKit({ people, doc, format: project.format, settle: step, extra })
    await scenario.run({ ...byName, people, notes, doc, state, extra, settle: step, review, context })
    await releaseAll(people)
    const final = await step(scenario.settle)
    const serverText = scenario.server ? (await documentUpdater(project.id, doc.id)).text : null
    const agreed =
      final.converged && review.matched && (serverText === null || (final.texts ?? []).every(text => text === serverText))
    if (!agreed && serverText !== null) {
      notes.push(
        `a web editor ended with text that differs from the server; ${final.texts ? 'final.server.txt' : 'the last entry in steps.json'} holds the server text`
      )
    }
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
        console: person.console.length ? `${person.name}.console.jsonl` : null,
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
      converged: diverged === 0 && agreed,
      finalText:
        final.texts === null
          ? null
          : Object.fromEntries(
              people.map(person => [person.name, agreed ? 'final.txt' : `final.${person.name}.txt`])
            ),
      notes,
    }
    const outputs = new Map()
    outputs.set('scenario.json', `${JSON.stringify(summary, null, 2)}\n`)
    const lines = list => list.map(item => JSON.stringify(item)).join('\n') + '\n'
    for (const person of people) {
      outputs.set(`${person.name}.frames.jsonl`, lines(person.frames))
      if (person.console.length) outputs.set(`${person.name}.console.jsonl`, lines(person.console))
    }
    for (const client of scripted) {
      await client.close()
      outputs.set(`${client.name}.frames.jsonl`, lines(client.frames))
    }
    for (const [file, content] of extra) outputs.set(file, content)
    if (final.texts !== null) {
      if (agreed) outputs.set('final.txt', final.texts[0])
      else people.forEach((person, index) => outputs.set(`final.${person.name}.txt`, final.texts[index]))
      if (!agreed && serverText !== null) outputs.set('final.server.txt', serverText)
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
    await project.cleanup?.()
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

function dockerExec(command, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      ['compose', '--env-file', '.env.local', '-f', 'compose.yml', 'exec', '-T', 'overleaf', 'bash', '-c', command],
      { cwd: here, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve(stdout))
    )
    child.stdin.end(input ?? '')
  })
}

function webNode(script) {
  return dockerExec('source /etc/container_environment.sh && cd /overleaf/services/web && node --input-type=module -', script)
}

async function addMember(projectId, ownerId, userId, level) {
  const output = await webNode(`
    const { default: CollaboratorsHandler } = await import('/overleaf/services/web/app/src/Features/Collaborators/CollaboratorsHandler.mjs')
    await CollaboratorsHandler.promises.addUserIdToProject(${JSON.stringify(projectId)}, ${JSON.stringify(ownerId)}, ${JSON.stringify(userId)}, ${JSON.stringify(level)})
    console.log('OLEAFLY_ADDED')
    process.exit(0)
  `)
  if (!output.includes('OLEAFLY_ADDED')) throw new Error(`could not add ${userId} to ${projectId}: ${output}`)
}

async function toHistoryOT(projectId) {
  const output = await webNode(`
    const { advanceOTMigrationStage } = await import('/overleaf/services/web/app/src/Features/History/HistoryOTMigration.mjs')
    const { otMigrationStage } = await advanceOTMigrationStage(${JSON.stringify(projectId)}, 1)
    console.log('OLEAFLY_STAGE ' + otMigrationStage)
    process.exit(0)
  `)
  const stage = output.match(/OLEAFLY_STAGE (\d+)/)?.[1]
  if (stage !== '1') throw new Error(`project ${projectId} did not reach history-ot stage 1: ${output}`)
}

function visibleContent(raw) {
  const deletes = (raw.trackedChanges ?? [])
    .filter(change => change.tracking.type === 'delete')
    .map(change => change.range)
    .sort((a, b) => a.pos - b.pos)
  let visible = ''
  let at = 0
  for (const range of deletes) {
    visible += raw.content.slice(at, range.pos)
    at = range.pos + range.length
  }
  return visible + raw.content.slice(at)
}

async function documentUpdater(projectId, docId) {
  const route = `http://127.0.0.1:3003/project/${projectId}/doc/${docId}`
  const [own, converted] = (await dockerExec(`curl -fsS '${route}?historyOTSupport=true'; echo; curl -fsS '${route}'`))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
  if (Array.isArray(own.lines)) {
    return { type: own.type, version: own.version, text: own.lines.join('\n'), ranges: own.ranges ?? {} }
  }
  return { type: own.type, version: own.version, text: visibleContent(own.lines), raw: own.lines, ranges: converted.ranges ?? {} }
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

function reviewMeta(html) {
  const meta = {}
  for (const [, name, attributes] of html.matchAll(/<meta name="(ol-[^"]+)"([^>]*)>/g)) {
    if (forbidden.test(name) || !/track|review|comment|thread|chat|feature|capabilit|permission|token|ShareJsHash/i.test(name)) continue
    const type = attributes.match(/data-type="([^"]*)"/)?.[1] ?? null
    const content = attributes.match(/content="([^"]*)"/)?.[1]
    const present = /\scontent(=|\s|$)/.test(attributes)
    const text = (content ?? '').replaceAll('&quot;', '"').replaceAll('&amp;', '&')
    meta[name] = { type, contentAttribute: present, value: type === 'boolean' ? present : type === 'json' && text ? JSON.parse(text) : text }
  }
  return meta
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
  'review-routes-absent': {
    description:
      'Every review route Overleaf web calls (threads, messages, edit, delete own and any message, resolve, reopen and delete thread, accept changes, track changes, ranges, change authors), asked of CE on both projects as the owner, a reviewer and a viewer, plus the page meta and join fields a client reads to tell whether the review module is there.',
    async run(ctx, notes) {
      const steps = []
      const jars = {}
      for (const who of ['alice', 'carol', 'dave']) jars[who] = await ctx.signInAs(who)
      for (const key of ['sharejs-project', 'history-ot-project']) {
        const project = ctx.state.projects[key]
        const base = `/project/${project.id}`
        const thread = objectId()
        const message = objectId()
        const docId = project.rootDocId
        const short = route => route.replace(base, '').replace(thread, ':thread').replace(message, ':id').replace(docId, ':doc')
        const tokens = {}
        for (const who of Object.keys(jars)) {
          const page = await fetch(`${ctx.site}${base}`, { headers: { cookie: jars[who].header() } })
          jars[who].absorb(page)
          const html = await page.text()
          tokens[who] = html.match(/name="ol-csrfToken" content="([^"]+)"/)?.[1]
          ctx.secrets.add(tokens[who])
          const meta = reviewMeta(html)
          steps.push({ page: { project: key, user: who, route: base, status: page.status, meta } })
          notes.push(`${key} page meta for ${who}: ${JSON.stringify(meta)}`)
        }
        const routes = [
          ['GET', `${base}/threads`],
          ['POST', `${base}/thread/${thread}/messages`, { content: 'A probe comment.' }],
          ['POST', `${base}/thread/${thread}/messages/${message}/edit`, { content: 'An edited probe comment.' }],
          ['DELETE', `${base}/thread/${thread}/own-messages/${message}`],
          ['DELETE', `${base}/thread/${thread}/messages/${message}`],
          ['POST', `${base}/doc/${docId}/thread/${thread}/resolve`, {}],
          ['POST', `${base}/doc/${docId}/thread/${thread}/reopen`, {}],
          ['DELETE', `${base}/doc/${docId}/thread/${thread}`],
          ['POST', `${base}/doc/${docId}/changes/accept`, { change_ids: [message] }],
          ['POST', `${base}/track_changes`, { on_for: { [ctx.state.users.carol.id]: true } }],
          ['POST', `${base}/track_changes`, { on_for_guests: true }],
          ['POST', `${base}/track_changes`, { on: true }],
          ['GET', `${base}/ranges`],
          ['GET', `${base}/changes/users`],
          ['GET', `${base}/messages?limit=1`],
        ]
        const answered = []
        for (const [method, route, body] of routes) {
          const step = await httpStep(ctx.site, jars.alice, method, route, { body, token: tokens.alice, secrets: ctx.secrets })
          step.request.user = 'alice'
          steps.push(step)
          answered.push(`${method} ${short(route)} ${step.status}`)
        }
        notes.push(`${key} as alice: ${answered.join(', ')}`)
        for (const who of ['carol', 'dave']) {
          for (const [method, route, body] of [routes[0], routes[1], routes[5]]) {
            const step = await httpStep(ctx.site, jars[who], method, route, { body, token: tokens[who], secrets: ctx.secrets })
            step.request.user = who
            steps.push(step)
            notes.push(`${key} as ${who}: ${method} ${short(route)} ${step.status}`)
          }
        }
        const unsigned = await httpStep(ctx.site, jars.alice, 'POST', `${base}/thread/${thread}/messages`, {
          body: { content: 'A probe comment.' },
          secrets: ctx.secrets,
        })
        unsigned.request.user = 'alice'
        unsigned.request.withoutToken = true
        steps.push(unsigned)
        notes.push(`${key}: the same POST without the anti-forgery header answered ${unsigned.status}`)
        for (const who of ['alice', 'carol', 'dave']) {
          const client = new ScriptedClient(who, ctx.clock)
          await client.open(ctx.site, jars[who], project.id, ctx.secrets, { websocket: true })
          await client.outcome()
          const join = client.events.find(event => event.name === 'joinProjectResponse')?.args?.[0]
          notes.push(
            `${key} join for ${who}: permissionsLevel ${join?.permissionsLevel}, features.trackChanges ${JSON.stringify(join?.project?.features?.trackChanges)}, trackChangesState ${JSON.stringify(join?.project?.trackChangesState)}, isRestrictedUser ${JSON.stringify(join?.isRestrictedUser)}`
          )
          await client.close()
          if (who === 'alice') steps.push({ socket: { user: who, project: key, projectId: project.id, transport: 'websocket', frames: client.frames } })
        }
      }
      return steps
    },
  },
  'restricted-join-comments': {
    description:
      'Alice makes a throwaway ShareJS project and a throwaway history-ot project, comments on each doc and turns on link sharing; Erin opens each read-only link and joins the doc. Records what a restricted (token read-only) user gets of comments in joinDoc and in later ops, and whether her own comment ops are accepted. Both projects are deleted at the end.',
    async run(ctx, notes) {
      const steps = []
      const alice = await ctx.signInAs('alice')
      const erin = await ctx.signInAs('erin')
      const token = await csrfFor(ctx.site, alice, ctx.state.projects['sharejs-project'].id)
      for (const format of ['sharejs-text-ot', 'history-ot']) {
        const created = await httpStep(ctx.site, alice, 'POST', '/project/new', {
          token,
          secrets: ctx.secrets,
          body: { projectName: `restricted-comments-${format}-${stamp()}`, template: 'none' },
        })
        const projectId = created.body.project_id
        try {
          if (format === 'history-ot') await toHistoryOT(projectId)
          const share = await httpStep(ctx.site, alice, 'POST', `/project/${projectId}/settings/admin`, {
            token,
            secrets: ctx.secrets,
            body: { publicAccessLevel: 'tokenBased' },
          })
          const links = await httpStep(ctx.site, alice, 'GET', `/project/${projectId}/tokens`, { secrets: ctx.secrets })
          const readOnly = links.body?.readOnly
          if (!readOnly) throw new Error(`no read-only link for ${format}: ${JSON.stringify(links)}`)
          ctx.secrets.add(readOnly)
          const owner = new ScriptedClient('alice', ctx.clock)
          await owner.open(ctx.site, alice, projectId, ctx.secrets, { websocket: true })
          await owner.outcome()
          const docId = owner.events.find(event => event.name === 'joinProjectResponse').args[0].project.rootDoc_id
          const joined = await owner.joinDoc(docId)
          if (joined[5] !== format) throw new Error(`the throwaway project serves ${joined[5]}, expected ${format}`)
          let version = joined[2]
          const text = 'Restricted users and comments.\n'
          const first = objectId()
          const later = objectId()
          const history = format === 'history-ot'
          const length = history ? joined[1].content.length : joined[1].join('\n').length
          const insert = history ? [{ textOperation: [text, ...(length ? [length] : [])] }] : [{ p: 0, i: text }]
          const comment = (id, needle) =>
            history
              ? [{ commentId: id, ranges: [{ pos: text.indexOf(needle), length: needle.length }] }]
              : [{ p: text.indexOf(needle), c: needle, t: id }]
          await owner.update(docId, { doc: docId, op: insert, v: version++ })
          await owner.update(docId, { doc: docId, op: comment(first, 'Restricted users'), v: version++ })
          const landing = await fetch(`${ctx.site}/read/${readOnly}`, { headers: { cookie: erin.header() } })
          erin.absorb(landing)
          const erinToken = (await landing.text()).match(/name="ol-csrfToken" content="([^"]+)"/)?.[1]
          const grant = await httpStep(ctx.site, erin, 'POST', `/read/${readOnly}/grant`, {
            token: erinToken,
            secrets: ctx.secrets,
            body: { confirmedByUser: true },
          })
          const editor = await fetch(`${ctx.site}/project/${projectId}`, { headers: { cookie: erin.header() } })
          erin.absorb(editor)
          const html = await editor.text()
          ctx.secrets.add(html.match(/name="ol-csrfToken" content="([^"]+)"/)?.[1])
          const meta = reviewMeta(html)
          notes.push(`${format}: erin's editor page meta ${JSON.stringify(meta)}`)
          const visitor = new ScriptedClient('erin', ctx.clock)
          await visitor.open(ctx.site, erin, projectId, ctx.secrets, { websocket: true })
          await visitor.outcome()
          const join = visitor.events.find(event => event.name === 'joinProjectResponse')?.args?.[0]
          const reply = await visitor.joinDoc(docId)
          const ownerReply = await owner.joinDoc(docId)
          const shown = reply => (history ? reply[1]?.comments ?? null : reply[4]?.comments ?? null)
          notes.push(
            `${format}: erin joins with permissionsLevel ${join?.permissionsLevel}; her joinDoc comments ${JSON.stringify(shown(reply))}; alice's ${JSON.stringify(shown(ownerReply))}`
          )
          const seen = visitor.events.length
          await owner.update(docId, { doc: docId, op: comment(later, 'comments'), v: version++ })
          await sleep(1500)
          const relayed = visitor.events.slice(seen).filter(event => event.name === 'otUpdateApplied')
          notes.push(`${format}: when alice adds a comment, erin receives ${JSON.stringify(relayed.map(event => event.args[0].op ?? null))}`)
          const attempt = await visitor.attempt(docId, { doc: docId, op: comment(objectId(), 'users'), v: version })
          notes.push(`${format}: erin's own comment op: ${JSON.stringify(attempt)}`)
          if (attempt.outcome === 'applied') version += 1
          const server = await documentUpdater(projectId, docId)
          notes.push(`${format}: the server keeps ${JSON.stringify(history ? server.raw.comments : server.ranges.comments)}`)
          await visitor.close()
          await owner.close()
          steps.push(created, share, grant, { page: { user: 'erin', format, status: editor.status, meta } })
          steps.push({ socket: { user: 'alice', format, projectId, docId, transport: 'websocket', frames: owner.frames } })
          steps.push({ socket: { user: 'erin', format, projectId, docId, transport: 'websocket', frames: visitor.frames } })
          steps.push({ server: { format, docId, version: server.version, ...(server.raw ? { raw: server.raw } : {}), ranges: server.ranges } })
        } finally {
          await httpStep(ctx.site, alice, 'DELETE', `/project/${projectId}`, { token, secrets: ctx.secrets })
        }
      }
      return steps
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

const features = featureProbes({ ScriptedClient, Participant, csrfFor, webNode, addMember, stamp, sleep, until, objectId, here })
Object.assign(probes, features.probes)
Object.assign(scenarios, features.scenarios)

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
    env,
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
    return { format: 'history-ot', text: visibleContent(raw), content: raw.content, tracked }
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

function webHealth(person, from = 0) {
  const incoming = person.frames.slice(from).filter(frame => frame.dir === 'in').map(frame => frame.frame)
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
  const server = snapshotOf(await checker.joinDoc(docId))
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
  Object.assign(scenarios, reviewSafe({ GateClient, signIn, webNode, addMember, toHistoryOT, httpStep, csrfFor, stamp, sleep, at }))
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
