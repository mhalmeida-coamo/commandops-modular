FROM node:22-alpine AS frontend-build

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM golang:1.24-alpine AS go-build
WORKDIR /src
COPY backend/go.mod backend/go.sum* ./backend/
WORKDIR /src/backend
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/vpn-api ./cmd/vpn-api

FROM alpine:3.20
WORKDIR /app
RUN adduser -D -H appuser
COPY --from=go-build /out/vpn-api /app/vpn-api
COPY --from=frontend-build /frontend/dist /app/static
USER appuser
EXPOSE 8080
CMD ["/app/vpn-api"]
