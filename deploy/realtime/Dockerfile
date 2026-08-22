FROM rust:1.96-bookworm AS builder
WORKDIR /workspace
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/workspace/src-tauri/target \
    cargo build --locked --release -p oleafly-realtime-server \
    && cp /workspace/src-tauri/target/release/oleafly-realtime-server /tmp/oleafly-realtime-server

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 oleafly
COPY --from=builder /tmp/oleafly-realtime-server /usr/local/bin/oleafly-realtime-server
USER oleafly
EXPOSE 8787
ENTRYPOINT ["oleafly-realtime-server"]
CMD ["serve"]
