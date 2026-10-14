# syntax=docker/dockerfile:1.27
ARG RUST_VERSION=1.98.1
ARG ALPINE_VERSION=3.22
ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian13:latest@sha256:58133991db06659feaabe0f4e97a35cebf15ef4ea08f8a4c6d2ee5f75e4aa6a0

FROM --platform=$BUILDPLATFORM tonistiigi/xx:1.9.0 AS xx

FROM --platform=$BUILDPLATFORM rust:${RUST_VERSION}-alpine${ALPINE_VERSION} AS build
COPY --from=xx / /
RUN apk add --no-cache clang file lld
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
    find crates -type f -exec touch {} + \
    && xx-cargo build --release --locked -p oleafly-server --target-dir /build/target \
    && xx-verify --static "/build/target/$(xx-cargo --print-target-triple)/release/oleafly-server" \
    && mkdir -p /out/data \
    && chmod 0700 /out/data \
    && cp "/build/target/$(xx-cargo --print-target-triple)/release/oleafly-server" /out/oleafly-server

FROM scratch AS binary
COPY --from=build /out/oleafly-server /oleafly-server

FROM ${RUNTIME_IMAGE} AS runtime
LABEL org.opencontainers.image.title="Oleafly Server" \
      org.opencontainers.image.description="Self-hosted collaboration server for Oleafly" \
      org.opencontainers.image.source="https://github.com/Oleafly/Oleafly" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
COPY --from=build --chown=10001:10001 --chmod=0700 /out/data /data
COPY --from=build --chmod=0755 /out/oleafly-server /usr/local/bin/oleafly-server
ENV OLEAFLY_BIND=0.0.0.0:8080 \
    OLEAFLY_DATA_DIR=/data
USER 10001:10001
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
    CMD ["/usr/local/bin/oleafly-server", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/oleafly-server"]
