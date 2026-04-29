# Especificação de Módulo

Todo módulo do CommandOps Modular deve seguir esta especificação para ser carregado pelo shell.

## Estrutura de diretórios

```
modules/{id}/
├── frontend/
│   ├── src/
│   │   ├── {Id}View.tsx       # Componente raiz exportado via MF
│   │   ├── components/        # Componentes internos (CSS Modules)
│   │   ├── hooks/             # React hooks do módulo
│   │   └── api.ts             # Funções de chamada ao backend
│   ├── package.json
│   ├── vite.config.ts         # Remote config (vite-plugin-federation)
│   ├── tsconfig.json
│   └── index.html             # Para dev standalone
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app
│   │   ├── routers/
│   │   ├── models/
│   │   └── services/
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
└── manifest.json
```

## manifest.json

```json
{
  "id": "vpn",
  "name": "VPN",
  "description": "Gerenciamento de túneis VPN",
  "version": "1.0.0",
  "min_shell_version": "0.1.0",
  "nav_label": "VPN",
  "nav_order": 6,
  "icon": "🔐",
  "remote_entry": "/assets/remoteEntry.js",
  "exposed_component": "./ModuleView",
  "api_prefix": "/api/vpn",
  "required_roles": ["admin", "operador"],
  "health_endpoint": "/health"
}
```

## Interface do componente raiz

O componente exposto via Module Federation **deve** aceitar exatamente estas props:

```typescript
export type ModuleProps = {
  token: string;          // JWT atual do usuário
  user: {
    username: string;
    role: string;
    is_platform_admin: boolean;
  };
  apiBase: string;        // URL base do backend do módulo (ex: /api/vpn)
  theme: "light" | "dark";
  language: "pt-BR" | "en-US";
};
```

Props adicionais são permitidas mas devem ter valor padrão — o shell nunca passa props extras.

## vite.config.ts do módulo (remote)

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "vpn_module",          // único por módulo
      filename: "remoteEntry.js",
      exposes: {
        "./ModuleView": "./src/VpnView",  // componente raiz
      },
      shared: {
        react: { singleton: true, requiredVersion: "^18.0.0" },
        "react-dom": { singleton: true, requiredVersion: "^18.0.0" },
        "@commandops/ui": { singleton: true },
      },
    }),
  ],
  build: {
    target: "esnext",
    minify: false,                 // facilita debug em dev
    cssCodeSplit: false,           // CSS em bundle único
  },
});
```

## CSS — regras obrigatórias

```css
/* ✅ Correto: CSS Modules */
.container { ... }         /* vira .container_abc123 em build */

/* ✅ Correto: consumir vars do shell */
.title { color: var(--text); }
.card  { background: var(--panel); }

/* ❌ Proibido: estilos globais em módulo */
body { ... }
:root { --text: red; }    /* não redefina vars do shell */
```

## Backend — padrão FastAPI

```python
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.auth import verify_token   # importa do shared

app = FastAPI(title="VPN Module API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5000"],  # apenas o shell
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

@app.get("/health")
def health():
    return {"status": "ok", "module": "vpn"}

@app.get("/api/vpn/tunnels")
def list_tunnels(user=Depends(verify_token)):
    ...
```

## Dockerfile do módulo

```dockerfile
FROM python:3.12-slim AS backend

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app

FROM node:22-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json .
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM backend AS final
COPY --from=frontend-build /frontend/dist /app/static
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

O backend serve o frontend buildado via `StaticFiles` — um único container por módulo.

## Checklist antes de registrar um módulo

- [ ] `manifest.json` presente e válido
- [ ] Componente raiz aceita `ModuleProps` corretamente
- [ ] `remoteEntry.js` acessível em `{module_url}/assets/remoteEntry.js`
- [ ] `/health` retorna `{ status: "ok" }`
- [ ] Testes de backend passando (`pytest` com coverage > 80%)
- [ ] Nenhum estilo global no frontend
- [ ] CORS configurado para aceitar apenas o shell
- [ ] Token JWT validado em todos os endpoints protegidos
