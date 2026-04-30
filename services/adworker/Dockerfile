FROM golang:1.26-alpine AS build
WORKDIR /src
COPY services/adworker/go.mod services/adworker/go.sum* ./services/adworker/
WORKDIR /src/services/adworker
RUN /usr/local/go/bin/go mod download
COPY services/adworker/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 /usr/local/go/bin/go build -o /out/adworker-api ./cmd/adworker-api

FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    krb5-user \
    ldap-utils \
    libsasl2-modules-gssapi-mit \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/adworker-api /app/adworker-api
EXPOSE 8010
CMD ["/app/adworker-api"]
