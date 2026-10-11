# syntax=docker/dockerfile:1.27
ARG RUST_VERSION=1.98.1
ARG ALPINE_VERSION=3.22
ARG DEBIAN_VERSION=13.7

FROM --platform=$BUILDPLATFORM tonistiigi/xx:1.9.0 AS xx

FROM --platform=$BUILDPLATFORM rust:${RUST_VERSION}-alpine${ALPINE_VERSION} AS build
COPY --from=xx / /
RUN apk add --no-cache clang lld file
ARG TARGETPLATFORM
RUN xx-apk add --no-cache gcc musl-dev \
    && xx-cargo --setup-target-triple
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY vendor ./vendor
COPY crates ./crates
COPY src-tauri/Cargo.toml ./src-tauri/Cargo.toml
COPY src-tauri/src ./src-tauri/src
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/build/target,sharing=locked \
    xx-cargo build --release --locked -p oleafly-server --target-dir /build/target \
    && xx-verify --static "/build/target/$(xx-cargo --print-target-triple)/release/oleafly-server" \
    && mkdir -p /out \
    && cp "/build/target/$(xx-cargo --print-target-triple)/release/oleafly-server" /out/oleafly-server

FROM scratch AS binary
COPY --from=build /out/oleafly-server /oleafly-server

FROM debian:${DEBIAN_VERSION}-slim AS runtime
LABEL org.opencontainers.image.title="Oleafly Server" \
      org.opencontainers.image.source="https://github.com/Oleafly/Oleafly" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 oleafly \
    && useradd --uid 10001 --gid oleafly --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin oleafly \
    && mkdir -p /data \
    && chown oleafly:oleafly /data \
    && chmod 0700 /data
COPY --from=build /out/oleafly-server /usr/local/bin/oleafly-server
ENV OLEAFLY_BIND=0.0.0.0:8080 \
    OLEAFLY_DATA_DIR=/data
USER 10001:10001
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
    CMD ["/usr/local/bin/oleafly-server", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/oleafly-server"]
