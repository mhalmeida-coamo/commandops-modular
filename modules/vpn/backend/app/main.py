import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.routers import tunnels

SHELL_ORIGIN = os.environ.get("SHELL_ORIGIN", "http://localhost:5000")

app = FastAPI(title="VPN Module API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[SHELL_ORIGIN],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(tunnels.router, prefix="/api/vpn")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "module": "vpn", "version": "1.0.0"}


# Servir o frontend buildado (produção)
static_dir = "/app/static"
if os.path.isdir(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
