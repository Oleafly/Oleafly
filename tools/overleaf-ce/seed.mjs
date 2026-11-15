import crypto from 'node:crypto'
import fs from 'node:fs/promises'

const web = '/overleaf/services/web/app/src'
const load = async path => (await import(`${web}/${path}`)).default

const { db } = await import(`${web}/infrastructure/mongodb.mjs`)
const UserRegistrationHandler = await load('Features/User/UserRegistrationHandler.mjs')
const UserGetter = await load('Features/User/UserGetter.mjs')
const AuthenticationManager = await load('Features/Authentication/AuthenticationManager.mjs')
const ProjectCreationHandler = await load('Features/Project/ProjectCreationHandler.mjs')
const ProjectEntityUpdateHandler = await load('Features/Project/ProjectEntityUpdateHandler.mjs')
const CollaboratorsHandler = await load('Features/Collaborators/CollaboratorsHandler.mjs')
const { advanceOTMigrationStage } = await import(`${web}/Features/History/HistoryOTMigration.mjs`)

const site = 'http://127.0.0.1'
const migrationStage = 1

const users = [
  { key: 'alice', first: 'Alice', last: 'Owner' },
  { key: 'bob', first: 'Bob', last: 'Editor', privilege: 'readAndWrite' },
  { key: 'carol', first: 'Carol', last: 'Reviewer', privilege: 'review' },
  { key: 'dave', first: 'Dave', last: 'Viewer', privilege: 'readOnly' },
]

const projects = [
  { name: 'sharejs-project', format: 'sharejs-text-ot' },
  { name: 'history-ot-project', format: 'history-ot' },
]

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8DwHwyBDAYGAMxuD/GKwdNJAAAAAElFTkSuQmCC',
  'base64'
)

const say = line => console.log(`seed: ${line}`)

async function ensureUser({ key, first, last }) {
  const email = `${key}@example.test`
  const password = process.env[`${key.toUpperCase()}_PASSWORD`]
  if (!password) throw new Error(`${key.toUpperCase()}_PASSWORD is not set`)
  let user = await UserGetter.promises.getUserByAnyEmail(email)
  if (user) {
    try {
      await AuthenticationManager.promises.setUserPassword(user, password)
    } catch (error) {
      if (error.name !== 'PasswordMustBeDifferentError') throw error
    }
  } else {
    user = await UserRegistrationHandler.promises.registerNewUser({
      email,
      password,
      first_name: first,
      last_name: last,
      analyticsId: crypto.randomUUID(),
    })
    say(`created ${email}`)
  }
  return { key, email, password, id: user._id.toString() }
}

async function folderId(projectId, name, ownerId) {
  const project = await db.projects.findOne({ _id: projectId }, { projection: { rootFolder: 1 } })
  const root = project.rootFolder[0]
  const existing = root.folders.find(folder => folder.name === name)
  if (existing) return existing._id
  const { folder } = await ProjectEntityUpdateHandler.promises.addFolder(projectId, root._id, name, ownerId)
  return folder._id
}

async function ensureProject({ name }, owner) {
  const existing = await db.projects.findOne({ name, owner_ref: owner._id })
  if (existing) return existing._id
  const project = await ProjectCreationHandler.promises.createProjectFromSnippet(owner._id, name, [
    '\\documentclass{article}',
    '\\begin{document}',
    '\\input{sections/intro}',
    '\\input{sections/method}',
    '\\includegraphics{figure.png}',
    '\\bibliographystyle{plain}',
    '\\bibliography{refs}',
    '\\end{document}',
  ])
  const projectId = project._id
  const root = project.rootFolder[0]._id
  const sections = await folderId(projectId, 'sections', owner._id)
  const source = 'oleafly-harness'
  await ProjectEntityUpdateHandler.promises.addDoc(
    projectId,
    sections,
    'intro.tex',
    ['\\section{Introduction}', 'The first paragraph of the introduction.'],
    owner._id,
    source
  )
  await ProjectEntityUpdateHandler.promises.addDoc(
    projectId,
    sections,
    'method.tex',
    ['\\section{Method}', 'We describe the method here.'],
    owner._id,
    source
  )
  await ProjectEntityUpdateHandler.promises.addDoc(
    projectId,
    root,
    'refs.bib',
    ['@article{knuth1984,', '  title = {Literate Programming},', '  author = {Knuth, Donald E.},', '  year = {1984}', '}'],
    owner._id,
    source
  )
  const figure = `/tmp/oleafly-seed-${projectId}.png`
  await fs.writeFile(figure, png)
  await ProjectEntityUpdateHandler.promises.addFile(projectId, root, 'figure.png', figure, null, owner._id, source)
  await fs.rm(figure, { force: true })
  say(`created ${name}`)
  return projectId
}

async function ensureMember(projectId, owner, member, privilege) {
  const project = await db.projects.findOne(
    { _id: projectId },
    { projection: { collaberator_refs: 1, readOnly_refs: 1, reviewer_refs: 1 } }
  )
  const holders = {
    readAndWrite: project.collaberator_refs,
    readOnly: project.readOnly_refs,
    review: project.reviewer_refs,
  }[privilege]
  if ((holders || []).some(id => id.toString() === member.id)) return
  await CollaboratorsHandler.promises.addUserIdToProject(projectId, owner._id, member._id, privilege)
  say(`made ${member.email} ${privilege} on ${projectId}`)
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
  }
}

async function signIn(user) {
  const jar = cookieJar()
  const page = await fetch(`${site}/login`)
  jar.absorb(page)
  const html = await page.text()
  const token = html.match(/name="ol-csrfToken" content="([^"]+)"/)[1]
  const response = await fetch(`${site}/login`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', cookie: jar.header() },
    body: JSON.stringify({ email: user.email, password: user.password, _csrf: token }),
    redirect: 'manual',
  })
  jar.absorb(response)
  if (!response.ok) throw new Error(`sign-in as ${user.email} failed with HTTP ${response.status}`)
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

async function joinDocType(user, projectId, docId) {
  const jar = await signIn(user)
  const query = `projectId=${projectId}`
  const handshake = await fetch(`${site}/socket.io/1/?${query}&t=${Date.now()}`, {
    headers: { cookie: jar.header() },
  })
  jar.absorb(handshake)
  const sid = (await handshake.text()).split(':')[0]
  const channel = `${site}/socket.io/1/xhr-polling/${sid}?${query}`
  const send = body =>
    fetch(`${channel}&t=${Date.now()}`, {
      method: 'POST',
      headers: { cookie: jar.header(), 'content-type': 'text/plain;charset=UTF-8' },
      body,
    })
  let joinedProject = false
  let asked = false
  try {
    for (let round = 0; round < 30; round++) {
      const poll = await fetch(`${channel}&t=${Date.now()}`, { headers: { cookie: jar.header() } })
      for (const packet of packets(await poll.text())) {
        if (packet.startsWith('2::')) await send('2::')
        if (packet.startsWith('5:')) {
          const event = JSON.parse(packet.slice(packet.indexOf('{')))
          if (event.name === 'connectionRejected') {
            throw new Error(`connection rejected: ${JSON.stringify(event.args)}`)
          }
          if (event.name === 'joinProjectResponse') joinedProject = true
        }
        if (packet.startsWith('6:::1+')) {
          const reply = JSON.parse(packet.slice('6:::1+'.length))
          if (reply[0]) throw new Error(`joinDoc failed: ${JSON.stringify(reply[0])}`)
          return reply[5]
        }
      }
      if (joinedProject && !asked) {
        asked = true
        await send(
          `5:1+::${JSON.stringify({
            name: 'joinDoc',
            args: [docId, { encodeRanges: true, supportsHistoryOT: true }],
          })}`
        )
      }
    }
    throw new Error('joinDoc gave no reply')
  } finally {
    await send('0::')
  }
}

async function main() {
  const people = {}
  for (const user of users) {
    people[user.key] = await ensureUser(user)
  }
  const owner = await db.users.findOne({ email: people.alice.email })
  const state = {
    site: process.env.OVERLEAF_SITE_URL,
    users: Object.fromEntries(Object.values(people).map(({ key, email, id }) => [key, { email, id }])),
    projects: {},
  }
  for (const spec of projects) {
    const projectId = await ensureProject(spec, owner)
    for (const user of users.filter(user => user.privilege)) {
      const member = await db.users.findOne({ email: people[user.key].email })
      await ensureMember(projectId, owner, { ...people[user.key], _id: member._id }, user.privilege)
    }
    if (spec.format === 'history-ot') {
      const { otMigrationStage } = await advanceOTMigrationStage(projectId.toString(), migrationStage)
      say(`${spec.name} is at history-ot migration stage ${otMigrationStage}`)
    }
    const project = await db.projects.findOne({ _id: projectId })
    const docs = {}
    const walk = (folder, prefix) => {
      for (const doc of folder.docs) docs[`${prefix}${doc.name}`] = doc._id.toString()
      for (const child of folder.folders) walk(child, `${prefix}${child.name}/`)
    }
    walk(project.rootFolder[0], '')
    const type = await joinDocType(people.alice, projectId.toString(), project.rootDoc_id.toString())
    if (type !== spec.format) {
      throw new Error(`${spec.name} serves ${type} docs, expected ${spec.format}`)
    }
    say(`${spec.name} joinDoc reports type ${type}`)
    state.projects[spec.name] = {
      id: projectId.toString(),
      rootDocId: project.rootDoc_id.toString(),
      rootFolderId: project.rootFolder[0]._id.toString(),
      format: type,
      otMigrationStage: project.overleaf?.history?.otMigrationStage ?? 0,
      docs,
    }
  }
  console.log(`OLEAFLY_SEED_STATE ${JSON.stringify(state)}`)
}

try {
  await main()
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
