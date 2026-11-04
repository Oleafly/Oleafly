#!/usr/bin/env bash
#
# Builds a standalone Biber 2.17 for Linux, for targets upstream has no binary
# for. Biber 2.17 is the version that matches Tectonic's biblatex 3.17, and it
# exists for aarch64 Linux only as Perl source.
#
#   docker run --rm --platform linux/arm64 -v "$PWD":/repo -v /tmp/out:/out \
#     debian:11 bash /repo/scripts/biber/build-linux.sh
#
# Output: /out/biber and /out/biber-linux_<arch>.tar.gz. Upload the tarball to
# the mirror and pin its checksum in scripts/fetch-biber.sh.
#
# Debian 11 is end of life, and that is the point: its glibc 2.31 sets how old a
# system the binary can run on, and its Perl 5.32 accepts Biber 2.17 as written.
# scripts/biber/cpan-lock.txt records the module versions of the shipped build.
set -euo pipefail

BIBER_COMMIT_ARCHIVE="https://github.com/plk/biber/archive/refs/tags/v2.17.tar.gz"
BIBER_ARCHIVE_SHA256="1ee7efdd8343e982046f2301c1b0dcf09e1f9a997ac86ed1018dcb41d04c9e88"
OUT="${OUT:-/out}"

export DEBIAN_FRONTEND=noninteractive LC_ALL=C.UTF-8 PERL_MM_USE_DEFAULT=1
export PERL_CANARY_STABILITY_NOPROMPT=1 MAKEFLAGS=-j4 HARNESS_OPTIONS=j4

cat > /etc/apt/sources.list <<'LIST'
deb http://archive.debian.org/debian bullseye main
deb http://archive.debian.org/debian-security bullseye-security main
LIST
rm -f /etc/apt/sources.list.d/*
apt-get update -qq -o Acquire::Check-Valid-Until=false
apt-get install -y -qq --no-install-recommends \
  build-essential perl libperl-dev cpanminus libxml2-dev libxslt1-dev \
  zlib1g-dev libssl-dev libexpat1-dev pkg-config chrpath file binutils \
  ca-certificates curl unzip libgcrypt20-dev liblzma-dev libicu-dev

MULTIARCH="$(gcc -dumpmachine)"
ARCH="$(uname -m)"

mkdir -p /src
curl -fsSL --proto '=https' --proto-redir '=https' --retry 3 -o /tmp/biber.tar.gz "$BIBER_COMMIT_ARCHIVE"
echo "$BIBER_ARCHIVE_SHA256  /tmp/biber.tar.gz" | sha256sum -c -
tar -xzf /tmp/biber.tar.gz -C /src --strip-components=1
cd /src

# Upstream commit d9e96171: Perl 5.36 and newer reject the missing semicolon.
sed -i 's/^  \$self->{everykey} = undef$/  $self->{everykey} = undef;/' lib/Biber/Section.pm

cpanm --notest --quiet Module::Build Config::AutoConf ExtUtils::LibBuilder
cpanm --notest --installdeps .

# PAR::Packer embeds libperl's dependencies in its boot loader, but it skips
# anything under /lib or /usr/lib as a system library. libcrypt.so.1 is not on
# Fedora, Arch or openSUSE, and the inner interpreter needs it before Perl can
# unpack a --link file. Resolving it from another folder gets it embedded.
mkdir -p /opt/parlib
cp -L "/lib/$MULTIARCH/libcrypt.so.1" /opt/parlib/libcrypt.so.1
LD_LIBRARY_PATH=/opt/parlib cpanm --notest PAR::Packer

perl Build.PL
./Build
ldconfig
./Build test
./Build install
ldconfig
biber --version | grep -F 'biber version: 2.17'

# A shared library that keeps a build-time RPATH looks in folders that do not
# exist on the user's machine.
find /usr/local -name '*.so*' -type f | while read -r library; do
  if readelf -d "$library" 2>/dev/null | grep -qE 'RPATH|RUNPATH'; then
    chrpath -d "$library" || true
  fi
done

ARCHLIB="$(readlink -f "$(perl -MConfig -e 'print $Config{archlibexp}')")"
SITEARCH="$(perl -MConfig -e 'print $Config{sitearchexp}')"
BTPARSE=/usr/local/lib/libbtparse.so
{
  find "$SITEARCH" "$ARCHLIB" "/usr/lib/$MULTIARCH/perl-base" "/usr/lib/$MULTIARCH/perl5" \
    -name '*.so' -type f 2>/dev/null || true
  echo "$BTPARSE"
} > /tmp/shared-objects
xargs -a /tmp/shared-objects -n 1 ldd 2>/dev/null | awk '/=> \//{print $3}' | sort -u \
  | grep -Ev '/(libc|libm|libdl|libpthread|librt|ld-linux[^/]*|libutil|libresolv|libnsl|libnss[^/]*)\.so' \
  > /tmp/links

LINKS=("--link=/lib/$MULTIARCH/libcrypt.so.1")
while read -r library; do LINKS+=("--link=$library"); done < /tmp/links

COLLATE="$(perl -MUnicode::Collate -e '(my $p = $INC{"Unicode/Collate.pm"}) =~ s/\.pm$//; print $p')"
CERTIFICATES="$(perl -MMozilla::CA -e 'print Mozilla::CA::SSL_ca_file()')"
ISBN_RANGES="$(find /usr/local /usr/share/perl5 -name RangeMessage.xml | head -n 1)"
ADDS=(
  "--addfile=/src/data/biber-tool.conf;lib/Biber/biber-tool.conf"
  "--addfile=/src/data/schemata/config.rnc;lib/Biber/config.rnc"
  "--addfile=/src/data/schemata/config.rng;lib/Biber/config.rng"
  "--addfile=/src/data/schemata/bcf.rnc;lib/Biber/bcf.rnc"
  "--addfile=/src/data/schemata/bcf.rng;lib/Biber/bcf.rng"
  "--addfile=/src/lib/Biber/LaTeX/recode_data.xml;lib/Biber/LaTeX/recode_data.xml"
  "--addfile=/src/data/bcf.xsl;lib/Biber/bcf.xsl"
  "--addfile=$COLLATE/Locale;lib/Unicode/Collate/Locale"
  "--addfile=$COLLATE/CJK;lib/Unicode/Collate/CJK"
  "--addfile=$COLLATE/allkeys.txt;lib/Unicode/Collate/allkeys.txt"
  "--addfile=$COLLATE/keys.txt;lib/Unicode/Collate/keys.txt"
  "--addfile=$CERTIFICATES;lib/Mozilla/CA/cacert.pem"
  "--addfile=$ISBN_RANGES;lib/Business/ISBN/RangeMessage.xml"
  "--addfile=$ARCHLIB/PerlIO;lib/PerlIO"
  "--addfile=$ARCHLIB/auto/PerlIO;lib/auto/PerlIO"
)

MODULES=(--module=Encode::)
for module in deprecate Biber::Input::file::bibtex Biber::Input::file::biblatexml \
  Biber::Output::dot Biber::Output::bbl Biber::Output::bblxml Biber::Output::bibtex \
  Biber::Output::biblatexml Pod::Simple::TranscodeSmart Pod::Simple::TranscodeDumb \
  List::MoreUtils::XS List::SomeUtils::XS List::MoreUtils::PP HTTP::Status HTTP::Date \
  File::Find::Rule IO::Socket::SSL IO::String PerlIO::utf8_strict Text::CSV_XS DateTime \
  Specio::PP Specio::XS; do
  if perl -e "require $module; 1" >/dev/null 2>&1; then
    MODULES+=("--module=$module")
  fi
done

mkdir -p "$OUT"
cd /tmp
PAR_VERBATIM=1 pp "${MODULES[@]}" "${LINKS[@]}" "${ADDS[@]}" \
  --cachedeps=/tmp/scancache --output="$OUT/biber" "$(command -v biber)"

"$OUT/biber" --version | grep -F 'biber version: 2.17'
tar -czf "$OUT/biber-linux_$ARCH.tar.gz" -C "$OUT" biber
sha256sum "$OUT/biber-linux_$ARCH.tar.gz"
perl -MExtUtils::Installed -e 'my $i = ExtUtils::Installed->new; print "$_ ", ($i->version($_) // "?"), "\n" for sort $i->modules' \
  > "$OUT/cpan-lock.txt"
