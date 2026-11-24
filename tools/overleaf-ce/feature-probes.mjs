import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { chromium } from '@playwright/test'

const shownHeaders = new Set([
  'content-type',
  'content-length',
  'content-disposition',
  'transfer-encoding',
  'location',
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
])

function parsed(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text.length > 400 ? `${text.slice(0, 400)}…` : text
  }
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function zipOf(files) {
  const parts = []
  const central = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const data = Buffer.from(file.data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, data)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x21, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)
    offset += local.length + name.length + data.length
  }
  const size = central.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, ...central, end])
}

export function zipEntries(bytes) {
  let end = -1
  for (let at = bytes.length - 22; at >= 0; at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) return null
  const count = bytes.readUInt16LE(end + 10)
  let at = bytes.readUInt32LE(end + 16)
  const entries = []
  for (let n = 0; n < count; n++) {
    const nameLength = bytes.readUInt16LE(at + 28)
    const skip = nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32)
    entries.push({ name: bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8'), size: bytes.readUInt32LE(at + 24) })
    at += 46 + skip
  }
  return entries
}

function hslToRgb(hue, saturation, lightness) {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - chroma / 2
  const [r, g, b] =
    hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x]
  return `rgb(${Math.round((r + m) * 255)}, ${Math.round((g + m) * 255)}, ${Math.round((b + m) * 255)})`
}

function hueDrawnAs(rgb) {
  return Array.from({ length: 360 }, (_, hue) => hue).find(hue => hslToRgb(hue, 70, 50) === rgb) ?? null
}

function metaOf(html, wanted) {
  const meta = {}
  for (const [, name, attributes] of html.matchAll(/<meta name="(ol-[^"]+)"([^>]*)>/g)) {
    if (!wanted.test(name) || /csrf/i.test(name)) continue
    const type = attributes.match(/data-type="([^"]*)"/)?.[1] ?? null
    const content = attributes.match(/content="([^"]*)"/)?.[1]
    const present = /\scontent(=|\s|$)/.test(attributes)
    const text = (content ?? '')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&')
    let value = text
    if (type === 'boolean') value = present
    else if (type === 'json' && text) value = JSON.parse(text)
    else if (type === 'number' && text) value = Number(text)
    meta[name] = { type, contentAttribute: present, value }
  }
  return meta
}

function framesWith(person, name, marker = '', after = -1) {
  return person.frames.filter(
    frame => frame.dir === 'in' && frame.t > after && frame.frame.includes(`"name":"${name}"`) && frame.frame.includes(marker)
  )
}

function eventArgs(frame) {
  return JSON.parse(frame.frame.slice(frame.frame.indexOf('{'))).args
}

export function featureProbes(kit) {
  const { ScriptedClient, Participant, csrfFor, webNode, addMember, stamp, sleep, until, objectId, here } = kit

  async function rest(ctx, jar, method, route, { body, form, token, headers = {}, user, record = true } = {}) {
    if (token) ctx.secrets.add(token)
    const sentAt = Date.now() - ctx.clock.start
    const response = await fetch(`${ctx.site}${route}`, {
      method,
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        cookie: jar?.header() ?? '',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'x-csrf-token': token } : {}),
        ...headers,
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })
    if (jar) {
      jar.absorb(response)
      for (const value of jar.values()) ctx.secrets.add(value)
    }
    const text = await response.text()
    const answeredAt = Date.now() - ctx.clock.start
    const kept = Object.fromEntries([...response.headers].filter(([name]) => shownHeaders.has(name)))
    const request = { method, route, ...(user ? { user } : {}), ...(record && body !== undefined ? { body } : {}) }
    return { request, status: response.status, headers: kept, body: parsed(text), sentAt, answeredAt }
  }

  async function page(ctx, jar, route) {
    const response = await fetch(`${ctx.site}${route}`, { headers: { cookie: jar.header() }, redirect: 'manual' })
    jar.absorb(response)
    for (const value of jar.values()) ctx.secrets.add(value)
    const html = await response.text()
    const token = html.match(/name="ol-csrfToken" content="([^"]+)"/)?.[1]
    if (token) ctx.secrets.add(token)
    return { status: response.status, location: response.headers.get('location'), html, token }
  }

  async function throwaway(ctx, jar, token, prefix, template = 'none') {
    const created = await rest(ctx, jar, 'POST', '/project/new', { token, body: { projectName: `${prefix}-${stamp()}`, template } })
    if (created.status !== 200) throw new Error(`could not create a throwaway project: ${JSON.stringify(created)}`)
    return { created, projectId: created.body.project_id }
  }

  async function mongo(script) {
    const output = await webNode(`
      const { db, ObjectId } = await import('/overleaf/services/web/app/src/infrastructure/mongodb.mjs')
      const result = await (async () => { ${script} })()
      console.log('OLEAFLY_RESULT ' + JSON.stringify(result))
      process.exit(0)
    `)
    const line = output.split('\n').find(text => text.startsWith('OLEAFLY_RESULT '))
    if (!line) throw new Error(`the mongo script printed no result: ${output}`)
    return JSON.parse(line.slice('OLEAFLY_RESULT '.length))
  }

  async function socket(ctx, who, jar, projectId) {
    const client = new ScriptedClient(who, ctx.clock)
    await client.open(ctx.site, jar, projectId, ctx.secrets, { websocket: true })
    await client.outcome()
    return client
  }

  const joinOf = client => [...client.events].reverse().find(event => event.name === 'joinProjectResponse')?.args?.[0]

  function namedEvents(client, from, names) {
    return client.frames
      .filter(frame => frame.dir === 'in' && frame.t >= from && frame.frame.startsWith('5:'))
      .map(frame => ({ t: frame.t, ...JSON.parse(frame.frame.slice(frame.frame.indexOf('{'))) }))
      .filter(event => (names ? names.includes(event.name) : !noise.includes(event.name)))
      .map(event => ({ t: event.t, name: event.name, args: event.args }))
  }

  const noise = ['joinProjectResponse', 'clientTracking.clientUpdated', 'clientTracking.clientDisconnected', 'serverPing']


  const otherEvents = client =>
    client.frames
      .filter(frame => frame.dir === 'in' && frame.frame.startsWith('5:'))
      .map(frame => JSON.parse(frame.frame.slice(frame.frame.indexOf('{'))).name)
      .filter(name => !noise.includes(name))

  async function watchStep(ctx, watchers, label, act, { names = null, quiet = 1500, wait = 15000, expect = 0 } = {}) {
    const from = Date.now() - ctx.clock.start
    const result = await act()
    if (expect) {
      await until(`${label}: ${expect} events`, () => watchers.every(watcher => namedEvents(watcher, from, names).length >= expect), wait).catch(() => {})
    }
    await sleep(quiet)
    const seen = Object.fromEntries(watchers.map(watcher => [watcher.name, namedEvents(watcher, from, names)]))
    return { label, ...(Array.isArray(result) ? { requests: result } : result), events: seen }
  }

  async function pageCall(person, method, route, body = null) {
    const sentAt = Date.now() - person.clock.start
    const reply = await person.page.evaluate(
      async ([target, verb, payload]) => {
        const token = document.querySelector('meta[name="ol-csrfToken"]').content
        const response = await fetch(target, {
          method: verb,
          headers: {
            accept: 'application/json',
            'x-csrf-token': token,
            ...(payload === null ? {} : { 'content-type': 'application/json' }),
          },
          body: payload === null ? undefined : JSON.stringify(payload),
        })
        return { status: response.status, text: await response.text(), at: Date.now() }
      },
      [route, method, body]
    )
    return {
      request: { method, route, user: person.name, ...(body === null ? {} : { body }) },
      status: reply.status,
      body: parsed(reply.text),
      sentAt,
      answeredAt: reply.at - person.clock.start,
    }
  }

  function arrivals(listeners, name, marker, after) {
    return Object.fromEntries(
      listeners.map(listener => {
        const frame = framesWith(listener, name, marker, after)[0]
        return [listener.name, frame ? { t: frame.t, args: eventArgs(frame) } : null]
      })
    )
  }

  const scenarios = {
    'project-chat': {
      description:
        'Global project chat on CE while Alice and Bob have the editor open and Dave (a viewer) listens on a scripted websocket: send with and without client_id, a viewer sending, paging with limit and before, editing your own message, editing and deleting somebody else\'s (refused, even for the owner), bad content, and each author deleting their own messages at the end so the project chat is empty again. chat.json holds every REST step with sentAt/answeredAt on the same clock as the frames.',
      project: 'sharejs-project',
      people: ['alice', 'bob'],
      scripted: ['dave'],
      transport: 'websocket',
      async run({ alice, bob, dave, notes, state, extra }) {
        const projectId = state.projects['sharejs-project'].id
        const clock = alice.clock
        const ctx = { site: state.site, secrets: dave.secrets, clock }
        const daveToken = await csrfFor(state.site, dave.jar, projectId)
        ctx.secrets.add(daveToken)
        const daveCall = (method, route, body) => rest(ctx, dave.jar, method, route, { body, token: daveToken, user: 'dave' })
        const route = `/project/${projectId}/messages`
        const listeners = [alice, bob, dave]
        const steps = []
        const keep = (label, step, extraFields = {}) => {
          steps.push({ label, ...step, ...extraFields })
          return step
        }
        const capabilities = await alice.page.evaluate(() => document.querySelector('meta[name="ol-capabilities"]')?.content ?? null)
        notes.push(`ol-capabilities for alice: ${capabilities}`)
        const before = keep('messages before the scenario', await pageCall(alice, 'GET', `${route}?limit=50`))
        if (Array.isArray(before.body) && before.body.length) notes.push(`the project chat already held ${before.body.length} messages`)
        const clientId = crypto.randomUUID()
        const send = async (person, label, content, withClient = true) => {
          const body = withClient ? { content, client_id: person === dave ? `dave-${clientId}` : `${person.name}-${clientId}` } : { content }
          const step = person === dave ? await daveCall('POST', route, body) : await pageCall(person, 'POST', route, body)
          await until(`${label} to reach everyone`, () => listeners.every(listener => framesWith(listener, 'new-chat-message', content.slice(0, 20), step.sentAt - 1).length), 15000).catch(() => {})
          await sleep(300)
          const seen = arrivals(listeners, 'new-chat-message', content.slice(0, 20), step.sentAt - 1)
          keep(label, step, { events: seen })
          const times = Object.entries(seen).map(([name, event]) => `${name} ${event ? event.t - step.answeredAt : 'none'}`)
          notes.push(`${label}: ${step.status}; event minus 204 (ms): ${times.join(', ')}`)
          return Object.values(seen).find(Boolean)?.args?.[0]
        }
        const fromBob = await send(bob, 'bob sends with client_id', 'Hello from Bob, with $x^2$ and a link https://example.test/page.')
        const fromAlice = await send(alice, 'alice sends without client_id', 'Alice answers without a client id.', false)
        const fromDave = await send(dave, 'dave (viewer) sends', 'Dave the viewer can chat too.')
        notes.push(`new-chat-message keys: ${Object.keys(fromBob ?? {}).join(',')}; user keys ${Object.keys(fromBob?.user ?? {}).join(',')}; without client_id the keys are ${Object.keys(fromAlice ?? {}).join(',')}`)
        const paged = []
        for (let n = 1; n <= 4; n++) paged.push(await send(alice, `alice sends page message ${n}`, `Paging message ${n} from Alice.`))
        const firstPage = keep('page 1: limit=3', await pageCall(alice, 'GET', `${route}?limit=3`))
        const oldest = list => Math.min(...list.map(message => message.timestamp))
        const secondPage = keep(
          'page 2: limit=3, before = the oldest timestamp of page 1',
          await pageCall(alice, 'GET', `${route}?limit=3&before=${oldest(firstPage.body)}`)
        )
        const thirdPage = keep(
          'page 3: limit=3, before = the oldest timestamp of page 2',
          await pageCall(alice, 'GET', `${route}?limit=3&before=${oldest(secondPage.body)}`)
        )
        keep('page 4: before = the oldest of page 3', await pageCall(alice, 'GET', `${route}?limit=3&before=${oldest(thirdPage.body)}`))
        const all = keep('no limit (default 50)', await pageCall(alice, 'GET', route))
        keep('before = a timestamp equal to the newest message (strictly older only)', await pageCall(alice, 'GET', `${route}?before=${Math.max(...all.body.map(message => message.timestamp))}`))
        keep('limit=0', await pageCall(alice, 'GET', `${route}?limit=0`))
        keep('limit=abc', await pageCall(alice, 'GET', `${route}?limit=abc`))
        notes.push(`pages: ${[firstPage, secondPage, thirdPage].map(page => page.body.map(message => message.content.slice(0, 18)).join(' | ')).join(' // ')}`)
        notes.push(`newest first: ${all.body.every((message, index, list) => index === 0 || list[index - 1].timestamp >= message.timestamp)}`)
        const editRoute = id => `${route}/${id}/edit`
        const edit = async (person, label, id, content) => {
          const step = person === dave ? await daveCall('POST', editRoute(id), { content }) : await pageCall(person, 'POST', editRoute(id), { content })
          await sleep(1500)
          const seen = arrivals(listeners, 'edit-global-message', id, step.sentAt - 1)
          keep(label, step, { events: seen })
          notes.push(`${label}: ${step.status}; events ${JSON.stringify(Object.fromEntries(Object.entries(seen).map(([name, event]) => [name, event?.args ?? null])))}`)
        }
        await edit(alice, 'alice edits her own message', fromAlice.id, 'Alice answers, edited.')
        await edit(bob, "bob edits alice's message", fromAlice.id, 'Bob rewrites Alice.')
        await edit(alice, "alice (owner) edits bob's message", fromBob.id, 'Alice rewrites Bob.')
        await edit(dave, 'dave (viewer) edits his own message', fromDave.id, 'Dave the viewer edited this.')
        await edit(alice, 'alice edits with empty content', fromAlice.id, '')
        const afterEdit = keep('messages after the edits', await pageCall(alice, 'GET', `${route}?limit=20`))
        notes.push(`an edited message: ${JSON.stringify(afterEdit.body.find(message => message.id === fromDave.id) ?? null)}`)
        keep('alice sends empty content', await pageCall(alice, 'POST', route, { content: '' }))
        keep('alice sends 10241 characters', await pageCall(alice, 'POST', route, { content: 'x'.repeat(10241) }), { request: { method: 'POST', route, user: 'alice', body: { content: '<10241 x characters>' } } })
        keep('alice sends an unknown key', await pageCall(alice, 'POST', route, { content: 'strict body?', extra: true }))
        await sleep(1500)
        const remove = async (person, label, id) => {
          const step = person === dave ? await daveCall('DELETE', `${route}/${id}`) : await pageCall(person, 'DELETE', `${route}/${id}`)
          await sleep(1500)
          const seen = arrivals(listeners, 'delete-global-message', id, step.sentAt - 1)
          keep(label, step, { events: seen })
          notes.push(`${label}: ${step.status}; events ${JSON.stringify(Object.fromEntries(Object.entries(seen).map(([name, event]) => [name, event?.args ?? null])))}`)
        }
        await remove(alice, "alice (owner) deletes bob's message", fromBob.id)
        await remove(bob, "bob deletes alice's message", fromAlice.id)
        await remove(alice, 'alice deletes an unknown message id', objectId())
        const leftover = keep('messages before cleanup', await pageCall(alice, 'GET', `${route}?limit=100`))
        const authors = { [state.users.alice.id]: alice, [state.users.bob.id]: bob, [state.users.dave.id]: dave }
        let first = true
        for (const message of leftover.body) {
          const person = authors[message.user_id]
          if (!person) continue
          if (first) {
            await remove(person, `${person.name} deletes own message`, message.id)
            first = false
          } else {
            const step = person === dave ? await daveCall('DELETE', `${route}/${message.id}`) : await pageCall(person, 'DELETE', `${route}/${message.id}`)
            keep(`${person.name} deletes own message (cleanup)`, step)
          }
        }
        await sleep(1500)
        keep('messages after cleanup', await pageCall(alice, 'GET', `${route}?limit=100`))
        const chatFrames = Object.fromEntries(listeners.map(listener => [listener.name, ['new-chat-message', 'edit-global-message', 'delete-global-message'].map(name => `${name} ${framesWith(listener, name).length}`).join(', ')]))
        notes.push(`chat events per listener: ${JSON.stringify(chatFrames)}`)
        extra.set('chat.json', `${JSON.stringify({ clientIdPrefix: '<name>-<uuid>', steps, paged: paged.map(message => message?.id ?? null) }, null, 2)}\n`)
      },
    },
  }

  const probes = {
    'chat-restricted-user': {
      description:
        'Alice turns on link sharing for a throwaway project and Erin joins it through the read-only link (a restricted user). Alice sends, edits and deletes a chat message while both listen on websockets: which chat events reach Erin, and what the chat routes answer her.',
      async run(ctx, notes) {
        const alice = await ctx.signInAs('alice')
        const erin = await ctx.signInAs('erin')
        const token = await csrfFor(ctx.site, alice, ctx.state.projects['sharejs-project'].id)
        const { created, projectId } = await throwaway(ctx, alice, token, 'chat-restricted')
        const steps = [created]
        try {
          steps.push(await rest(ctx, alice, 'POST', `/project/${projectId}/settings/admin`, { token, body: { publicAccessLevel: 'tokenBased' } }))
          const links = await rest(ctx, alice, 'GET', `/project/${projectId}/tokens`)
          for (const value of Object.values(links.body ?? {})) if (typeof value === 'string') ctx.secrets.add(value)
          const readOnly = links.body.readOnly
          const landing = await page(ctx, erin, `/read/${readOnly}`)
          steps.push(await rest(ctx, erin, 'POST', `/read/${readOnly}/grant`, { token: landing.token, body: { confirmedByUser: true }, user: 'erin' }))
          const editor = await page(ctx, erin, `/project/${projectId}`)
          const meta = metaOf(editor.html, /capabilit|Restricted|TokenMember|user_id/)
          steps.push({ page: { user: 'erin', route: `/project/${projectId}`, status: editor.status, meta } })
          notes.push(`erin's editor page: ${JSON.stringify(meta)}`)
          const owner = await socket(ctx, 'alice', alice, projectId)
          const visitor = await socket(ctx, 'erin', erin, projectId)
          notes.push(`erin joins as ${joinOf(visitor)?.permissionsLevel}`)
          const route = `/project/${projectId}/messages`
          const sent = await rest(ctx, alice, 'POST', route, { token, body: { content: 'Alice says hello to the room.', client_id: 'alice-probe' }, user: 'alice' })
          await sleep(1500)
          const list = await rest(ctx, alice, 'GET', route, { user: 'alice' })
          const id = list.body?.[0]?.id
          const edited = await rest(ctx, alice, 'POST', `${route}/${id}/edit`, { token, body: { content: 'Alice edited it.' }, user: 'alice' })
          await sleep(1500)
          const deleted = await rest(ctx, alice, 'DELETE', `${route}/${id}`, { token, user: 'alice' })
          await sleep(1500)
          steps.push(sent, list, edited, deleted)
          steps.push(await rest(ctx, erin, 'GET', route, { user: 'erin' }))
          steps.push(await rest(ctx, erin, 'POST', route, { token: editor.token, body: { content: 'Erin tries to chat.' }, user: 'erin' }))
          const chat = ['new-chat-message', 'edit-global-message', 'delete-global-message']
          notes.push(`alice received ${JSON.stringify(namedEvents(owner, 0, chat).map(event => event.name))}`)
          notes.push(`erin received ${JSON.stringify(namedEvents(visitor, 0, chat).map(event => event.name))}; all erin's events ${JSON.stringify(otherEvents(visitor))}`)
          notes.push(`erin GET messages ${steps.at(-2).status} ${JSON.stringify(steps.at(-2).body)}, POST ${steps.at(-1).status} ${JSON.stringify(steps.at(-1).body)}`)
          await owner.close()
          await visitor.close()
          steps.push({ socket: { user: 'alice', projectId, transport: 'websocket', frames: owner.frames } })
          steps.push({ socket: { user: 'erin', projectId, transport: 'websocket', frames: visitor.frames } })
        } finally {
          steps.push(await rest(ctx, alice, 'DELETE', `/project/${projectId}`, { token }))
        }
        return steps
      },
    },
    'chat-rate-limit': {
      description:
        'Alice sends chat messages to a throwaway project with nobody listening until the chat rate limit (100 per minute per user) answers 429. Run it last: Alice cannot chat anywhere for a minute afterwards.',
      async run(ctx, notes) {
        const alice = await ctx.signInAs('alice')
        const token = await csrfFor(ctx.site, alice, ctx.state.projects['sharejs-project'].id)
        const { created, projectId } = await throwaway(ctx, alice, token, 'chat-rate-limit')
        const steps = [created]
        try {
          for (let attempt = 1; attempt <= 130; attempt++) {
            const step = await rest(ctx, alice, 'POST', `/project/${projectId}/messages`, { token, body: { content: `Burst ${attempt}` }, user: 'alice' })
            if (step.status !== 204) {
              step.attempt = attempt
              steps.push(step)
              notes.push(`message ${attempt} answered ${step.status} ${JSON.stringify(step.body)} headers ${JSON.stringify(step.headers)}`)
              break
            }
          }
          if (steps.length === 1) notes.push('130 messages in a row were never rate limited')
        } finally {
          steps.push(await rest(ctx, alice, 'DELETE', `/project/${projectId}`, { token }))
        }
        return steps
      },
    },
    'people-invites': {
      description:
        "Alice invites Erin (an existing user), Frank (no account) and Carol to a throwaway project while she listens on a websocket; Erin reads her dashboard notifications, opens and accepts her invite; Alice revokes Frank's. Records project:membership:changed for each step, the join's project.invites, the members and invites routes and GET /changes/users.",
      async run(ctx, notes) {
        const alice = await ctx.signInAs('alice')
        const erin = await ctx.signInAs('erin')
        const bob = await ctx.signInAs('bob')
        const token = await csrfFor(ctx.site, alice, ctx.state.projects['sharejs-project'].id)
        const { created, projectId } = await throwaway(ctx, alice, token, 'people-invites')
        const steps = [created]
        const base = `/project/${projectId}`
        let owner = null
        try {
          owner = await socket(ctx, 'alice', alice, projectId)
          steps.push(await rest(ctx, alice, 'GET', `${base}/members`, { user: 'alice' }))
          steps.push(await rest(ctx, alice, 'GET', `${base}/invites`, { user: 'alice' }))
          const invites = {}
          for (const [who, email, privileges] of [
            ['erin', ctx.state.users.erin.email, 'readAndWrite'],
            ['frank', 'frank@example.test', 'readOnly'],
            ['carol', ctx.state.users.carol.email, 'review'],
          ]) {
            const step = await watchStep(ctx, [owner], `alice invites ${who} as ${privileges}`, () => rest(ctx, alice, 'POST', `${base}/invite`, { token, body: { email, privileges }, user: 'alice' }), { expect: 1 })
            invites[who] = step.body?.invite?._id
            steps.push(step)
            notes.push(`invite ${who}: ${step.status} ${JSON.stringify(step.body)}; events ${JSON.stringify(step.events.alice.map(event => [event.name, event.args]))}`)
          }
          steps.push(await watchStep(ctx, [owner], 'alice invites erin again', () => rest(ctx, alice, 'POST', `${base}/invite`, { token, body: { email: ctx.state.users.erin.email, privileges: 'readOnly' }, user: 'alice' })))
          notes.push(`second invite to erin: ${steps.at(-1).status} ${JSON.stringify(steps.at(-1).body)}`)
          steps.push(await rest(ctx, alice, 'POST', `${base}/invite`, { token, body: { email: 'not-an-email', privileges: 'readOnly' }, user: 'alice' }))
          steps.push(await rest(ctx, alice, 'POST', `${base}/invite`, { token, body: { email: ctx.state.users.alice.email, privileges: 'readOnly' }, user: 'alice' }))
          const listed = await rest(ctx, alice, 'GET', `${base}/invites`, { user: 'alice' })
          steps.push(listed)
          notes.push(`GET invites: ${JSON.stringify(listed.body)}`)
          const rejoin = await socket(ctx, 'alice', alice, projectId)
          const join = joinOf(rejoin)
          notes.push(`the owner's join project.invites ${JSON.stringify(join?.project?.invites)}; members ${JSON.stringify(join?.project?.members)}`)
          steps.push({ join: { user: 'alice', invites: join?.project?.invites ?? null, members: join?.project?.members ?? null, owner: join?.project?.owner ?? null } })
          await rejoin.close()
          const stored = await mongo(`
            const found = await db.notifications.find({ key: { $regex: '^project-invite-' } }).toArray()
            return found.filter(item => item.key.endsWith(${JSON.stringify(invites.erin ?? '')})).map(item => ({ key: item.key, templateKey: item.templateKey, messageOpts: item.messageOpts, expires: item.expires, user_id: item.user_id }))
          `).catch(error => ({ error: String(error.message).slice(0, 300) }))
          const inviteToken = Array.isArray(stored) ? stored[0]?.messageOpts?.token : null
          if (inviteToken) ctx.secrets.add(inviteToken)
          steps.push({ notificationsInMongo: stored })
          const hideTokens = list => {
            for (const item of Array.isArray(list) ? list : []) if (item?.messageOpts?.token) ctx.secrets.add(item.messageOpts.token)
          }
          const dashboard = await page(ctx, erin, '/project')
          const dashMeta = metaOf(dashboard.html, /^ol-notifications$/)
          hideTokens(dashMeta['ol-notifications']?.value)
          steps.push({ page: { user: 'erin', route: '/project', status: dashboard.status, meta: dashMeta } })
          notes.push(`erin's dashboard ol-notifications: ${JSON.stringify(dashMeta['ol-notifications']?.value)}`)
          steps.push(await rest(ctx, erin, 'GET', '/notifications', { user: 'erin' }))
          hideTokens(steps.at(-1).body)
          notes.push(`GET /notifications for erin: ${steps.at(-1).status} ${JSON.stringify(steps.at(-1).body).slice(0, 400)}`)
          if (inviteToken) {
            const view = await page(ctx, erin, `${base}/invite/token/${inviteToken}`)
            steps.push({ page: { user: 'erin', route: `${base}/invite/token/[redacted]`, status: view.status, location: view.location, meta: metaOf(view.html, /invite|project|user$|inviteToken|sharedProject/i) } })
            notes.push(`erin opens the invite page: ${view.status}`)
            steps.push(await watchStep(ctx, [owner], 'erin accepts without X-Requested-With', () => rest(ctx, erin, 'POST', `${base}/invite/token/${inviteToken}/accept`, { token: view.token ?? dashboard.token, body: {}, user: 'erin', headers: { accept: 'text/html' } }), { expect: 1 }))
            notes.push(`accept: ${steps.at(-1).status} ${JSON.stringify(steps.at(-1).headers)}; events ${JSON.stringify(steps.at(-1).events.alice.map(event => [event.name, event.args]))}`)
            steps.push(await rest(ctx, erin, 'POST', `${base}/invite/token/${inviteToken}/accept`, { token: view.token ?? dashboard.token, body: {}, user: 'erin', headers: { 'x-requested-with': 'XMLHttpRequest' } }))
            notes.push(`accept again (XMLHttpRequest): ${steps.at(-1).status} ${JSON.stringify(steps.at(-1).headers)}`)
            const after = await page(ctx, erin, '/project')
            const afterMeta = metaOf(after.html, /^ol-notifications$/)
            hideTokens(afterMeta['ol-notifications']?.value)
            steps.push({ page: { user: 'erin', route: '/project', status: after.status, meta: afterMeta, note: 'after accepting' } })
          } else {
            notes.push('no invite token was found in the notifications collection, so the accept route was not recorded')
          }
          if (invites.carol) {
            const carol = await ctx.signInAs('carol')
            const carolDash = await page(ctx, carol, '/project')
            hideTokens(metaOf(carolDash.html, /^ol-notifications$/)['ol-notifications']?.value)
            const carolStored = await mongo(`
              const found = await db.notifications.find({ key: ${JSON.stringify(`project-invite-${invites.carol}`)} }).toArray()
              return found.map(item => item.messageOpts?.token ?? null)
            `).catch(() => [])
            const carolToken = carolStored[0]
            if (carolToken) {
              ctx.secrets.add(carolToken)
              steps.push(await watchStep(ctx, [owner], 'carol accepts a review invite with X-Requested-With', () => rest(ctx, carol, 'POST', `${base}/invite/token/${carolToken}/accept`, { token: carolDash.token, body: {}, user: 'carol', headers: { 'x-requested-with': 'XMLHttpRequest' } }), { expect: 1 }))
              notes.push(`carol accepts: ${steps.at(-1).status}; events ${JSON.stringify(steps.at(-1).events.alice.map(event => [event.name, event.args]))}`)
            }
          }
          steps.push(await watchStep(ctx, [owner], "alice revokes frank's invite", () => rest(ctx, alice, 'DELETE', `${base}/invite/${invites.frank}`, { token, user: 'alice' }), { expect: 1 }))
          notes.push(`revoke: ${steps.at(-1).status}; events ${JSON.stringify(steps.at(-1).events.alice.map(event => [event.name, event.args]))}`)
          steps.push(await rest(ctx, alice, 'DELETE', `${base}/invite/${objectId()}`, { token, user: 'alice' }))
          const members = await rest(ctx, alice, 'GET', `${base}/members`, { user: 'alice' })
          steps.push(members)
          notes.push(`members after: ${JSON.stringify(members.body)}`)
          steps.push(await rest(ctx, alice, 'GET', `${base}/invites`, { user: 'alice' }))
          steps.push(await rest(ctx, alice, 'GET', `${base}/changes/users`, { user: 'alice' }))
          steps.push(await rest(ctx, bob, 'GET', `${base}/members`, { user: 'bob' }))
          const erinSocket = await socket(ctx, 'erin', erin, projectId)
          const erinJoin = joinOf(erinSocket)
          notes.push(`erin's join as an accepted member: permissionsLevel ${erinJoin?.permissionsLevel}; invites ${JSON.stringify(erinJoin?.project?.invites)}`)
          steps.push({ join: { user: 'erin', permissionsLevel: erinJoin?.permissionsLevel ?? null, invites: erinJoin?.project?.invites ?? null, members: erinJoin?.project?.members ?? null } })
          await erinSocket.close()
          const erinRoute = await rest(ctx, erin, 'GET', `${base}/invites`, { user: 'erin' })
          steps.push(erinRoute)
          steps.push(await watchStep(ctx, [owner], 'alice removes erin', () => rest(ctx, alice, 'DELETE', `${base}/users/${ctx.state.users.erin.id}`, { token, user: 'alice' }), { expect: 1 }))
          notes.push(`remove erin: ${steps.at(-1).status}; events ${JSON.stringify(steps.at(-1).events.alice.map(event => [event.name, event.args]))}`)
          await owner.close()
          steps.push({ socket: { user: 'alice', projectId, transport: 'websocket', frames: owner.frames } })
        } finally {
          await owner?.close()
          steps.push(await rest(ctx, alice, 'DELETE', `/project/${projectId}`, { token }))
          const left = await page(ctx, erin, '/project')
          const leftMeta = metaOf(left.html, /^ol-notifications$/)
          for (const item of leftMeta['ol-notifications']?.value ?? []) if (item?.messageOpts?.token) ctx.secrets.add(item.messageOpts.token)
          steps.push({ page: { user: 'erin', route: '/project', status: left.status, meta: leftMeta, note: 'after the project was deleted' } })
          notes.push(`erin's notifications after the project was deleted: ${JSON.stringify((leftMeta['ol-notifications']?.value ?? []).map(item => item.messageOpts?.projectId === projectId ? 'this deleted project' : 'another project'))}`)
          const removed = await mongo(`return (await db.notifications.deleteMany({ 'messageOpts.projectId': ${JSON.stringify(projectId)} })).deletedCount`)
          notes.push(`cleanup: removed ${removed} notifications that still pointed at the deleted project`)
        }
        return steps
      },
    },
    'link-sharing-grants': {
      description:
        'Alice turns on link sharing for a throwaway project while listening on a websocket. Erin uses the read-only link, Dave the read-and-write link, each first unconfirmed then confirmed; Erin then upgrades through the read-and-write link; Alice uses her own link; an unknown token; then link sharing off. Records each reply, the token pages\' meta, the membership events, each visitor\'s join and which routes a restricted visitor may read.',
      async run(ctx, notes) {
        const alice = await ctx.signInAs('alice')
        const erin = await ctx.signInAs('erin')
        const dave = await ctx.signInAs('dave')
        const token = await csrfFor(ctx.site, alice, ctx.state.projects['sharejs-project'].id)
        const { created, projectId } = await throwaway(ctx, alice, token, 'link-grants', 'example')
        const steps = [created]
        const base = `/project/${projectId}`
        let owner = null
        try {
          owner = await socket(ctx, 'alice', alice, projectId)
          steps.push(await watchStep(ctx, [owner], 'alice turns on link sharing', () => rest(ctx, alice, 'POST', `${base}/settings/admin`, { token, body: { publicAccessLevel: 'tokenBased' }, user: 'alice' }), { expect: 1 }))
          const links = await rest(ctx, alice, 'GET', `${base}/tokens`, { user: 'alice' })
          const kind = (key, value) => {
            if (/Hash/.test(key)) return /^[0-9a-f]+$/.test(value) ? ', hex' : ''
            if (/^[a-z]+$/.test(value)) return ', a-z'
            return /^[0-9]+[a-z]+$/.test(value) ? ', digits then a-z' : /^[0-9]+$/.test(value) ? ', digits' : ''
          }
          const shape = Object.fromEntries(Object.entries(links.body ?? {}).map(([key, value]) => [key, typeof value === 'string' ? `<${value.length} characters${kind(key, value)}>` : value]))
          for (const value of Object.values(links.body ?? {})) if (typeof value === 'string') ctx.secrets.add(value)
          steps.push({ ...links, body: shape })
          notes.push(`tokens: ${links.status} ${JSON.stringify(shape)}`)
          const { readOnly, readAndWrite } = links.body
          const grant = async (who, jar, path, confirmed) => {
            const landing = await page(ctx, jar, path)
            const meta = metaOf(landing.html, /postUrl|user$|projectName|tokenAccess|hashPrefix/i)
            const body = confirmed === undefined ? {} : { confirmedByUser: confirmed }
            const step = await watchStep(ctx, [owner], `${who} grants ${path.startsWith('/read/') ? 'read-only' : 'read-and-write'} ${confirmed === undefined ? 'with no confirmedByUser' : `confirmedByUser ${confirmed}`}`, () => rest(ctx, jar, 'POST', `${path}/grant`, { token: landing.token, body, user: who }), { quiet: 1500 })
            step.page = { status: landing.status, meta }
            steps.push(step)
            notes.push(`${step.label}: page ${landing.status}, grant ${step.status} ${JSON.stringify(step.body)}; events ${JSON.stringify(step.events.alice.map(event => [event.name, event.args]))}`)
            return step
          }
          await grant('erin', erin, `/read/${readOnly}`, undefined)
          await grant('erin', erin, `/read/${readOnly}`, false)
          await grant('erin', erin, `/read/${readOnly}`, true)
          const erinSocket = await socket(ctx, 'erin', erin, projectId)
          const erinJoin = joinOf(erinSocket)
          notes.push(`erin after the read-only grant: ${erinJoin?.permissionsLevel}; owner keys ${Object.keys(erinJoin?.project?.owner ?? {}).join(',')}`)
          await erinSocket.close()
          for (const route of [`${base}/updates?min_count=1`, `${base}/labels`, `${base}/version/1/zip`, `${base}/messages`, `${base}/members`, `${base}/entities`]) {
            steps.push(await rest(ctx, erin, 'GET', route, { user: 'erin (restricted)' }))
          }
          notes.push(`restricted reads: ${steps.slice(-6).map(step => `${step.request.route.replace(base, '')} ${step.status}`).join(', ')}`)
          await grant('dave', dave, `/${readAndWrite}`, undefined)
          await grant('dave', dave, `/${readAndWrite}`, true)
          const daveSocket = await socket(ctx, 'dave', dave, projectId)
          const daveJoin = joinOf(daveSocket)
          notes.push(`dave after the read-and-write grant: ${daveJoin?.permissionsLevel}; members ${JSON.stringify(daveJoin?.project?.members)}`)
          steps.push({ join: { user: 'dave', permissionsLevel: daveJoin?.permissionsLevel ?? null, members: daveJoin?.project?.members ?? null, invites: daveJoin?.project?.invites ?? null, owner: daveJoin?.project?.owner ?? null } })
          await daveSocket.close()
          await grant('erin', erin, `/${readAndWrite}`, true)
          const upgraded = await socket(ctx, 'erin', erin, projectId)
          notes.push(`erin after the read-and-write grant: ${joinOf(upgraded)?.permissionsLevel}`)
          await upgraded.close()
          await grant('alice', alice, `/read/${readOnly}`, true)
          await grant('alice', alice, `/${readAndWrite}`, true)
          await grant('dave', dave, `/read/${readOnly}`, true)
          const unknown = await page(ctx, erin, '/read/abcdefghijkl')
          steps.push({ page: { user: 'erin', route: '/read/<unknown 12 a-z>', status: unknown.status } })
          const erinToken = unknown.token ?? (await page(ctx, erin, '/project')).token
          steps.push(await rest(ctx, erin, 'POST', '/read/abcdefghijkl/grant', { token: erinToken, body: { confirmedByUser: true }, user: 'erin' }))
          notes.push(`unknown token: page ${unknown.status}, grant ${steps.at(-1).status} ${JSON.stringify(steps.at(-1).body)}`)
          steps.push(await rest(ctx, alice, 'GET', `${base}/members`, { user: 'alice' }))
          notes.push(`members after the grants: ${JSON.stringify(steps.at(-1).body)}`)
          steps.push(await watchStep(ctx, [owner], 'alice turns link sharing off', () => rest(ctx, alice, 'POST', `${base}/settings/admin`, { token, body: { publicAccessLevel: 'private' }, user: 'alice' }), { expect: 1 }))
          notes.push(`link sharing off: ${steps.at(-1).status}; events ${JSON.stringify(steps.at(-1).events.alice.map(event => [event.name, event.args]))}`)
          const late = await page(ctx, erin, `/read/${readOnly}`)
          steps.push({ page: { user: 'erin', route: '/read/[redacted] after link sharing is off', status: late.status } })
          const after = new ScriptedClient('erin', ctx.clock)
          await after.open(ctx.site, erin, projectId, ctx.secrets, { websocket: true })
          await after.outcome()
          const rejected = after.events.find(event => event.name === 'connectionRejected')
          notes.push(`erin joins after link sharing is off: ${rejected ? `rejected ${JSON.stringify(rejected.args)}` : joinOf(after)?.permissionsLevel}`)
          await after.close()
          await owner.close()
          steps.push({ socket: { user: 'alice', projectId, transport: 'websocket', frames: owner.frames } })
        } finally {
          await owner?.close()
          steps.push(await rest(ctx, alice, 'DELETE', `/project/${projectId}`, { token }))
        }
        return steps
      },
    },
    'settings-each-key': {
      description:
        'Alice changes each project setting on its own (compiler, imageName, name, spellCheckLanguage, rootDocId, mainBibliographyDocId, png2pdf, referenceFormat) while Bob watches; a compiler in capitals, an unknown compiler, an unknown image, an unknown key; Bob (editor), Carol (reviewer) and Dave (viewer) try a change; the editor page meta for images, languages and compilers; then everything is put back.',
      async run(ctx, notes) {
        const project = ctx.state.projects['sharejs-project']
        const base = `/project/${project.id}`
        const bobJar = await ctx.signInAs('bob')
        const bob = await socket(ctx, 'bob', bobJar, project.id)
        const original = joinOf(bob).project
        const alice = await ctx.signInAs('alice')
        const editor = await page(ctx, alice, base)
        const token = editor.token
        const meta = metaOf(editor.html, /imageNames|languages|compile|Compiler|allowedImage|spellCheck|userSettings/)
        if (Array.isArray(meta['ol-languages']?.value)) meta['ol-languages'].count = meta['ol-languages'].value.length
        const config = await webNode(`
          const { default: Settings } = await import('@overleaf/settings')
          console.log('OLEAFLY_SETTINGS ' + JSON.stringify({ safeCompilers: Settings.safeCompilers, allowedImageNames: Settings.allowedImageNames ?? null, imageRoot: Settings.imageRoot ?? null, currentImageName: Settings.currentImageName ?? null }))
          process.exit(0)
        `).then(output => JSON.parse(output.split('\n').find(line => line.startsWith('OLEAFLY_SETTINGS ')).slice(17))).catch(error => ({ error: String(error.message).slice(0, 300) }))
        const steps = [{ page: { user: 'alice', route: base, status: editor.status, meta } }, { serverSettings: config }]
        notes.push(`editor meta: ${JSON.stringify(meta).slice(0, 900)}`)
        notes.push(`server settings: ${JSON.stringify(config)}`)
        notes.push(`the join's settings: ${JSON.stringify({ compiler: original.compiler, imageName: original.imageName, spellCheckLanguage: original.spellCheckLanguage, rootDoc_id: original.rootDoc_id, mainBibliographyDoc_id: original.mainBibliographyDoc_id ?? null, png2pdf: original.png2pdf ?? null, referenceFormat: original.referenceFormat ?? null })}`)
        const storedSettings = () =>
          mongo(`
            const found = await db.projects.findOne({ _id: new ObjectId(${JSON.stringify(project.id)}) }, { projection: { compiler: 1, imageName: 1, name: 1, spellCheckLanguage: 1, rootDoc_id: 1, mainBibliographyDoc_id: 1, png2pdf: 1, referenceFormat: 1 } })
            delete found._id
            return found
          `)
        steps.push({ storedBefore: await storedSettings() })
        const change = async (who, jar, csrf, label, body) => {
          const step = await watchStep(ctx, [bob], label, () => rest(ctx, jar, 'POST', `${base}/settings`, { token: csrf, body, user: who }), { quiet: 1200 })
          step.stored = await storedSettings()
          steps.push(step)
          notes.push(`${label}: ${step.status} ${typeof step.body === 'string' ? step.body.slice(0, 80) : JSON.stringify(step.body)}; events ${JSON.stringify(step.events.bob.map(event => `${event.name}(${JSON.stringify(event.args)}) +${event.t - step.answeredAt}ms`))}; stored ${JSON.stringify(step.stored)}`)
          return step
        }
        try {
          await change('alice', alice, token, 'compiler xelatex', { compiler: 'xelatex' })
          await change('alice', alice, token, 'compiler LuaLaTeX (capitals)', { compiler: 'LuaLaTeX' })
          await change('alice', alice, token, 'compiler latex', { compiler: 'latex' })
          await change('alice', alice, token, 'compiler luatex (unknown)', { compiler: 'luatex' })
          await change('alice', alice, token, 'compiler empty string', { compiler: '' })
          await change('alice', alice, token, 'imageName texlive-full:2025.1', { imageName: 'texlive-full:2025.1' })
          await change('alice', alice, token, 'imageName not-an-image', { imageName: 'not-an-image' })
          await change('alice', alice, token, 'name', { name: `${original.name} (each key)` })
          await change('alice', alice, token, 'spellCheckLanguage de', { spellCheckLanguage: 'de' })
          await change('alice', alice, token, 'spellCheckLanguage en_GB', { spellCheckLanguage: 'en_GB' })
          await change('alice', alice, token, 'spellCheckLanguage empty (off)', { spellCheckLanguage: '' })
          await change('alice', alice, token, 'spellCheckLanguage xx_YY (unknown)', { spellCheckLanguage: 'xx_YY' })
          await change('alice', alice, token, 'rootDocId sections/intro.tex', { rootDocId: project.docs['sections/intro.tex'] })
          await change('alice', alice, token, 'rootDocId refs.bib (not a tex file)', { rootDocId: project.docs['refs.bib'] })
          await change('alice', alice, token, 'rootDocId unknown id', { rootDocId: objectId() })
          await change('alice', alice, token, 'mainBibliographyDocId refs.bib', { mainBibliographyDocId: project.docs['refs.bib'] })
          await change('alice', alice, token, 'mainBibliographyDocId main.tex (not a bib file)', { mainBibliographyDocId: project.docs['main.tex'] })
          await change('alice', alice, token, 'png2pdf true', { png2pdf: true })
          await change('alice', alice, token, 'referenceFormat biblatex', { referenceFormat: 'biblatex' })
          await change('alice', alice, token, 'an unknown key', { theme: 'dark' })
          await change('alice', alice, token, 'all keys at once', { compiler: 'pdflatex', spellCheckLanguage: 'fr', rootDocId: project.docs['main.tex'], mainBibliographyDocId: project.docs['refs.bib'], imageName: 'texlive-full:2025.1', name: `${original.name} (all at once)` })
          for (const [who, level] of [['bob', 'editor'], ['carol', 'reviewer'], ['dave', 'viewer']]) {
            const jar = who === 'bob' ? bobJar : await ctx.signInAs(who)
            const own = await page(ctx, jar, base)
            await change(who, jar, own.token, `${who} (${level}) changes the compiler`, { compiler: 'lualatex' })
            await change(who, jar, own.token, `${who} (${level}) renames the project`, { name: `${original.name} (${who})` })
          }
        } finally {
          await change('alice', alice, token, 'put back', {
            compiler: original.compiler,
            name: original.name,
            spellCheckLanguage: original.spellCheckLanguage,
            rootDocId: original.rootDoc_id,
            ...(original.mainBibliographyDoc_id ? { mainBibliographyDocId: original.mainBibliographyDoc_id } : {}),
            ...(original.imageName ? { imageName: original.imageName.split('/').pop() } : {}),
          })
          if (original.png2pdf != null) await change('alice', alice, token, 'png2pdf back', { png2pdf: original.png2pdf })
          if (original.referenceFormat != null) await change('alice', alice, token, 'referenceFormat back', { referenceFormat: original.referenceFormat })
          const unset = Object.fromEntries(['mainBibliographyDoc_id', 'png2pdf', 'referenceFormat'].filter(key => original[key] == null).map(key => [key, 1]))
          if (Object.keys(unset).length) {
            await mongo(`return (await db.projects.updateOne({ _id: new ObjectId(${JSON.stringify(project.id)}) }, { $unset: ${JSON.stringify(unset)} })).modifiedCount`)
            notes.push(`unset in Mongo, since the route cannot clear them: ${Object.keys(unset).join(', ')}`)
          }
          const after = await socket(ctx, 'bob', bobJar, project.id)
          const back = joinOf(after).project
          notes.push(`after putting back: ${JSON.stringify({ compiler: back.compiler, imageName: back.imageName, name: back.name, spellCheckLanguage: back.spellCheckLanguage, rootDoc_id: back.rootDoc_id, mainBibliographyDoc_id: back.mainBibliographyDoc_id ?? null, png2pdf: back.png2pdf ?? null, referenceFormat: back.referenceFormat ?? null })}`)
          await after.close()
          await bob.close()
        }
        steps.push({ socket: { user: 'bob', projectId: project.id, transport: 'websocket', frames: bob.frames } })
        return steps
      },
    },
    'history-routes': {
      description:
        'A throwaway project (example template, Bob editor, Carol reviewer, Dave viewer added in the container). Alice edits main.tex, adds, edits and deletes extra.tex, and flushes history. Records /updates paging with min_count and before, /diff (from==to, a range, no pathname, an unknown pathname, a deleted file), /filetree/diff, labels by each role, revert_file and revert-project before and after enabling history ranges support, restore_file of a deleted file and over an existing name, and /version/:v/zip, with Bob\'s websocket timing every tree event.',
      async run(ctx, notes) {
        const alice = await ctx.signInAs('alice')
        const anyToken = await csrfFor(ctx.site, alice, ctx.state.projects['sharejs-project'].id)
        const { created, projectId } = await throwaway(ctx, alice, anyToken, 'history-routes', 'example')
        const steps = [created]
        const base = `/project/${projectId}`
        const users = ctx.state.users
        let bob = null
        let writer = null
        try {
          await addMember(projectId, users.alice.id, users.bob.id, 'readAndWrite')
          await addMember(projectId, users.alice.id, users.carol.id, 'review')
          await addMember(projectId, users.alice.id, users.dave.id, 'readOnly')
          const flags = await mongo(`
            const project = await db.projects.findOne({ _id: new ObjectId(${JSON.stringify(projectId)}) }, { projection: { overleaf: 1 } })
            return project.overleaf
          `)
          steps.push({ projectHistoryFlags: flags })
          notes.push(`a new CE project's overleaf.history: ${JSON.stringify(flags.history)}`)
          const token = (await page(ctx, alice, base)).token
          const jars = { alice }
          for (const who of ['bob', 'carol', 'dave']) jars[who] = await ctx.signInAs(who)
          const tokens = { alice: token }
          for (const who of ['bob', 'carol', 'dave']) tokens[who] = (await page(ctx, jars[who], base)).token
          bob = await socket(ctx, 'bob', jars.bob, projectId)
          const join = joinOf(bob)
          notes.push(`join features.versioning ${JSON.stringify(join.project.features?.versioning)}; overleaf key in join ${JSON.stringify(join.project.overleaf ?? null)}`)
          const root = join.project.rootFolder[0]
          const mainId = join.project.rootDoc_id
          writer = await socket(ctx, 'alice', alice, projectId)
          const edit = async (docId, text) => {
            const reply = await writer.joinDoc(docId)
            const length = reply[1].map(line => Buffer.from(line, 'latin1').toString('utf8')).join('\n').length
            await writer.update(docId, { doc: docId, op: [{ p: length, i: text }], v: reply[2] })
            await writer.call('leaveDoc', [docId])
          }
          const flush = async label => {
            const step = await rest(ctx, alice, 'POST', `${base}/flush`, { token, user: 'alice' })
            steps.push({ label, ...step })
            return step
          }
          await edit(mainId, '\nFirst history edit.\n')
          await flush('flush after the first edit')
          const extra = await rest(ctx, alice, 'POST', `${base}/doc`, { token, body: { name: 'extra.tex', parent_folder_id: root._id }, user: 'alice' })
          steps.push(extra)
          await edit(extra.body._id, 'Extra file text.\n')
          await flush('flush after extra.tex')
          await sleep(1000)
          const withExtra = await rest(ctx, alice, 'GET', `${base}/updates?min_count=1`, { user: 'alice' })
          const extraVersion = withExtra.body.updates[0].toV
          steps.push(await rest(ctx, alice, 'DELETE', `${base}/doc/${extra.body._id}`, { token, user: 'alice' }))
          await edit(mainId, 'Second history edit.\n')
          await flush('flush after deleting extra.tex and the second edit')
          await sleep(1500)
          const pages = []
          let before = null
          for (let n = 0; n < 12; n++) {
            const step = await rest(ctx, alice, 'GET', `${base}/updates?min_count=1${before ? `&before=${before}` : ''}`, { user: 'alice' })
            pages.push(step)
            before = step.body?.nextBeforeTimestamp
            if (!before) break
          }
          steps.push(...pages.map((step, index) => ({ label: `updates page ${index + 1} (min_count=1)`, ...step })))
          notes.push(`updates pages (min_count=1): ${pages.map(step => `${step.body.updates.map(update => `${update.fromV}-${update.toV}`).join(',')} next ${step.body.nextBeforeTimestamp ?? 'none'}`).join(' // ')}`)
          const all = await rest(ctx, alice, 'GET', `${base}/updates?min_count=50`, { user: 'alice' })
          steps.push({ label: 'updates min_count=50', ...all })
          steps.push({ label: 'updates with no min_count', ...(await rest(ctx, alice, 'GET', `${base}/updates`, { user: 'alice' })) })
          steps.push({ label: 'updates min_count=2', ...(await rest(ctx, alice, 'GET', `${base}/updates?min_count=2`, { user: 'alice' })) })
          steps.push({ label: 'updates before=1 (older than everything)', ...(await rest(ctx, alice, 'GET', `${base}/updates?min_count=10&before=1`, { user: 'alice' })) })
          const versions = all.body.updates.map(update => update.toV)
          const latest = Math.max(...versions)
          const earliest = Math.min(...all.body.updates.map(update => update.fromV))
          notes.push(`versions ${earliest}..${latest}; extra.tex existed at v${extraVersion}`)
          const read = (label, route, who = 'alice') => rest(ctx, jars[who], 'GET', route, { user: who }).then(step => ({ label, ...step }))
          steps.push(await read('diff from==to on main.tex', `${base}/diff?from=${latest}&to=${latest}&pathname=main.tex`))
          steps.push(await read('diff over the whole range on main.tex', `${base}/diff?from=${earliest}&to=${latest}&pathname=main.tex`))
          steps.push(await read('diff with no pathname', `${base}/diff?from=${earliest}&to=${latest}`))
          steps.push(await read('diff with an unknown pathname', `${base}/diff?from=${earliest}&to=${latest}&pathname=nope.tex`))
          steps.push(await read('diff of extra.tex at the version where it existed', `${base}/diff?from=${extraVersion}&to=${extraVersion}&pathname=extra.tex`))
          steps.push(await read('diff of extra.tex after it was deleted', `${base}/diff?from=${latest}&to=${latest}&pathname=extra.tex`))
          steps.push(await read('diff of a binary (frog.jpg)', `${base}/diff?from=${latest}&to=${latest}&pathname=frog.jpg`))
          steps.push(await read('diff from > to', `${base}/diff?from=${latest}&to=${earliest}&pathname=main.tex`))
          steps.push(await read('filetree diff over the whole range', `${base}/filetree/diff?from=${earliest}&to=${latest}`))
          steps.push(await read('filetree diff from==to', `${base}/filetree/diff?from=${latest}&to=${latest}`))
          steps.push(await read('dave (viewer) reads updates', `${base}/updates?min_count=1`, 'dave'))
          steps.push(await read('labels before', `${base}/labels`))
          const label = async (who, comment, version = latest) => {
            const step = await rest(ctx, jars[who], 'POST', `${base}/labels`, { token: tokens[who], body: { comment, version }, user: who })
            steps.push({ label: `${who} adds a label`, ...step })
            return step.body?.id
          }
          const aliceLabel = await label('alice', 'Alice names this version')
          const bobLabel = await label('bob', 'Bob names this version')
          const carolLabel = await label('carol', 'Carol (reviewer) names this version', earliest)
          await label('dave', 'Dave (viewer) tries to name a version')
          steps.push({ label: 'alice adds a label with an unknown key', ...(await rest(ctx, alice, 'POST', `${base}/labels`, { token, body: { comment: 'strict?', version: latest, extra: 1 }, user: 'alice' })) })
          steps.push({ label: 'alice adds a label at a version that does not exist', ...(await rest(ctx, alice, 'POST', `${base}/labels`, { token, body: { comment: 'future', version: latest + 1000 }, user: 'alice' })) })
          const labels = await read('labels after adding', `${base}/labels`)
          steps.push(labels)
          const delLabel = async (who, id, whose) => {
            const step = await rest(ctx, jars[who], 'DELETE', `${base}/labels/${id}`, { token: tokens[who], user: who })
            steps.push({ label: `${who} deletes ${whose} label`, ...step })
          }
          await delLabel('bob', aliceLabel, "alice's")
          await delLabel('carol', carolLabel, 'her own')
          await delLabel('alice', bobLabel, "bob's")
          await delLabel('alice', objectId(), 'an unknown')
          steps.push(await read('labels after deleting', `${base}/labels`))
          steps.push(await read('updates carry labels', `${base}/updates?min_count=1`))
          notes.push(`labels: ${steps.filter(step => /adds a label|deletes .* label/.test(step.label ?? '')).map(step => `${step.label} ${step.status}`).join(', ')}`)
          const midVersion = extraVersion
          const restore = async (who, label, route, body) => {
            const step = await watchStep(ctx, [bob], label, () => rest(ctx, jars[who], 'POST', `${base}/${route}`, { token: tokens[who], body, user: who }), { quiet: 2500 })
            steps.push(step)
            const events = step.events.bob.map(event => `${event.name}${JSON.stringify(event.args).slice(0, 160)} at +${event.t - step.sentAt}ms`)
            notes.push(`${label}: ${step.status} ${JSON.stringify(step.body).slice(0, 200)}; bob saw ${events.join(', ') || 'nothing'}`)
            return step
          }
          await restore('alice', 'revert_file main.tex (stock CE project)', 'revert_file', { version: midVersion, pathname: 'main.tex' })
          await restore('alice', 'revert-project (stock CE project)', 'revert-project', { version: midVersion })
          await restore('carol', 'carol (reviewer) revert_file', 'revert_file', { version: midVersion, pathname: 'main.tex' })
          await restore('dave', 'dave (viewer) restore_file', 'restore_file', { version: extraVersion, pathname: 'extra.tex' })
          await restore('alice', 'restore_file of the deleted extra.tex', 'restore_file', { version: extraVersion, pathname: 'extra.tex' })
          await restore('alice', 'restore_file of main.tex over the existing main.tex', 'restore_file', { version: midVersion, pathname: 'main.tex' })
          await restore('alice', 'restore_file of a path not in that version', 'restore_file', { version: midVersion, pathname: 'nope.tex' })
          const migrated = await webNode(`
            const { default: Migration } = await import('/overleaf/services/web/app/src/Features/History/HistoryRangesSupportMigration.mjs')
            await Migration.promises.migrateProjects({ projectIds: [${JSON.stringify(projectId)}], direction: 'forwards' })
            const { db, ObjectId } = await import('/overleaf/services/web/app/src/infrastructure/mongodb.mjs')
            const project = await db.projects.findOne({ _id: new ObjectId(${JSON.stringify(projectId)}) }, { projection: { 'overleaf.history': 1 } })
            console.log('OLEAFLY_HISTORY ' + JSON.stringify(project.overleaf.history))
            process.exit(0)
          `)
          const history = migrated.split('\n').find(line => line.startsWith('OLEAFLY_HISTORY '))?.slice(16)
          steps.push({ rangesSupportMigration: history ? JSON.parse(history) : migrated.slice(-400) })
          notes.push(`after HistoryRangesSupportMigration: ${history}`)
          await sleep(1500)
          const fresh = await rest(ctx, alice, 'GET', `${base}/updates?min_count=1`, { user: 'alice' })
          const now = fresh.body.updates[0].toV
          await restore('alice', 'revert_file main.tex (ranges support on)', 'revert_file', { version: midVersion, pathname: 'main.tex' })
          await restore('bob', 'bob (editor) revert_file sample.bib with ranges support on', 'revert_file', { version: midVersion, pathname: 'sample.bib' })
          await restore('alice', 'revert_file of a path not in that version (ranges support on)', 'revert_file', { version: midVersion, pathname: 'nope.tex' })
          await flush('flush before revert-project')
          await sleep(1000)
          await restore('alice', 'revert-project to the version where extra.tex existed (ranges support on)', 'revert-project', { version: midVersion })
          notes.push(`version before the reverts: ${now}`)
          await flush('flush before the zips')
          await sleep(1500)
          const final = await rest(ctx, alice, 'GET', `${base}/updates?min_count=1`, { user: 'alice' })
          const top = final.body.updates[0].toV
          const zip = (who, version) =>
            new Promise((resolve, reject) => {
              const sentAt = Date.now() - ctx.clock.start
              const request = http.get(`${ctx.site}${base}/version/${version}/zip`, { headers: { cookie: jars[who].header() } }, response => {
                const chunks = []
                response.on('data', chunk => chunks.push(chunk))
                response.on('end', () => {
                  const bytes = Buffer.concat(chunks)
                  const headers = Object.fromEntries(Object.entries(response.headers).filter(([name]) => shownHeaders.has(name)))
                  const isZip = bytes.subarray(0, 2).toString('latin1') === 'PK'
                  resolve({
                    request: { method: 'GET', route: `${base}/version/${version}/zip`, user: who },
                    status: response.statusCode,
                    headers,
                    bytes: bytes.length,
                    startsWithPK: isZip,
                    entries: isZip ? zipEntries(bytes) : null,
                    body: isZip ? null : parsed(bytes.toString('utf8')),
                    sentAt,
                    answeredAt: Date.now() - ctx.clock.start,
                  })
                })
              })
              request.on('error', reject)
            })
          for (const [who, version] of [['alice', top], ['alice', earliest], ['alice', 0], ['alice', top + 1000], ['dave', top]]) {
            const step = await zip(who, version)
            steps.push(step)
            notes.push(`zip v${version} as ${who}: ${step.status} ${JSON.stringify(step.headers)} ${step.bytes} bytes${step.entries ? ` entries ${step.entries.map(entry => entry.name).join(',')}` : ''}`)
          }
          steps.push(await read('filetree diff after the reverts', `${base}/filetree/diff?from=${now}&to=${top}`))
          steps.push(await read('updates after the reverts', `${base}/updates?min_count=3`))
          const origins = steps.at(-1).body?.updates?.map(update => update.meta?.origin ?? null)
          notes.push(`update origins after the reverts: ${JSON.stringify(origins)}`)
          await writer.close()
          await bob.close()
          steps.push({ socket: { user: 'bob', projectId, transport: 'websocket', frames: bob.frames } })
        } finally {
          await writer?.close()
          await bob?.close()
          steps.push(await rest(ctx, alice, 'DELETE', `/project/${projectId}`, { token: anyToken }))
        }
        return steps
      },
    },
    'history-paging': {
      description:
        "Alice makes a throwaway project and applies 2100 single-character updates alternating between two docs (so history cannot merge them), which spills over history-v1's 2000-change chunk. Records how /updates pages: what min_count counts, what nextBeforeTimestamp holds (a version, the older chunk's start), and what before=<that value> returns.",
      async run(ctx, notes) {
        const alice = await ctx.signInAs('alice')
        const token = await csrfFor(ctx.site, alice, ctx.state.projects['sharejs-project'].id)
        const { created, projectId } = await throwaway(ctx, alice, token, 'history-paging')
        const steps = [created]
        const base = `/project/${projectId}`
        let writer = null
        try {
          writer = await socket(ctx, 'alice', alice, projectId)
          const join = joinOf(writer).project
          const second = await rest(ctx, alice, 'POST', `${base}/doc`, { token, body: { name: 'second.tex', parent_folder_id: join.rootFolder[0]._id }, user: 'alice' })
          steps.push(second)
          const docs = [join.rootDoc_id, second.body._id]
          const versions = {}
          const lengths = {}
          for (const docId of docs) {
            const reply = await writer.joinDoc(docId)
            versions[docId] = reply[2]
            lengths[docId] = reply[1].join('\n').length
          }
          const started = Date.now()
          const total = 2100
          for (let n = 0; n < total; n++) {
            const docId = docs[n % 2]
            await writer.update(docId, { doc: docId, op: [{ p: lengths[docId], i: n % 50 === 49 ? '\n' : 'x' }], v: versions[docId] })
            versions[docId] += 1
            lengths[docId] += 1
          }
          notes.push(`applied ${total} updates in ${Math.round((Date.now() - started) / 1000)} s`)
          await writer.close()
          const flushed = await rest(ctx, alice, 'POST', `${base}/flush`, { token, user: 'alice' })
          steps.push({ label: 'flush', ...flushed })
          await sleep(2000)
          const summary = step => ({
            label: step.label,
            status: step.status,
            updates: (step.body?.updates ?? []).map(update => `${update.fromV}-${update.toV} (${update.pathnames?.length ?? 0} paths, ${update.project_ops?.length ?? 0} project ops)`),
            nextBeforeTimestamp: step.body?.nextBeforeTimestamp ?? null,
          })
          const read = async (label, query) => {
            const step = { label, ...(await rest(ctx, alice, 'GET', `${base}/updates${query}`, { user: 'alice' })) }
            steps.push(step)
            notes.push(JSON.stringify(summary(step)))
            return step
          }
          const first = await read('min_count=1', '?min_count=1')
          const next = first.body?.nextBeforeTimestamp
          if (next != null) {
            await read('min_count=1, before=nextBeforeTimestamp', `?min_count=1&before=${next}`)
            await read('min_count=1, before=nextBeforeTimestamp - 1', `?min_count=1&before=${next - 1}`)
          }
          const latest = Math.max(...(first.body?.updates ?? []).map(update => update.toV))
          await read('min_count=1, before=the latest version', `?min_count=1&before=${latest}`)
          await read('min_count=1, before=the latest version - 10', `?min_count=1&before=${latest - 10}`)
          await read('min_count=2', '?min_count=2')
          await read('min_count=500', '?min_count=500')
          await read('no min_count (25 by default)', '')
          const chunks = await mongo(`
            const found = await db.projects.findOne({ _id: new ObjectId(${JSON.stringify(projectId)}) }, { projection: { 'overleaf.history.id': 1 } })
            return found.overleaf.history.id
          `)
          notes.push(`history id ${chunks}`)
        } finally {
          await writer?.close()
          steps.push(await rest(ctx, alice, 'DELETE', `/project/${projectId}`, { token }))
        }
        return steps
      },
    },
    'project-upload-create': {
      description:
        'Alice creates projects from ZIP uploads (POST /project/new/upload): a project with \\title and \\documentclass and files the server ignores, one with neither, one wrapped in a single top-level folder, an invalid ZIP, an empty ZIP and no file; then invalid uploads until the 20 per minute limit answers. Records each reply, the resulting names, root docs and trees, and the server upload limit. Created projects are deleted.',
      async run(ctx, notes) {
        const alice = await ctx.signInAs('alice')
        const token = await csrfFor(ctx.site, alice, ctx.state.projects['sharejs-project'].id)
        const steps = []
        const made = []
        const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8DwHwyBDAYGAMxuD/GKwdNJAAAAAElFTkSuQmCC', 'base64')
        const upload = async (label, name, bytes, withFile = true) => {
          const form = new FormData()
          form.append('name', name)
          if (withFile) form.append('qqfile', new Blob([bytes]), name)
          const step = await rest(ctx, alice, 'POST', '/project/new/upload', { token, form, user: 'alice' })
          step.request.upload = { name, bytes: withFile ? bytes.length : null }
          steps.push({ label, ...step })
          if (step.body?.project_id) made.push(step.body.project_id)
          return step
        }
        const describe = async (label, projectId) => {
          const client = await socket(ctx, 'alice', alice, projectId)
          const join = joinOf(client)?.project
          await client.close()
          const entities = await rest(ctx, alice, 'GET', `/project/${projectId}/entities`, { user: 'alice' })
          const rootPath = (() => {
            const walk = (folder, prefix) => {
              for (const doc of folder.docs ?? []) if (doc._id === join?.rootDoc_id) return `${prefix}${doc.name}`
              for (const child of folder.folders ?? []) {
                const found = walk(child, `${prefix}${child.name}/`)
                if (found) return found
              }
              return null
            }
            return join ? walk(join.rootFolder[0], '') : null
          })()
          const summary = { name: join?.name ?? null, rootDoc: rootPath, compiler: join?.compiler ?? null, entities: entities.body?.entities ?? entities.body }
          steps.push({ label: `${label}: the created project`, created: summary })
          notes.push(`${label}: ${JSON.stringify(summary)}`)
        }
        try {
          const limit = await webNode(`
            const { default: Settings } = await import('@overleaf/settings')
            console.log('OLEAFLY_LIMIT ' + JSON.stringify({ maxUploadSize: Settings.maxUploadSize, maxEntitiesPerProject: Settings.maxEntitiesPerProject, fileIgnorePattern: String(Settings.fileIgnorePattern ?? '') }))
            process.exit(0)
          `)
          const limits = JSON.parse(limit.split('\n').find(line => line.startsWith('OLEAFLY_LIMIT ')).slice(14))
          steps.push({ serverLimits: limits })
          notes.push(`server limits: ${JSON.stringify(limits)}`)
          const titled = zipOf([
            { name: 'main.tex', data: '\\documentclass{article}\n\\title{Uploaded From Oleafly}\n\\begin{document}\n\\maketitle\nHello.\n\\end{document}\n' },
            { name: 'refs.bib', data: '@book{key, title={T}}\n' },
            { name: 'figures/pixel.png', data: pixel },
            { name: 'main.bbl', data: 'ignored?' },
            { name: 'notes.docx', data: 'ignored?' },
            { name: 'build.log.gz', data: 'ignored?' },
            { name: '.DS_Store', data: 'ignored?' },
            { name: '__MACOSX/._main.tex', data: 'ignored?' },
            { name: 'sections/intro.tex', data: '\\section{Intro}\n' },
          ])
          const first = await upload('a titled project with ignored files', 'my-archive.zip', titled)
          if (first.body?.project_id) await describe('titled', first.body.project_id)
          const plain = zipOf([
            { name: 'notes.tex', data: 'No preamble here.\n' },
            { name: 'paper.tex', data: '\\documentclass{article}\n\\begin{document}\nPaper.\n\\end{document}\n' },
          ])
          const second = await upload('no \\title, the root is the doc with \\documentclass', 'Untitled Upload.zip', plain)
          if (second.body?.project_id) await describe('untitled', second.body.project_id)
          const again = await upload('the same name again', 'Untitled Upload.zip', plain)
          if (again.body?.project_id) await describe('same name', again.body.project_id)
          const wrapped = zipOf([
            { name: 'repo-main/main.tex', data: '\\documentclass{article}\n\\begin{document}\nWrapped.\n\\end{document}\n' },
            { name: 'repo-main/img/pixel.png', data: pixel },
          ])
          const third = await upload('a single top-level folder', 'repo-main.zip', wrapped)
          if (third.body?.project_id) await describe('wrapped', third.body.project_id)
          const noTex = zipOf([{ name: 'readme.md', data: '# No TeX here\n' }])
          const fourth = await upload('no tex file at all', 'readme-only.zip', noTex)
          if (fourth.body?.project_id) await describe('no tex', fourth.body.project_id)
          await upload('not a zip', 'garbage.zip', Buffer.from('this is not a zip file at all'))
          await upload('an empty zip', 'empty.zip', zipOf([]))
          await upload('no file', 'nothing.zip', Buffer.alloc(0), false)
          for (let attempt = 1; attempt <= 25; attempt++) {
            const step = await upload(`invalid upload ${attempt} for the rate limit`, 'garbage.zip', Buffer.from('not a zip'))
            if (step.status === 429) {
              notes.push(`upload attempt ${attempt} of the burst answered 429 ${JSON.stringify(step.body)} headers ${JSON.stringify(step.headers)}`)
              break
            }
          }
          notes.push(`replies: ${steps.filter(step => step.request?.route === '/project/new/upload').map(step => `${step.label.slice(0, 40)} ${step.status} ${JSON.stringify(step.body).slice(0, 120)}`).slice(0, 9).join(' | ')}`)
        } finally {
          for (const projectId of made) steps.push(await rest(ctx, alice, 'DELETE', `/project/${projectId}`, { token }))
        }
        return steps
      },
    },
    'linked-files': {
      description:
        'Alice makes a source project and a target project (Bob editor, Carol reviewer, Dave viewer on the target, added in the container) and links sample.bib from the source into the target (provider project_file), then a compiled output.log (provider project_output_file) and a URL (provider url, not enabled on this harness). Bob watches the target. She edits the source and refreshes the link; refreshes of an unknown id, an ordinary file, by each role; the join\'s linkedFileData. Both projects are deleted.',
      async run(ctx, notes) {
        const alice = await ctx.signInAs('alice')
        const anyToken = await csrfFor(ctx.site, alice, ctx.state.projects['sharejs-project'].id)
        const source = await throwaway(ctx, alice, anyToken, 'linked-source', 'example')
        const target = await throwaway(ctx, alice, anyToken, 'linked-target', 'example')
        const steps = [source.created, target.created]
        const users = ctx.state.users
        const base = `/project/${target.projectId}`
        let bob = null
        try {
          for (const [who, level] of [['bob', 'readAndWrite'], ['carol', 'review'], ['dave', 'readOnly']]) await addMember(target.projectId, users.alice.id, users[who].id, level)
          const jars = { alice }
          const tokens = {}
          for (const who of ['bob', 'carol', 'dave']) jars[who] = await ctx.signInAs(who)
          for (const who of ['alice', 'bob', 'carol', 'dave']) tokens[who] = (await page(ctx, jars[who], base)).token
          const enabled = await webNode(`
            const { default: Settings } = await import('@overleaf/settings')
            console.log('OLEAFLY_LINKED ' + JSON.stringify({ enabledLinkedFileTypes: Settings.enabledLinkedFileTypes, linkedUrlProxy: Settings.apis?.linkedUrlProxy?.url ?? null }))
            process.exit(0)
          `)
          const linked = JSON.parse(enabled.split('\n').find(line => line.startsWith('OLEAFLY_LINKED ')).slice(15))
          steps.push({ serverSettings: linked })
          notes.push(`linked file settings: ${JSON.stringify(linked)}`)
          bob = await socket(ctx, 'bob', jars.bob, target.projectId)
          const root = joinOf(bob).project.rootFolder[0]
          const create = async (label, body, who = 'alice') => {
            const step = await watchStep(ctx, [bob], label, () => rest(ctx, jars[who], 'POST', `${base}/linked_file`, { token: tokens[who], body, user: who }), { quiet: 2000 })
            steps.push(step)
            notes.push(`${label}: ${step.status} ${JSON.stringify(step.body).slice(0, 200)}; bob saw ${JSON.stringify(step.events.bob.map(event => [event.name, event.args]))}`)
            return step
          }
          const first = await create('alice links sample.bib from the source', { name: 'linked.bib', parent_folder_id: root._id, provider: 'project_file', data: { source_project_id: source.projectId, source_entity_path: '/sample.bib' } })
          await create('alice links frog.jpg (a binary) from the source', { name: 'linked-frog.jpg', parent_folder_id: root._id, provider: 'project_file', data: { source_project_id: source.projectId, source_entity_path: '/frog.jpg' } })
          await create('alice links a path the source does not have', { name: 'missing.bib', parent_folder_id: root._id, provider: 'project_file', data: { source_project_id: source.projectId, source_entity_path: '/nope.bib' } })
          await create('bob (no access to the source) links sample.bib', { name: 'bob-linked.bib', parent_folder_id: root._id, provider: 'project_file', data: { source_project_id: source.projectId, source_entity_path: '/sample.bib' } }, 'bob')
          await create('alice links a URL (provider url)', { name: 'from-url.bib', parent_folder_id: root._id, provider: 'url', data: { url: 'https://example.test/refs.bib' } })
          const compiled = await rest(ctx, alice, 'POST', `/project/${source.projectId}/compile`, { token: anyToken, body: { draft: false, check: 'silent', incrementalCompilesEnabled: true, stopOnFirstError: false }, user: 'alice' })
          steps.push({ label: 'alice compiles the source', ...compiled, body: typeof compiled.body === 'object' ? { status: compiled.body.status, outputFiles: (compiled.body.outputFiles ?? []).map(file => file.path), buildId: compiled.body.outputFiles?.[0]?.build ?? null } : compiled.body })
          notes.push(`source compile: ${compiled.status} ${compiled.body?.status}`)
          const buildId = compiled.body?.outputFiles?.find(file => file.path === 'output.log')?.build
          await create('alice links the source output.log (provider project_output_file)', { name: 'source-output.log', parent_folder_id: root._id, provider: 'project_output_file', data: { source_project_id: source.projectId, source_output_file_path: 'output.log', ...(buildId ? { build_id: buildId } : {}) } })
          const joined = await socket(ctx, 'alice', alice, target.projectId)
          const files = joinOf(joined).project.rootFolder[0].fileRefs.map(file => ({ name: file.name, linkedFileData: file.linkedFileData ?? null, keys: Object.keys(file) }))
          await joined.close()
          steps.push({ join: { fileRefs: files } })
          notes.push(`the join's fileRefs: ${JSON.stringify(files)}`)
          const fileId = first.body?.new_file_id
          const sourceClient = await socket(ctx, 'alice', alice, source.projectId)
          const bibId = joinOf(sourceClient).project.rootFolder[0].docs.find(doc => doc.name === 'sample.bib')?._id
          const reply = await sourceClient.joinDoc(bibId)
          await sourceClient.update(bibId, { doc: bibId, op: [{ p: 0, i: '% edited in the source\n' }], v: reply[2] })
          await sleep(1000)
          await sourceClient.close()
          const refresh = async (label, who, id, body = {}) => {
            const step = await watchStep(ctx, [bob], label, () => rest(ctx, jars[who], 'POST', `${base}/linked_file/${id}/refresh`, { token: tokens[who], body, user: who }), { quiet: 2000 })
            steps.push(step)
            notes.push(`${label}: ${step.status} ${JSON.stringify(step.body).slice(0, 200)}; bob saw ${JSON.stringify(step.events.bob.map(event => [event.name, event.args.slice(0, 2), `+${event.t - step.sentAt}ms`]))}`)
            return step
          }
          const refreshed = await refresh('alice refreshes linked.bib after the source changed', 'alice', fileId)
          const newId = refreshed.body?.new_file_id ?? fileId
          await refresh('alice refreshes it again with {shouldReindexReferences: true}', 'alice', newId, { shouldReindexReferences: true })
          const latestId = steps.at(-1).body?.new_file_id ?? newId
          await refresh('alice refreshes the old (replaced) file id', 'alice', fileId)
          await refresh('alice refreshes an unknown id', 'alice', objectId())
          const plain = joinOf(bob).project.rootFolder[0].fileRefs.find(file => !file.linkedFileData)
          if (plain) await refresh(`alice refreshes an ordinary file (${plain.name})`, 'alice', plain._id)
          await refresh('bob (editor without access to the source) refreshes', 'bob', latestId)
          await refresh('carol (reviewer) refreshes', 'carol', latestId)
          await refresh('dave (viewer) refreshes', 'dave', latestId)
          await refresh('alice refreshes with an unknown body key', 'alice', latestId, { extra: true })
          await bob.close()
          steps.push({ socket: { user: 'bob', projectId: target.projectId, transport: 'websocket', frames: bob.frames } })
        } finally {
          await bob?.close()
          steps.push(await rest(ctx, alice, 'DELETE', `/project/${target.projectId}`, { token: anyToken }))
          steps.push(await rest(ctx, alice, 'DELETE', `/project/${source.projectId}`, { token: anyToken }))
        }
        return steps
      },
    },
    'spelling-learned-words': {
      description:
        'Bob learns and unlearns words (POST /spelling/learn and /spelling/unlearn) and reloads the editor page each time to read ol-learnedWords; duplicates, case, a non-ASCII word, an empty word, an unknown key, an unknown word to unlearn, whether any GET route reads the dictionary, and whether a learn reaches the room. His dictionary is put back at the end.',
      async run(ctx, notes) {
        const project = ctx.state.projects['sharejs-project']
        const base = `/project/${project.id}`
        const bob = await ctx.signInAs('bob')
        const watcherJar = await ctx.signInAs('alice')
        const listener = await socket(ctx, 'alice', watcherJar, project.id)
        const steps = []
        const words = async label => {
          const editor = await page(ctx, bob, base)
          const meta = metaOf(editor.html, /learnedWords|spellCheck|languages/)
          if (Array.isArray(meta['ol-languages']?.value)) {
            meta['ol-languages'].count = meta['ol-languages'].value.length
            meta['ol-languages'].value = meta['ol-languages'].value.slice(0, 3)
          }
          steps.push({ label, page: { user: 'bob', route: base, status: editor.status, meta } })
          return { token: editor.token, learned: meta['ol-learnedWords']?.value ?? null }
        }
        const first = await words('the editor page before')
        const original = Array.isArray(first.learned) ? first.learned : []
        notes.push(`ol-learnedWords before: ${JSON.stringify(first.learned)}`)
        const token = first.token
        const call = async (label, route, body) => {
          const step = await rest(ctx, bob, 'POST', route, { token, body, user: 'bob' })
          steps.push({ label, ...step })
          return step
        }
        try {
          await call('learn Oleaflyish', '/spelling/learn', { word: 'Oleaflyish' })
          await call('learn Oleaflyish again', '/spelling/learn', { word: 'Oleaflyish' })
          await call('learn oleaflyish (lower case)', '/spelling/learn', { word: 'oleaflyish' })
          await call('learn Größenordnungsx', '/spelling/learn', { word: 'Größenordnungsx' })
          await call('learn two words with a space', '/spelling/learn', { word: 'two words' })
          const learned = await words('the editor page after learning')
          notes.push(`ol-learnedWords after learning: ${JSON.stringify(learned.learned)}`)
          await call('learn an empty word', '/spelling/learn', { word: '' })
          await call('learn with no word', '/spelling/learn', {})
          await call('learn with an unknown key', '/spelling/learn', { word: 'Strictly', extra: 1 })
          const noToken = await rest(ctx, bob, 'POST', '/spelling/learn', { body: { word: 'NoToken' }, user: 'bob' })
          steps.push({ label: 'learn without the anti-forgery header', ...noToken })
          await call('unlearn oleaflyish', '/spelling/unlearn', { word: 'oleaflyish' })
          await call('unlearn a word never learned', '/spelling/unlearn', { word: 'Neverlearned' })
          const afterOne = await words('the editor page after unlearning one')
          notes.push(`after unlearning oleaflyish: ${JSON.stringify(afterOne.learned)}`)
          for (const route of ['/spelling/learn', '/spelling/unlearn', '/spelling/dict', '/user/dictionary', '/spelling/check']) {
            steps.push({ label: `GET ${route}`, ...(await rest(ctx, bob, 'GET', route, { user: 'bob' })) })
          }
          notes.push(`GET routes: ${steps.slice(-5).map(step => `${step.request.route} ${step.status}`).join(', ')}`)
          const anonymous = await rest(ctx, null, 'POST', '/spelling/learn', { body: { word: 'Anonymous' } })
          steps.push({ label: 'learn with no session', ...anonymous })
          const roomEvents = otherEvents(listener)
          notes.push(`events alice received while bob learned words: ${JSON.stringify(roomEvents)}`)
        } finally {
          const now = (await words('the editor page before putting back')).learned ?? []
          for (const word of now.filter(word => !original.includes(word))) await call(`put back: unlearn ${word}`, '/spelling/unlearn', { word })
          const back = await words('the editor page after putting back')
          notes.push(`after putting back: ${JSON.stringify(back.learned)}`)
          await listener.close()
        }
        return steps
      },
    },
    'online-user-hues': {
      description:
        "Alice and Bob open main.tex in CE's web editor; Carol and Dave connect as scripted clients and report cursor positions in main.tex. Reads the online-users widget circles and the remote cursor markers in Alice's and Bob's editors and records the hue each one was drawn in, read back from its colour, with the user it belongs to.",
      async run(ctx, notes) {
        const project = ctx.state.projects['sharejs-project']
        const users = ctx.state.users
        const env = ctx.env
        const browser = await chromium.launch()
        const scratch = await fs.mkdtemp(path.join(here, '.recording-'))
        const people = []
        const scripted = []
        const steps = []
        try {
          for (const who of ['alice', 'bob']) {
            const person = new Participant(who, ctx.clock)
            await person.start(browser, ctx.site, users[who].email, env[`${who.toUpperCase()}_PASSWORD`], path.join(scratch, `${who}.har`), ctx.secrets)
            await person.openProject(ctx.site, project.id)
            await person.openDoc('main.tex', project.rootDocId)
            people.push(person)
          }
          for (const who of ['carol', 'dave']) {
            const client = new ScriptedClient(who, ctx.clock)
            await client.open(ctx.site, await ctx.signInAs(who), project.id, ctx.secrets, { websocket: true })
            await client.outcome()
            await client.joinDoc(project.rootDocId)
            await client.send(`5:::${JSON.stringify({ name: 'clientTracking.updatePosition', args: [{ row: who === 'carol' ? 1 : 2, column: 2, doc_id: project.rootDocId }] })}`)
            scripted.push(client)
          }
          await people[1].cursor(5)
          await people[0].cursor(12)
          await sleep(4000)
          for (const person of people) {
            const seen = await person.page.evaluate(() => ({
              circles: [...document.querySelectorAll('.online-users-row .online-user-circle')].map(circle => ({
                text: circle.textContent,
                inline: circle.getAttribute('style'),
                computed: getComputedStyle(circle).backgroundColor,
              })),
              cursors: [...document.querySelectorAll('.ol-cm-cursorHighlight')].map(marker => ({
                hue: marker.style.getPropertyValue('--hue'),
                computed: getComputedStyle(marker).borderLeftColor,
              })),
            }))
            const byInitial = Object.fromEntries(['alice', 'bob', 'carol', 'dave'].map(who => [who[0].toUpperCase(), who]))
            const circles = seen.circles.map(circle => {
              const user = byInitial[circle.text?.trim()?.[0]?.toUpperCase()] ?? null
              return { ...circle, user, userId: user ? users[user].id : null, hue: hueDrawnAs(circle.computed) }
            })
            const cursors = seen.cursors.map(cursor => {
              const owners = circles.filter(circle => circle.hue === Number(cursor.hue))
              const user = owners.length === 1 ? owners[0].user : null
              return { ...cursor, user, userId: user ? users[user].id : null, drawnInItsHue: cursor.computed === hslToRgb(Number(cursor.hue), 70, 50) }
            })
            steps.push({ viewer: person.name, viewerId: users[person.name].id, circles, cursors })
            notes.push(`${person.name} sees circles ${JSON.stringify(circles.map(circle => `${circle.user}:${circle.hue}`))} and cursors ${JSON.stringify(cursors.map(cursor => `${cursor.user}:${cursor.hue}${cursor.drawnInItsHue ? '' : ' not drawn in its hue'}`))}`)
          }
        } finally {
          for (const client of scripted) await client.close()
          for (const person of people) await person.context?.close().catch(() => {})
          await browser.close()
          await fs.rm(scratch, { recursive: true, force: true })
        }
        return steps
      },
    },
  }

  return { probes, scenarios }
}
