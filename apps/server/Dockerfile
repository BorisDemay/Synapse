# syntax=docker/dockerfile:1.7

FROM rust:1.97.1-bookworm AS builder
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY apps/server ./apps/server
COPY crates ./crates
COPY migrations ./migrations
COPY tests/fixtures/generator ./tests/fixtures/generator
RUN cargo build --release -p synapse-server \
  && strip target/release/synapse-server

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 synapse \
  && useradd --system --uid 10001 --gid synapse --home-dir /var/lib/synapse --create-home synapse \
  && mkdir -p /var/lib/synapse/blobs \
  && chown -R synapse:synapse /var/lib/synapse
COPY --from=builder /src/target/release/synapse-server /usr/local/bin/synapse-server
USER synapse:synapse
ENV SYNAPSE_BIND_ADDR=0.0.0.0:3000 \
    SYNAPSE_STORAGE_PATH=/var/lib/synapse/blobs \
    RUST_LOG=info
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD curl -fsS "http://127.0.0.1:3000/health/live" >/dev/null || exit 1
VOLUME ["/var/lib/synapse/blobs"]
ENTRYPOINT ["/usr/local/bin/synapse-server"]
