#!/usr/bin/env node
//
// Patches the Perl inside a packed Biber 2.17 in place.
//   node scripts/biber/harden-biber.mjs < biber > hardened-biber
//
// Tectonic starts Biber with arguments taken from the document's .run.xml, and
// Biber evaluates text from the control file as Perl. So a document could run
// code while shell-escape is off. Biber 2.17 has to stay, because it is the
// version that matches Tectonic's biblatex, and the fixes upstream made later
// cannot reach it. Every platform's binary carries the same Perl source, so one
// set of edits covers them all, with no Perl toolchain at build time.
//
// A PAR executable is a loader, a zip, a cache id, a length and a marker. Each
// edited module goes back into the slot its old bytes used, so the file keeps
// its length and its layout, which is what keeps a Mach-O file valid.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

const PAR_MARKER = "\nPAR.pm\n";
const CACHE_SUFFIX = "\0CACHE";
const CACHE_ID_LENGTH = 40;
const LENGTH_FIELD = 4;
const END_OF_DIRECTORY = Buffer.from("PK\x05\x06");
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const DEFLATE = 8;
const HARDENING_REVISION = "oleafly-biber-hardening-1";

export const BIBER_PATCHES = [
  {
    // Options reach Biber from the document, so they only count when Oleafly
    // itself starts Biber, and biber.conf from a project folder never loads.
    member: /^script\/biber/u,
    sha256: "40ca0e53b99d290e4fa3f8595ad5d849a9aae9e3bec1b87ff941bc3286c3ef44",
    edits: [
      [
        `use Getopt::Long qw/:config no_ignore_case/;
my $opts = {};
`,
        String.raw`unless ($ENV{OLEAFLY_BIBER_DIRECT}) {
  @ARGV = grep {/\A-(?:-version|v)\z/ or not /\A-|[\\\/]/} @ARGV;
}
use Getopt::Long qw/:config no_ignore_case/;
my $opts = {};
`,
      ],
      [
        `          ) or pod2usage(-verbose => 0,
                         -exitval => EXIT_ERROR);

# verbose > 1 uses external perldoc`,
        `          ) or pod2usage(-verbose => 0,
                         -exitval => EXIT_ERROR);
$opts->{noconf} = 1;

# verbose > 1 uses external perldoc`,
      ],
      [
        `my $package = 'Biber::Output::' . Biber::Config->getoption('output_format');
`,
        String.raw`biber_error('Unknown output format') unless Biber::Config->getoption('output_format') =~ /\A\w+\z/;
my $package = 'Biber::Output::' . Biber::Config->getoption('output_format');
`,
      ],
    ],
  },
  {
    // The replacement in a source map comes from the document. It is expanded
    // here rather than evaluated, and keeps the forms a replacement can use.
    member: "lib/Biber/Utils.pm",
    sha256: "1180ef3fe4f0b49c14c2095d0d120133aaea836a0a8bbeb14fd287bf822dd152",
    edits: [
      [
        `  # Tricky quoting because of later evals
  $val_replace = '"' . $val_replace . '"';
  $value =~ s/$val_match/$val_replace/eegxms;
  return $value;
}
`,
        String.raw`  $value =~ s/$val_match/my @c = do {no strict 'refs'; map {$$_} 1 .. $#+}; _expand_replacement($val_replace, \@c)/egxms;
  return $value;
}

sub _expand_replacement {
  my ($template, $captures) = @_;
  my ($out, $case, $once) = ('', '', '');
  my %escapes = (n => "\n", t => "\t", r => "\r", f => "\f", e => "\e", a => "\a");
  my $emit = sub {
    my $text = shift;
    $text = lc($text) if $case eq 'L';
    $text = uc($text) if $case eq 'U';
    if ($once and length($text)) {
      $text = $once eq 'l' ? lcfirst($text) : ucfirst($text);
      $once = '';
    }
    $out .= $text;
  };
  while ($template =~ /\G(?:\\x\{([0-9A-Fa-f]+)\}|\\x([0-9A-Fa-f]{1,2})|\\(.)|\$\{?(\d+)\}?|([^\\\$]+|.))/gcs) {
    my ($wide, $hex, $escape, $group, $literal) = ($1, $2, $3, $4, $5);
    if (defined($wide // $hex)) {
      $emit->(chr(hex($wide // $hex)));
    }
    elsif (defined($group)) {
      $emit->($captures->[$group - 1] // '');
    }
    elsif (not defined($escape)) {
      $emit->($literal);
    }
    elsif ($escape =~ /\A[LU]\z/) {
      $case = $escape;
    }
    elsif ($escape eq 'E') {
      $case = '';
    }
    elsif ($escape =~ /\A[lu]\z/) {
      $once = $escape;
    }
    else {
      $emit->($escapes{$escape} // $escape);
    }
  }
  return $out;
}
`,
      ],
    ],
  },
  {
    // Only known data source types are loaded by name, and values that end up
    // in the sort key's evaluated text can no longer close their quoting.
    member: "lib/Biber.pm",
    sha256: "148a6653ce2991d614e4b972b88f785ccb6e3d6419595681f61848754ec538a9",
    edits: [
      [
        `    unless(eval "require $package") {
`,
        String.raw`    unless($type eq 'file' and $datatype =~ /\A(?:bibtex|biblatexml)\z/ and eval "require $package") {
`,
      ],
      [
        `        eval "require $package" or
          biber_error("Error loading data source package '$package': $@");
        $missing->@* =`,
        String.raw`        ($type eq 'file' and $datatype =~ /\A(?:bibtex|biblatexml)\z/ and eval "require $package") or
          biber_error("Error loading data source package '$package': $@");
        $missing->@* =`,
      ],
      [
        `    if (defined($sl) and $sl ne $thislocale) {
`,
        String.raw`    if (defined($sl) and $sl =~ /\A[\w-]+\z/ and $sl ne $thislocale) {
`,
      ],
      [
        `  $collopts->{upper_before_lower} = Biber::Config->getoption('sortupper');
`,
        `  $collopts->{upper_before_lower} = Biber::Config->getoption('sortupper');
  $collopts->{upper_before_lower} = $collopts->{upper_before_lower} ? 1 : 0 if defined($collopts->{upper_before_lower});
`,
      ],
      [
        `        my $a = $collateobjs[$i] . "->getSortKey(q{$sortfield})";
`,
        String.raw`        (my $quoted = $sortfield) =~ s/([\\{}])/\\$1/g;
        my $a = $collateobjs[$i] . "->getSortKey(q{$quoted})";
`,
      ],
    ],
  },
  {
    // Collation options are read as plain key => value pairs.
    member: "lib/Biber/Config.pm",
    sha256: "2a75358e49489deeb709792ee363b9f7e530c25abbb56933f9d34c07511d02de",
    edits: [
      [
        `      my $copt_h = eval "{ $opts->{$copt} }" or croak('Bad command-line collation options');
`,
        String.raw`      my $copt_h = {};
      foreach my $pair (split(/\s*,\s*/, $opts->{$copt})) {
        my ($k, $v) = $pair =~ /\A\s*(\w+)\s*=>\s*'?([\w.-]*)'?\s*\z/ or croak('Bad command-line collation options');
        $copt_h->{$k} = $v;
      }
`,
      ],
    ],
  },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function stripPod(text) {
  return text.replace(/^=[A-Za-z][\s\S]*?(?:^=cut[^\n]*\n|(?![\s\S]))/gmu, "");
}

export function applyEdits(text, edits, name) {
  let edited = text;
  for (const [find, replacement] of edits) {
    const matches = edited.split(find).length - 1;
    if (matches !== 1) {
      throw new Error(`${name}: an edit matched ${matches} times, expected 1`);
    }
    edited = edited.replace(find, () => replacement);
  }
  return edited;
}

function locatePayload(file) {
  const marker = file.lastIndexOf(PAR_MARKER);
  const idStart = marker - LENGTH_FIELD - CACHE_SUFFIX.length - CACHE_ID_LENGTH;
  if (
    marker < 0 ||
    idStart < 0 ||
    file.toString("latin1", idStart + CACHE_ID_LENGTH, marker - LENGTH_FIELD) !== CACHE_SUFFIX
  ) {
    throw new Error("not a PAR executable: its trailer was not found");
  }
  const end = file.lastIndexOf(END_OF_DIRECTORY, idStart);
  if (end < 0) {
    throw new Error("not a PAR executable: its zip directory was not found");
  }
  const directorySize = file.readUInt32LE(end + 12);
  const directoryOffset = file.readUInt32LE(end + 16);
  return {
    count: file.readUInt16LE(end + 10),
    directory: end - directorySize,
    // PAR rewrites the offsets to count from the start of the file, but a
    // plain zip appended to a loader counts from the start of the zip.
    base: end - directorySize - directoryOffset,
    idStart,
  };
}

function readEntries(file, { count, directory }) {
  const entries = [];
  let at = directory;
  for (let index = 0; index < count; index += 1) {
    if (file.readUInt32LE(at) !== DIRECTORY_ENTRY) {
      throw new Error("not a PAR executable: its zip directory is damaged");
    }
    const nameLength = file.readUInt16LE(at + 28);
    entries.push({
      at,
      name: file.toString("utf8", at + 46, at + 46 + nameLength),
    });
    at += 46 + nameLength + file.readUInt16LE(at + 30) + file.readUInt16LE(at + 32);
  }
  return entries;
}

function patchMember(file, entry, base, patch) {
  const { at, name } = entry;
  const local = base + file.readUInt32LE(at + 42);
  if (file.readUInt32LE(local) !== LOCAL_HEADER || file.readUInt16LE(at + 10) !== DEFLATE) {
    throw new Error(`${name}: unexpected zip entry layout`);
  }
  const start = local + 30 + file.readUInt16LE(local + 26) + file.readUInt16LE(local + 28);
  const slot = file.readUInt32LE(at + 20);
  const original = inflateRawSync(file.subarray(start, start + slot));
  if (sha256(original) !== patch.sha256) {
    throw new Error(`${name}: the module does not match the pinned Biber 2.17 source`);
  }
  const edited = Buffer.from(
    stripPod(applyEdits(original.toString("utf8"), patch.edits, name)),
    "utf8",
  );
  const packed = deflateRawSync(edited, { level: 9 });
  if (packed.length > slot) {
    throw new Error(`${name}: the patched module no longer fits (${packed.length} > ${slot})`);
  }
  file.fill(0, start, start + slot);
  packed.copy(file, start);
  const checksum = crc32(edited);
  file.writeUInt32LE(checksum, local + 14);
  file.writeUInt32LE(packed.length, local + 18);
  file.writeUInt32LE(edited.length, local + 22);
  file.writeUInt32LE(checksum, at + 16);
  file.writeUInt32LE(packed.length, at + 20);
  file.writeUInt32LE(edited.length, at + 24);
}

function memberMatches(patch, name) {
  return patch.member instanceof RegExp
    ? patch.member.test(name) && !name.endsWith("/") && !name.endsWith("/main.pl")
    : patch.member === name;
}

export function hardenBiber(binary, patches = BIBER_PATCHES) {
  const file = Buffer.from(binary);
  const payload = locatePayload(file);
  const entries = readEntries(file, payload);
  for (const patch of patches) {
    const found = entries.filter((entry) => memberMatches(patch, entry.name));
    if (found.length !== 1) {
      throw new Error(`${patch.member}: member not found exactly once`);
    }
    patchMember(file, found[0], payload.base, patch);
  }
  const previous = file.toString("latin1", payload.idStart, payload.idStart + CACHE_ID_LENGTH);
  // Only a new folder name for PAR's unpack cache, so any 40 hex digits do.
  const id = createHash("sha256")
    .update(`${previous}${HARDENING_REVISION}`)
    .digest("hex")
    .slice(0, CACHE_ID_LENGTH);
  file.write(id, payload.idStart, "latin1");
  return file;
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  process.stdout.write(hardenBiber(Buffer.concat(chunks)));
}

// Compared as real paths: a script reached through a symlink would otherwise
// exit 0 having done nothing, and an unpatched Biber would ship.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`harden-biber: ${error.message}`);
    process.exit(1);
  }
}
