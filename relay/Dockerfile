FROM rust:1-slim AS build
WORKDIR /src
COPY . .
RUN cargo build --release

FROM debian:stable-slim
COPY --from=build /src/target/release/fast-share-relay /usr/local/bin/fast-share-relay
# The certificate and the access token live here; keep this volume across restarts.
VOLUME /data
EXPOSE 8443
ENTRYPOINT ["fast-share-relay", "--data-dir", "/data"]
