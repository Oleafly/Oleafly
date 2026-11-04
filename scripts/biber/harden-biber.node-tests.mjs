import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BIBER_PATCHES,
  applyEdits,
  confinedBinary,
  hardenBiber,
  stripPod,
} from "./harden-biber.mjs";

const LOADER = Buffer.from("\x7fELF pretend loader bytes");
const AFTER_PAYLOAD = Buffer.from("pretend code signature");
const CACHE_ID = "9bf697da8f1834d65eea2ce7445fb93676f9c5bd";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * A file laid out the way PAR::Packer writes one: loader, zip whose offsets
 * count from the start of the file, cache id, length, marker.
 */
function parFile(members, { tail = Buffer.alloc(0) } = {}) {
  const chunks = [LOADER];
  let offset = LOADER.length;
  const central = [];
  for (const [name, text] of members) {
    const raw = Buffer.from(text);
    const packed = deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc32(raw), 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    chunks.push(local, nameBytes, packed);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(offset + directory.length + end.length, 0);
  return Buffer.concat([
    ...chunks,
    directory,
    end,
    Buffer.from(`${CACHE_ID}\0CACHE`),
    length,
    Buffer.from("\nPAR.pm\n"),
    tail,
  ]);
}

/** Reads a member through the central directory, as Archive::Zip does. */
function member(file, name) {
  const marker = file.lastIndexOf("\nPAR.pm\n");
  const end = file.lastIndexOf(Buffer.from("PK\x05\x06"), marker);
  let at = file.readUInt32LE(end + 16);
  for (let index = 0; index < file.readUInt16LE(end + 10); index += 1) {
    const size = file.readUInt16LE(at + 28);
    const found = file.toString("utf8", at + 46, at + 46 + size);
    if (found === name) {
      const compressed = file.readUInt32LE(at + 20);
      const local = file.readUInt32LE(at + 42);
      const start =
        local + 30 + file.readUInt16LE(local + 26) + file.readUInt16LE(local + 28);
      const text = inflateRawSync(file.subarray(start, start + compressed));
      assert.equal(crc32(text), file.readUInt32LE(at + 16));
      assert.equal(text.length, file.readUInt32LE(at + 24));
      assert.equal(file.readUInt32LE(local + 14), file.readUInt32LE(at + 16));
      assert.equal(file.readUInt32LE(local + 18), compressed);
      assert.equal(file.readUInt32LE(local + 22), text.length);
      return text.toString();
    }
    at += 46 + size + file.readUInt16LE(at + 30) + file.readUInt16LE(at + 32);
  }
  throw new Error(`no member ${name}`);
}

const ORIGINAL = `my $x = evil();
1;

=head1 NAME

Long documentation that gives the patched text room. ${"Padding words. ".repeat(40)}

=cut
`;

const PATCHES = [
  {
    member: "lib/Sample.pm",
    sha256: sha256(ORIGINAL),
    edits: [["evil()", "safe()"]],
  },
];

test("a pinned member is rewritten in place with its checksums updated", () => {
  const file = parFile([
    ["lib/Other.pm", "keep me"],
    ["lib/Sample.pm", ORIGINAL],
  ]);
  const hardened = hardenBiber(file, PATCHES);

  assert.equal(hardened.length, file.length);
  assert.equal(member(hardened, "lib/Sample.pm"), "my $x = safe();\n1;\n\n");
  assert.equal(member(hardened, "lib/Other.pm"), "keep me");
});

test("the loader and whatever follows the payload stay byte for byte", () => {
  const tail = AFTER_PAYLOAD;
  const file = parFile([["lib/Sample.pm", ORIGINAL]], { tail });
  const hardened = hardenBiber(file, PATCHES);

  assert.deepEqual(hardened.subarray(0, LOADER.length), LOADER);
  assert.deepEqual(hardened.subarray(hardened.length - tail.length), tail);
});

test("the cache id changes so an unpacked older copy is never reused", () => {
  const file = parFile([["lib/Sample.pm", ORIGINAL]]);
  const hardened = hardenBiber(file, PATCHES);

  assert.ok(file.includes(CACHE_ID));
  assert.ok(!hardened.includes(CACHE_ID));
  const marker = hardened.lastIndexOf("\nPAR.pm\n");
  assert.match(
    hardened.toString("latin1", marker - 50, marker - 10),
    /^[0-9a-f]{40}$/u,
  );
});

test("the same input always gives the same output", () => {
  const file = parFile([["lib/Sample.pm", ORIGINAL]]);
  assert.deepEqual(hardenBiber(file, PATCHES), hardenBiber(file, PATCHES));
});

test("a member that differs from the pinned text is refused", () => {
  const file = parFile([["lib/Sample.pm", `${ORIGINAL}# changed\n`]]);
  assert.throws(() => hardenBiber(file, PATCHES), /lib\/Sample\.pm.*does not match/u);
});

test("a missing member is refused", () => {
  const file = parFile([["lib/Other.pm", "keep me"]]);
  assert.throws(() => hardenBiber(file, PATCHES), /lib\/Sample\.pm.*not found/u);
});

test("a file that is not a PAR executable is refused", () => {
  assert.throws(() => hardenBiber(Buffer.from("plain text"), PATCHES), /PAR/u);
});

test("a patched member too large for its slot is refused", () => {
  const short = "x";
  const file = parFile([["lib/Sample.pm", short]]);
  const patches = [
    {
      member: "lib/Sample.pm",
      sha256: sha256(short),
      edits: [["x", createHash("sha512").update("incompressible").digest("hex")]],
    },
  ];
  assert.throws(() => hardenBiber(file, patches), /lib\/Sample\.pm.*no longer fits/u);
});

test("the launcher member is matched whatever the platform calls it", () => {
  const original = "launcher\n";
  const patches = [
    { member: /^script\/biber/u, sha256: sha256(original), edits: [["launcher", "safe"]] },
  ];
  const file = parFile([
    ["script/main.pl", "stub"],
    ["script/biber-darwin", `${original}${" ".repeat(400)}`.slice(0, original.length)],
  ]);
  assert.equal(member(hardenBiber(file, patches), "script/biber-darwin"), "safe\n");
});

test("an edit must match exactly once", () => {
  assert.throws(() => applyEdits("aa", [["a", "b"]], "lib/Sample.pm"), /2 times/u);
  assert.throws(() => applyEdits("aa", [["c", "b"]], "lib/Sample.pm"), /0 times/u);
});

test("stripping documentation leaves the code", () => {
  assert.equal(stripPod("a\n=head1 X\ny\n=cut\nb\n=pod\nz\n"), "a\nb\n");
});

test("every Biber patch names a pinned checksum and at least one edit", () => {
  assert.ok(BIBER_PATCHES.length >= 4);
  for (const patch of BIBER_PATCHES) {
    assert.match(patch.sha256, /^[0-9a-f]{64}$/u);
    assert.ok(patch.edits.length > 0);
  }
});

test("the edits reach the module as written, with no JavaScript interpolation", () => {
  const replaced = BIBER_PATCHES.find((patch) => patch.member === "lib/Biber/Utils.pm");
  const text = replaced.edits.map(([, replacement]) => replacement).join("\n");
  assert.ok(text.includes("map {$$_} 1 .. $#+"));
  assert.ok(text.includes("\\$\\{?(\\d+)\\}?"));
  assert.ok(text.includes("\\\\x([0-9A-Fa-f]{1,2})"));
});

test("the binary to patch must be a file in the temporary folder or the checkout", async () => {
  const folder = await mkdtemp(join(await realpath(tmpdir()), "oleafly-harden-"));
  try {
    const binary = join(folder, "biber");
    await writeFile(binary, "x");
    assert.equal(await confinedBinary(binary), binary);
    await assert.rejects(confinedBinary(process.execPath), /outside/u);
    await assert.rejects(confinedBinary(folder), /not a regular file/u);
    // Windows runners cannot create symlinks without extra rights.
    if (process.platform !== "win32") {
      await symlink(process.execPath, join(folder, "link"));
      await assert.rejects(confinedBinary(join(folder, "link")), /outside/u);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
