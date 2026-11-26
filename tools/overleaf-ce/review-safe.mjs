const safeBase = 'Keep this sentence. Remove this word please.\nAnother line to change here.\nThird line with more words.\n'

export function reviewSafe(kit) {
  const { GateClient, signIn, webNode, addMember, toHistoryOT, httpStep, csrfFor, stamp, sleep, at } = kit

  const signInAs = ({ site, state, env, secrets }, who) =>
    signIn(site, state.users[who].email, env[`${who.toUpperCase()}_PASSWORD`], secrets)

  function throwaway(format) {
    return async context => {
      const { site, state, secrets } = context
      const alice = await signInAs(context, 'alice')
      const token = await csrfFor(site, alice, state.projects['sharejs-project'].id)
      const created = await httpStep(site, alice, 'POST', '/project/new', {
        token,
        secrets,
        body: { projectName: `review-safe-${format}-${stamp()}`, template: 'none' },
      })
      const id = created.body.project_id
      if (!id) throw new Error(`no throwaway project: ${JSON.stringify(created)}`)
      const remove = () => httpStep(site, alice, 'DELETE', `/project/${id}`, { token, secrets })
      try {
        if (format === 'history-ot') await toHistoryOT(id)
        for (const [who, level] of [
          ['bob', 'readAndWrite'],
          ['carol', 'review'],
          ['dave', 'readOnly'],
        ]) {
          await addMember(id, state.users.alice.id, state.users[who].id, level)
        }
        return { id, format, rootFolderId: await rootFolderOf(id), cleanup: remove }
      } catch (error) {
        await remove()
        throw error
      }
    }
  }

  async function rootFolderOf(projectId) {
    const output = await webNode(`
      const { db, ObjectId } = await import('/overleaf/services/web/app/src/infrastructure/mongodb.mjs')
      const project = await db.projects.findOne({ _id: new ObjectId(${JSON.stringify(projectId)}) }, { projection: { rootFolder: 1 } })
      console.log('OLEAFLY_ROOT ' + project.rootFolder[0]._id.toString())
      process.exit(0)
    `)
    const root = output.match(/OLEAFLY_ROOT ([0-9a-f]{24})/)?.[1]
    if (!root) throw new Error(`no root folder for ${projectId}: ${output}`)
    return root
  }

  async function gates(context, doc) {
    const started = {}
    try {
      for (const [who, carrier] of [
        ['carol', 'xhr-polling'],
        ['bob', 'websocket'],
      ]) {
        started[who] = await new GateClient(who).start(context.state.site, doc.projectId, await signInAs(context, who), carrier)
        await started[who].send('connect')
        await started[who].send('open', { doc: doc.id })
      }
      await started.carol.send('review', { ts: new Date().toISOString() })
      return started
    } catch (error) {
      await stopAll(started)
      throw error
    }
  }

  async function settled(gates) {
    for (const gate of Object.values(gates)) {
      const result = await gate.send('settle', { quietMs: 1500, limitMs: 60000 })
      if (!result.settled) throw new Error(`${gate.name}'s live doc did not settle`)
    }
  }

  async function gateText(gate, doc) {
    return (await gate.doc(doc.id)).text
  }

  async function changeId(gate, doc, kind, text) {
    const { changes } = await gate.send('ranges', { doc: doc.id })
    const found = changes.find(change => change.kind === kind && change.text === text)
    if (!found) throw new Error(`no ${kind} of ${JSON.stringify(text)} in ${JSON.stringify(changes)}`)
    return found.id
  }

  async function health(gates, notes) {
    for (const gate of Object.values(gates)) {
      const { health, connected } = await gate.send('health')
      const trouble = [...health.updateErrors, ...health.refusals, ...health.drops, ...health.unexpected]
      notes.push(`${gate.name}'s live doc client: connected ${connected}, problems ${JSON.stringify(trouble)}`)
      if (!connected || trouble.length) throw new Error(`${gate.name}'s live doc client had trouble: ${JSON.stringify(health)}`)
    }
  }

  async function stopAll(gates) {
    for (const gate of Object.values(gates)) await gate.stop().catch(() => {})
  }

  return {
    'history-ot-reject-safe': {
      description:
        "Rejecting tracked deletions on a history-ot doc the way the live doc client now does it: a plain copy of the hidden text at the deletion, with the commentIds of every comment over it, and a raw delete of the hidden span in the same text operation. Carol (reviewer) and Bob (editor) are the Rust live doc client (live_doc_gate), Alice watches in the CE web editor, Dave listens on a scripted websocket. Carol deletes a commented word and two more words with tracking, Bob rejects one deletion and then two in one operation, and Alice types at the end. The CE web editor stays in sync throughout (compare history-ot-reject step 9, where clearing the tracking desynced it). Recorded on a throwaway project that is deleted at the end.",
      project: 'throwaway history-ot project',
      prepare: throwaway('history-ot'),
      people: ['alice'],
      scripted: ['dave'],
      transport: 'websocket',
      server: true,
      async run({ alice, dave, review, settle, doc, notes, context }) {
        await alice.change({ from: 0, insert: safeBase })
        await settle()
        await review.join(dave)
        await review.capture('alice types the base text', { who: 'alice' })
        const clients = await gates(context, doc)
        try {
          const { bob, carol } = clients
          const text = await gateText(bob, doc)
          const commented = at(text, 'this word please')
          const { thread } = await bob.send('comment', { doc: doc.id, from: commented, to: commented + 'this word please'.length })
          await settled(clients)
          await review.capture('bob (live doc client) comments on "this word please"', { who: 'bob', thread })
          await carol.send('delete', { doc: doc.id, at: at(await gateText(carol, doc), 'word '), length: 'word '.length })
          await settled(clients)
          await review.capture('carol (live doc client, reviewer) deletes the commented "word " with tracking', { who: 'carol' })
          await carol.send('delete', { doc: doc.id, at: at(await gateText(carol, doc), 'change '), length: 'change '.length })
          await settled(clients)
          await carol.send('delete', { doc: doc.id, at: at(await gateText(carol, doc), 'more '), length: 'more '.length })
          await settled(clients)
          await review.capture('carol deletes "change " and "more " with tracking', { who: 'carol' })
          const word = await changeId(bob, doc, 'Delete', 'word ')
          await bob.send('decide', { doc: doc.id, ids: [word], decision: 'reject' })
          await settled(clients)
          await review.capture('bob rejects the deletion of the commented "word " with a plain copy and a raw delete', { who: 'bob', ids: [word] })
          const both = [await changeId(bob, doc, 'Delete', 'change '), await changeId(bob, doc, 'Delete', 'more ')]
          await bob.send('decide', { doc: doc.id, ids: both, decision: 'reject' })
          await settled(clients)
          await review.capture('bob rejects the deletions of "change " and "more " in one text operation', { who: 'bob', ids: both })
          await review.edit(alice, 'alice types at the end of line 1 after the rejects', current => ({
            from: at(current, 'please.', 'please.'.length),
            insert: ' Alice was here.',
          }))
          await sleep(1500)
          await settled(clients)
          await review.capture('everyone agrees after alice typed', { who: 'alice' })
          await health(clients, notes)
        } finally {
          await stopAll(clients)
        }
      },
    },
    'sharejs-accept-by-ops': {
      description:
        'Accepting tracked changes on a ShareJS doc without the review module, the way the live doc client now does it: an accepted insert is a plain copy after the text and a plain delete of the tracked text, an accepted delete is a re-insert with u and a plain delete, all in one update, followed by a re-anchor of every comment over an accepted insert. Carol (reviewer) and Bob (editor) are the Rust live doc client (live_doc_gate), Alice watches in the CE web editor, Dave listens on a scripted websocket. Carol suggests an insert and two deletes, Bob comments over the inserted text and accepts the insert and the delete after it. Recorded on a throwaway project that is deleted at the end.',
      project: 'throwaway ShareJS project',
      prepare: throwaway('sharejs-text-ot'),
      people: ['alice'],
      scripted: ['dave'],
      transport: 'websocket',
      server: true,
      async run({ alice, dave, review, settle, doc, notes, context }) {
        await alice.change({ from: 0, insert: safeBase })
        await settle()
        await review.join(dave)
        await review.capture('alice types the base text', { who: 'alice' })
        const clients = await gates(context, doc)
        try {
          const { bob, carol } = clients
          await carol.send('type', { doc: doc.id, at: at(await gateText(carol, doc), 'sentence'), text: 'whole ' })
          await settled(clients)
          await carol.send('delete', { doc: doc.id, at: at(await gateText(carol, doc), 'sentence'), length: 'sentence'.length })
          await settled(clients)
          await carol.send('delete', { doc: doc.id, at: at(await gateText(carol, doc), 'change '), length: 'change '.length })
          await settled(clients)
          await review.capture('carol (live doc client, reviewer) inserts "whole " and deletes "sentence" and "change " with tracking', { who: 'carol' })
          const text = await gateText(bob, doc)
          const from = at(text, 'Keep this whole')
          const { thread } = await bob.send('comment', { doc: doc.id, from: from + 'Keep this '.length, to: from + 'Keep this whole'.length })
          await settled(clients)
          await review.capture('bob (live doc client) comments on "whole", the inserted text', { who: 'bob', thread })
          const ids = [await changeId(bob, doc, 'Insert', 'whole '), await changeId(bob, doc, 'Delete', 'sentence')]
          const decided = await bob.send('decide', { doc: doc.id, ids, decision: 'accept' })
          if (decided.by !== 'op') throw new Error(`the accept went through ${decided.by}, not ops`)
          await settled(clients)
          await review.capture('bob accepts the insert "whole " and the delete "sentence" by ops and re-anchors the comment', { who: 'bob', ids, thread })
          await review.edit(alice, 'alice types at the end of line 1 after the accept', current => ({
            from: at(current, 'please.', 'please.'.length),
            insert: ' Alice was here.',
          }))
          await sleep(1500)
          await settled(clients)
          await review.capture('everyone agrees after alice typed', { who: 'alice' })
          await health(clients, notes)
        } finally {
          await stopAll(clients)
        }
      },
    },
  }
}
