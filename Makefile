.PHONY: dev dev-shell dev-registry dev-module build push test lint typecheck \
        new-module clean logs ps

COMPOSE      := docker compose
COMPOSE_PROD := $(COMPOSE) -f docker-compose.yml
COMPOSE_DEV  := $(COMPOSE_PROD) -f docker-compose.dev.yml

# ── Ambiente completo (produção local) ─────────────────────────────────────
dev:
	$(COMPOSE_PROD) up --build

prod-down:
	$(COMPOSE_PROD) down

logs:
	$(COMPOSE_PROD) logs -f

ps:
	$(COMPOSE_PROD) ps

# ── Desenvolvimento com HMR ──────────────────────────────────────────────────
dev-registry:
	cd registry && pip install -r requirements.txt -q && \
	uvicorn app.main:app --host 0.0.0.0 --port 5010 --reload

dev-shell:
	cd shell && npm install && npm run dev

dev-module:
	@test -n "$(MODULE)" || (echo "Uso: make dev-module MODULE=vpn" && exit 1)
	cd modules/$(MODULE)/frontend && npm install && npm run dev

# ── Build ────────────────────────────────────────────────────────────────────
build:
	$(COMPOSE_PROD) build

build-module:
	@test -n "$(MODULE)" || (echo "Uso: make build-module MODULE=vpn" && exit 1)
	cd modules/$(MODULE)/frontend && npm install && npm run build

# ── Testes ──────────────────────────────────────────────────────────────────
test:
	@if [ -n "$(MODULE)" ]; then \
		cd modules/$(MODULE)/backend && python -m pytest tests/ -v --tb=short; \
	else \
		for dir in modules/*/backend; do \
			if [ -d "$$dir/tests" ]; then \
				echo "\n=== Testing $$dir ==="; \
				cd $$dir && python -m pytest tests/ -v --tb=short && cd ../../..; \
			fi; \
		done; \
		cd registry && python -m pytest tests/ -v --tb=short; \
	fi

test-module:
	@test -n "$(MODULE)" || (echo "Uso: make test-module MODULE=vpn" && exit 1)
	cd modules/$(MODULE)/backend && python -m pytest tests/ -v --tb=short --cov=app --cov-report=term-missing

# ── Lint e typecheck ─────────────────────────────────────────────────────────
lint:
	cd shell && npm run lint
	@for dir in modules/*/frontend; do \
		if [ -f "$$dir/package.json" ]; then \
			echo "Linting $$dir..." && cd $$dir && npm run lint 2>/dev/null || true && cd ../../..; \
		fi; \
	done

typecheck:
	cd shell && npm run typecheck
	@for dir in modules/*/frontend; do \
		if [ -f "$$dir/tsconfig.json" ]; then \
			echo "Typechecking $$dir..." && cd $$dir && npm run typecheck 2>/dev/null || true && cd ../../..; \
		fi; \
	done

# ── Novo módulo (scaffold) ───────────────────────────────────────────────────
new-module:
	@test -n "$(NAME)" || (echo "Uso: make new-module NAME=my_module NAV_LABEL='My Module' NAV_ORDER=10" && exit 1)
	@echo "Criando módulo $(NAME)..."
	@mkdir -p modules/$(NAME)/{frontend/src,backend/{app/routers,tests}}
	@cp -r modules/vpn/frontend/package.json modules/$(NAME)/frontend/package.json
	@cp modules/vpn/backend/requirements.txt modules/$(NAME)/backend/requirements.txt
	@sed -i 's/vpn/$(NAME)/g' modules/$(NAME)/frontend/package.json
	@echo "Módulo $(NAME) criado em modules/$(NAME)/"
	@echo "Edite o manifest.json e implemente o componente principal."

# ── Limpeza ──────────────────────────────────────────────────────────────────
clean:
	$(COMPOSE_PROD) down -v --remove-orphans
	find . -name "node_modules" -type d -prune -exec rm -rf {} +
	find . -name "dist" -type d -prune -exec rm -rf {} +
	find . -name "__pycache__" -type d -prune -exec rm -rf {} +
	find . -name "*.pyc" -delete
