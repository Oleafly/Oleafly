# Reproduces the Linux e2e job's environment on a developer machine.
#
# The point is the WEBVIEW: Linux CI runs WebKitGTK (webkit2gtk-4.1) under xvfb,
# which lays out text and fires events differently from macOS's WKWebView. Class
# of bug this catches locally instead of an hour later on CI: soft-wrap row
# counts, toolbar overflow thresholds, gutter geometry, and anything that
# depends on when a synthetic event is delivered.
#
# It cannot stand in for macOS or Windows - WKWebView and WebView2 are bound to
# their operating systems and are not emulable. This covers Linux only.
#
# The system dependency list is kept identical to the `Install Linux system
# dependencies (Tauri + xvfb)` step in .github/workflows/ci.yml; if that step
# changes, change this too.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV CARGO_HOME=/opt/cargo
ENV RUSTUP_HOME=/opt/rustup
ENV PATH=/opt/cargo/bin:$PATH
# Keep cargo's target dir out of the bind mount so a container build never
# fights the host's macOS artifacts over the same directory.
ENV CARGO_TARGET_DIR=/opt/target

RUN apt-get update && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev \
      libappindicator3-dev \
      librsvg2-dev \
      patchelf \
      libxdo-dev \
      build-essential \
      xvfb \
      curl wget file git ca-certificates xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Node 22 (the repo's engines field wants >=22.13 <25) and pnpm via corepack.
RUN ARCH="$(dpkg --print-architecture)" \
    && case "$ARCH" in \
         arm64) NODE_ARCH=arm64 ;; \
         amd64) NODE_ARCH=x64 ;; \
         *) echo "unsupported arch $ARCH" >&2; exit 1 ;; \
       esac \
    && case "$NODE_ARCH" in \
         arm64) NODE_SHA=06907b9c088ce62305bc1530e5c1ae1510245114645768f7750c349c5b6fe667 ;; \
         x64)   NODE_SHA=00bbd05e306ea68b6e13e17360d0e2f680b493ef95f2fea1c4296ff7437530bc ;; \
       esac \
    && curl --proto '=https' --tlsv1.2 -fsSL \
       "https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-${NODE_ARCH}.tar.xz" \
       -o /tmp/node.tar.xz \
    && echo "${NODE_SHA}  /tmp/node.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && corepack enable

# rustup-init is pinned and checksum-verified rather than piped from sh.rustup.rs
# into a shell, so the build cannot execute an artifact it has not authenticated.
RUN ARCH="$(dpkg --print-architecture)" \
    && case "$ARCH" in \
         arm64) RUST_TARGET=aarch64-unknown-linux-gnu; \
                RUSTUP_SHA=9732d6c5e2a098d3521fca8145d826ae0aaa067ef2385ead08e6feac88fa5792 ;; \
         amd64) RUST_TARGET=x86_64-unknown-linux-gnu; \
                RUSTUP_SHA=4acc9acc76d5079515b46346a485974457b5a79893cfb01112423c89aeb5aa10 ;; \
         *) echo "unsupported arch $ARCH" >&2; exit 1 ;; \
       esac \
    && curl --proto '=https' --tlsv1.2 -fsSL \
       "https://static.rust-lang.org/rustup/archive/1.29.0/${RUST_TARGET}/rustup-init" \
       -o /tmp/rustup-init \
    && echo "${RUSTUP_SHA}  /tmp/rustup-init" | sha256sum -c - \
    && chmod +x /tmp/rustup-init \
    && /tmp/rustup-init -y --default-toolchain stable --profile minimal \
    && rm /tmp/rustup-init

WORKDIR /work
CMD ["bash"]
