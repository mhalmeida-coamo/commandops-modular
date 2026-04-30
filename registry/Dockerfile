FROM golang:1.26-alpine AS build
WORKDIR /src
COPY registry/go.mod registry/go.sum* ./registry/
WORKDIR /src/registry
RUN /usr/local/go/bin/go mod download
COPY registry/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 /usr/local/go/bin/go build -o /out/registry-api ./cmd/registry-api

FROM alpine:3.20
WORKDIR /app
RUN adduser -D -H appuser
COPY --from=build /out/registry-api /app/registry-api
USER appuser
EXPOSE 8000
CMD ["/app/registry-api"]
