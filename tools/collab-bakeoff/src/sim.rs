use std::collections::BTreeMap;

use crate::check::{self, Outcome, Verdict};
use crate::engine::{Engine, EngineError, NewNode};
use crate::rng::Rng;
use crate::trace::{Cut, Injection, Op, Scenario};
use crate::utf16;

pub const MALICIOUS_ACTOR: usize = usize::MAX;
pub const REPLAY_ACTOR: usize = 990;

pub fn peer_id(actor: usize, incarnation: u64) -> u64 {
    (actor as u64 + 1) * 1_000 + incarnation
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Batch {
    pub seq: u64,
    pub from: usize,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredSnapshot {
    pub upto: u64,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refused {
    TooLarge { size: usize, cap: usize },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Gap;

#[derive(Clone, Debug)]
pub struct Server {
    pub log: Vec<Batch>,
    pub next_seq: u64,
    pub snapshots: Vec<StoredSnapshot>,
    pub cap: usize,
    pub corrupt_next_from: Option<usize>,
}

impl Server {
    pub fn new(genesis: Vec<u8>, cap: usize) -> Server {
        Server {
            log: Vec::new(),
            next_seq: 0,
            snapshots: vec![StoredSnapshot {
                upto: 0,
                bytes: genesis,
            }],
            cap,
            corrupt_next_from: None,
        }
    }

    pub fn submit(&mut self, from: usize, bytes: Vec<u8>) -> Result<u64, Refused> {
        if bytes.len() > self.cap {
            return Err(Refused::TooLarge {
                size: bytes.len(),
                cap: self.cap,
            });
        }
        let mut stored = bytes;
        if self.corrupt_next_from == Some(from) {
            flip_middle(&mut stored);
            self.corrupt_next_from = None;
        }
        let seq = self.next_seq;
        self.next_seq += 1;
        self.log.push(Batch {
            seq,
            from,
            bytes: stored,
        });
        Ok(seq)
    }

    pub fn oldest_retained(&self) -> u64 {
        self.snapshots.first().map_or(0, |snapshot| snapshot.upto)
    }

    pub fn newest_snapshot(&self) -> Option<&StoredSnapshot> {
        self.snapshots.last()
    }

    pub fn since(&self, cursor: u64) -> Result<Vec<Batch>, Gap> {
        if cursor < self.oldest_retained() {
            return Err(Gap);
        }
        Ok(self
            .log
            .iter()
            .filter(|batch| batch.seq >= cursor)
            .cloned()
            .collect())
    }

    pub fn store_snapshot(&mut self, upto: u64, bytes: Vec<u8>) {
        self.snapshots.push(StoredSnapshot { upto, bytes });
        while self.snapshots.len() > 2 {
            self.snapshots.remove(0);
        }
        let keep_from = self.oldest_retained();
        self.log.retain(|batch| batch.seq >= keep_from);
    }
}

fn flip_middle(bytes: &mut [u8]) {
    if !bytes.is_empty() {
        let middle = bytes.len() / 2;
        bytes[middle] ^= 0x20;
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiskImage {
    pub bytes: Vec<u8>,
    pub sent: Vec<u8>,
    pub cursor: u64,
}

pub struct Replica<E> {
    pub actor: usize,
    pub incarnation: u64,
    pub engine: E,
    pub online: bool,
    pub dirty: bool,
    pub sent: Vec<u8>,
    pub cursor: u64,
    pub disk: Option<DiskImage>,
    pub reverse_next_pull: bool,
    pub errors: Vec<String>,
    pub pending: bool,
}

impl<E: Engine> Replica<E> {
    pub fn new(
        actor: usize,
        incarnation: u64,
        engine: E,
        sent: Vec<u8>,
        cursor: u64,
    ) -> Replica<E> {
        Replica {
            actor,
            incarnation,
            engine,
            online: true,
            dirty: false,
            sent,
            cursor,
            disk: None,
            reverse_next_pull: false,
            errors: Vec::new(),
            pending: false,
        }
    }
}

pub fn resolve_edit(text: &str, at: u64, delete: u64) -> (usize, usize) {
    let len = utf16::utf16_len(text);
    let start = utf16::snap_back(text, (at % (len as u64 + 1)) as usize);
    let end = utf16::snap_back(text, start.saturating_add(delete as usize).min(len));
    (start, end - start)
}

pub fn apply_local<E: Engine>(engine: &mut E, op: &Op) -> Result<(), EngineError> {
    match op {
        Op::Create {
            id,
            parent,
            name,
            kind,
            blob,
            text,
            ..
        } => engine.create_node(&NewNode {
            id,
            parent: parent.as_deref(),
            name,
            kind: *kind,
            blob_hash: blob.as_deref(),
            text,
        }),
        Op::Rename { id, name, .. } => engine.rename(id, name),
        Op::Move { id, parent, .. } => engine.move_node(id, parent.as_deref()),
        Op::Trash { id, .. } => engine.trash(id),
        Op::Restore { id, parent, .. } => engine.restore(id, parent.as_deref()),
        Op::Edit {
            id,
            at,
            delete,
            insert,
            ..
        } => {
            let text = engine.text(id)?;
            let (pos, delete) = resolve_edit(&text, *at, *delete);
            engine.splice_utf16(id, pos, delete, insert)
        }
        Op::Splice {
            id,
            pos,
            delete,
            insert,
            ..
        } => engine.splice_utf16(id, *pos, *delete, insert),
        Op::Replace { id, text, .. } => {
            let current = engine.text(id)?;
            engine.splice_utf16(id, 0, utf16::utf16_len(&current), text)
        }
        _ => Ok(()),
    }
}

fn import_bytes<E: Engine>(replica: &mut Replica<E>, bytes: &[u8], what: &str) {
    match replica.engine.import(bytes) {
        Ok(imported) => replica.pending = imported.pending,
        Err(error) => replica.errors.push(format!("{what}: {error}")),
    }
}

fn pull<E: Engine>(replica: &mut Replica<E>, server: &Server) {
    let mut batches = match server.since(replica.cursor) {
        Ok(batches) => batches,
        Err(Gap) => match server.newest_snapshot() {
            Some(snapshot) => {
                import_bytes(replica, &snapshot.bytes, "snapshot");
                server.since(snapshot.upto).unwrap_or_default()
            }
            None => Vec::new(),
        },
    };
    if replica.reverse_next_pull {
        replica.reverse_next_pull = false;
        let forward = batches.clone();
        batches.reverse();
        batches.extend(forward);
    }
    for batch in &batches {
        import_bytes(replica, &batch.bytes, &format!("batch {}", batch.seq));
    }
    replica.cursor = server.next_seq;
}

fn flush<E: Engine>(
    replica: &mut Replica<E>,
    server: &mut Server,
    notes: &mut Vec<String>,
    acknowledge: bool,
) -> bool {
    if !replica.dirty {
        return true;
    }
    let bytes = match replica.engine.export_since(&replica.sent) {
        Ok(bytes) => bytes,
        Err(error) => {
            replica.errors.push(format!("export: {error}"));
            return false;
        }
    };
    match server.submit(replica.actor, bytes) {
        Ok(_) => {
            if acknowledge {
                replica.dirty = false;
            }
            acknowledge
        }
        Err(refused) => {
            notes.push(format!(
                "actor {} batch refused: {refused:?}",
                replica.actor
            ));
            false
        }
    }
}

fn fresh_replica<E: Engine>(
    server: &Server,
    actor: usize,
    incarnation: u64,
) -> Result<Replica<E>, EngineError> {
    let snapshot = server
        .newest_snapshot()
        .ok_or_else(|| EngineError::Decode("the server has no snapshot".to_owned()))?;
    let engine = E::load(&snapshot.bytes, peer_id(actor, incarnation))?;
    let mut replica = Replica::new(actor, incarnation, engine, Vec::new(), snapshot.upto);
    pull(&mut replica, server);
    replica.sent = replica.engine.version();
    Ok(replica)
}

pub struct Sim<E> {
    pub server: Server,
    pub replicas: BTreeMap<usize, Replica<E>>,
    pub rejected: Vec<String>,
    pub notes: Vec<String>,
}

impl<E: Engine> Sim<E> {
    pub fn start(scenario: &Scenario) -> Result<Sim<E>, EngineError> {
        let mut owner = E::new(peer_id(0, 0))?;
        for op in &scenario.setup {
            apply_local(&mut owner, op)?;
        }
        let genesis = owner.snapshot()?;
        let sent = owner.version();
        let mut sim = Sim {
            server: Server::new(genesis, scenario.cap),
            replicas: BTreeMap::new(),
            rejected: Vec::new(),
            notes: Vec::new(),
        };
        sim.replicas.insert(0, Replica::new(0, 0, owner, sent, 0));
        for actor in 1..scenario.actors {
            if !scenario.late.contains(&actor) {
                sim.join(actor)?;
            }
        }
        Ok(sim)
    }

    pub fn join(&mut self, actor: usize) -> Result<(), EngineError> {
        let incarnation = self
            .replicas
            .get(&actor)
            .map_or(0, |replica| replica.incarnation + 1);
        let replica = fresh_replica::<E>(&self.server, actor, incarnation)?;
        self.replicas.insert(actor, replica);
        Ok(())
    }

    pub fn apply(&mut self, op: &Op) {
        match op {
            Op::Sync { actor } => self.sync(*actor),
            Op::SyncAll => self.sync_all(),
            Op::Offline { actor } => self.set_online(*actor, false),
            Op::Online { actor } => self.set_online(*actor, true),
            Op::Compact { actor, shallow } => self.compact(*actor, *shallow),
            Op::Persist { actor } => self.persist(*actor),
            Op::Crash {
                actor,
                cut,
                reuse_peer,
            } => self.crash(*actor, *cut, *reuse_peer),
            Op::SendWithoutReceipt { actor } => self.send_without_receipt(*actor),
            Op::ReverseNextPull { actor } => {
                if let Some(replica) = self.replicas.get_mut(actor) {
                    replica.reverse_next_pull = true;
                }
            }
            Op::Join { actor } => {
                if let Err(error) = self.join(*actor) {
                    self.rejected.push(format!("join {actor}: {error}"));
                }
            }
            Op::Inject(injection) => self.inject(injection),
            Op::CorruptNext { actor } => self.server.corrupt_next_from = Some(*actor),
            Op::SetCap(cap) => self.server.cap = *cap,
            local => self.apply_local_op(local),
        }
    }

    fn apply_local_op(&mut self, op: &Op) {
        let Some(actor) = op.actor() else {
            return;
        };
        let Some(replica) = self.replicas.get_mut(&actor) else {
            self.rejected
                .push(format!("{}: actor {actor} has no replica", op.label()));
            return;
        };
        match apply_local(&mut replica.engine, op) {
            Ok(()) => replica.dirty = true,
            Err(error) => self.rejected.push(format!("{}: {error}", op.label())),
        }
    }

    pub fn sync(&mut self, actor: usize) {
        let Some(replica) = self.replicas.get_mut(&actor) else {
            return;
        };
        if !replica.online {
            return;
        }
        let flushed = flush(replica, &mut self.server, &mut self.notes, true);
        pull(replica, &self.server);
        if flushed {
            replica.sent = replica.engine.version();
        }
    }

    pub fn sync_all(&mut self) {
        let actors: Vec<usize> = self.replicas.keys().copied().collect();
        for _ in 0..2 {
            for actor in &actors {
                self.sync(*actor);
            }
        }
    }

    pub fn settle(&mut self) {
        for replica in self.replicas.values_mut() {
            replica.online = true;
        }
        self.sync_all();
    }

    fn set_online(&mut self, actor: usize, online: bool) {
        if let Some(replica) = self.replicas.get_mut(&actor) {
            replica.online = online;
        }
    }

    fn compact(&mut self, actor: usize, shallow: bool) {
        self.sync(actor);
        let Some(replica) = self.replicas.get(&actor) else {
            return;
        };
        if !replica.online {
            self.rejected
                .push(format!("compaction by offline actor {actor}"));
            return;
        }
        let produced = if shallow {
            replica.engine.compact()
        } else {
            replica.engine.snapshot()
        };
        match produced {
            Ok(bytes) => {
                let upto = self.server.next_seq;
                self.server.store_snapshot(upto, bytes);
            }
            Err(error) => self
                .notes
                .push(format!("compaction by {actor} failed: {error}")),
        }
    }

    fn persist(&mut self, actor: usize) {
        let Some(replica) = self.replicas.get_mut(&actor) else {
            return;
        };
        match replica.engine.save() {
            Ok(bytes) => {
                replica.disk = Some(DiskImage {
                    bytes,
                    sent: replica.sent.clone(),
                    cursor: replica.cursor,
                });
            }
            Err(error) => replica.errors.push(format!("save: {error}")),
        }
    }

    fn crash(&mut self, actor: usize, cut: Cut, reuse_peer: bool) {
        let Some(replica) = self.replicas.remove(&actor) else {
            return;
        };
        let incarnation = if reuse_peer {
            replica.incarnation
        } else {
            replica.incarnation + 1
        };
        let online = replica.online;
        let previous = replica.disk;
        let mut candidates: Vec<(String, DiskImage)> = Vec::new();
        if cut != Cut::BeforeSave {
            match replica.engine.save() {
                Ok(bytes) if cut == Cut::Clean => candidates.push((
                    "clean save".to_owned(),
                    DiskImage {
                        bytes,
                        sent: replica.sent.clone(),
                        cursor: replica.cursor,
                    },
                )),
                Ok(bytes) => {
                    let (sent, cursor) = previous
                        .as_ref()
                        .map_or((Vec::new(), 0), |image| (image.sent.clone(), image.cursor));
                    candidates.push((
                        format!("torn save ({})", cut.slug()),
                        DiskImage {
                            bytes: cut.apply(&bytes),
                            sent,
                            cursor,
                        },
                    ));
                }
                Err(error) => self
                    .notes
                    .push(format!("actor {actor} could not save: {error}")),
            }
        }
        if let Some(image) = previous {
            candidates.push(("previous save".to_owned(), image));
        }
        for (label, image) in candidates {
            match E::load(&image.bytes, peer_id(actor, incarnation)) {
                Ok(engine) => {
                    if label.starts_with("torn") {
                        self.notes.push(format!("actor {actor} loaded a {label}"));
                    }
                    let mut restored =
                        Replica::new(actor, incarnation, engine, image.sent.clone(), image.cursor);
                    restored.online = online;
                    restored.dirty = true;
                    restored.disk = Some(image);
                    self.replicas.insert(actor, restored);
                    return;
                }
                Err(error) => self
                    .notes
                    .push(format!("actor {actor} could not load the {label}: {error}")),
            }
        }
        match fresh_replica::<E>(&self.server, actor, incarnation) {
            Ok(mut fresh) => {
                fresh.online = online;
                self.notes
                    .push(format!("actor {actor} rejoined from the server"));
                self.replicas.insert(actor, fresh);
            }
            Err(error) => self
                .rejected
                .push(format!("actor {actor} could not rejoin: {error}")),
        }
    }

    fn send_without_receipt(&mut self, actor: usize) {
        let Some(replica) = self.replicas.get_mut(&actor) else {
            return;
        };
        if replica.online {
            flush(replica, &mut self.server, &mut self.notes, false);
        }
    }

    fn inject(&mut self, injection: &Injection) {
        let bytes = match injection {
            Injection::RandomBytes { len, seed } => {
                let mut rng = Rng::new(*seed);
                (0..*len).map(|_| rng.next_u64() as u8).collect()
            }
            Injection::Empty => Vec::new(),
            Injection::TruncatedLast => self
                .server
                .log
                .last()
                .map(|batch| batch.bytes[..batch.bytes.len() / 2].to_vec())
                .unwrap_or_default(),
        };
        if let Err(refused) = self.server.submit(MALICIOUS_ACTOR, bytes) {
            self.notes.push(format!("injection refused: {refused:?}"));
        }
    }
}

pub fn run<E: Engine>(scenario: &Scenario) -> Outcome {
    let mut sim = match Sim::<E>::start(scenario) {
        Ok(sim) => sim,
        Err(error) => {
            return Outcome::new(
                &scenario.name,
                E::NAME,
                Verdict::SetupError {
                    message: error.to_string(),
                },
            )
        }
    };
    for op in &scenario.ops {
        sim.apply(op);
    }
    sim.settle();
    check::evaluate(&sim, scenario)
}
