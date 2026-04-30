package api

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"commandops/modules/vpn/backend/internal/adworker"
	"commandops/modules/vpn/backend/internal/config"
	"commandops/modules/vpn/backend/internal/registry"
)

type Server struct {
	cfg      config.Config
	settings *registry.SettingsClient
	adWorker *adworker.Client
}

type tokenClaims struct {
	Role            string `json:"role"`
	IsPlatformAdmin bool   `json:"is_platform_admin"`
	jwt.RegisteredClaims
}

func New(cfg config.Config) *Server {
	return &Server{
		cfg:      cfg,
		settings: registry.NewSettingsClient(cfg.RegistryURL, cfg.ServiceSecret, cfg.SettingsCacheTTL),
		adWorker: adworker.New(cfg.ADWorkerTimeout),
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/api/vpn/status", s.withAuth(s.status))
	mux.HandleFunc("/api/vpn/process", s.withAuth(s.process))
	mux.Handle("/", s.staticHandler())
	return withCORS(mux, s.cfg.ShellOrigin)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "module": "vpn", "version": "1.0.0-go"})
}

func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	username := strings.TrimSpace(r.URL.Query().Get("username"))
	if len(username) < 3 {
		writeError(w, http.StatusBadRequest, "username inválido")
		return
	}

	adURL, adToken, ok := s.resolveWorkerConfig(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "AD Worker não configurado. Defina AD_WORKER_URL e AD_WORKER_TOKEN no painel admin.")
		return
	}

	data, code, detail, err := s.adWorker.Post(r.Context(), adURL+"/operations/vpn-user/status", adToken, map[string]any{"username": username})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if code != 0 {
		writeError(w, code, detail)
		return
	}

	login, _ := data["login"].(string)
	vpnValue, _ := data["vpn_value"].(string)
	if login == "" {
		login = username
	}
	if vpnValue == "" {
		vpnValue = "NOT_SET"
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "login": login, "vpn_value": vpnValue})
}

func (s *Server) process(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload struct {
		Username    string `json:"username"`
		Enabled     bool   `json:"enabled"`
		RequestedBy string `json:"requested_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "payload inválido")
		return
	}
	payload.Username = strings.TrimSpace(payload.Username)
	if len(payload.Username) < 3 {
		writeError(w, http.StatusBadRequest, "username inválido")
		return
	}

	adURL, adToken, ok := s.resolveWorkerConfig(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "AD Worker não configurado. Defina AD_WORKER_URL e AD_WORKER_TOKEN no painel admin.")
		return
	}

	requestedBy := strings.TrimSpace(payload.RequestedBy)
	if requestedBy == "" {
		requestedBy = usernameFromContext(r.Context())
	}

	body := map[string]any{"username": payload.Username, "enabled": payload.Enabled, "requested_by": requestedBy}
	data, code, detail, err := s.adWorker.Post(r.Context(), adURL+"/operations/vpn-user/execute", adToken, body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if code != 0 {
		writeError(w, code, detail)
		return
	}

	// Keep response contract aligned with Python backend (VpnResult model only).
	result := map[string]any{
		"login":               asString(data["login"], payload.Username),
		"previous_vpn_value":  asString(data["previous_vpn_value"], "NOT_SET"),
		"vpn_value":           asString(data["vpn_value"], "NOT_SET"),
		"bloqueio_ext_action": asString(data["bloqueio_ext_action"], "failed"),
		"internet_mail_action": asString(data["internet_mail_action"], "failed"),
		"internet_mail_group":  asString(data["internet_mail_group"], ""),
		"warnings":             asStringSlice(data["warnings"]),
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "result": result})
}

func (s *Server) resolveWorkerConfig(ctx context.Context) (string, string, bool) {
	// Primary mode: fully independent configuration via env vars.
	if s.cfg.ADWorkerURL != "" && s.cfg.ADWorkerToken != "" {
		return s.cfg.ADWorkerURL, s.cfg.ADWorkerToken, true
	}

	// Optional fallback: legacy pull from Registry settings.
	cfg := s.settings.GetVPNSettings(ctx)
	adURL := strings.TrimRight(strings.TrimSpace(cfg["AD_WORKER_URL"]), "/")
	adToken := strings.TrimSpace(cfg["AD_WORKER_TOKEN"])
	if adURL == "" || adToken == "" {
		return "", "", false
	}
	return adURL, adToken, true
}

func (s *Server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeError(w, http.StatusForbidden, "Not authenticated")
			return
		}
		tok := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
		if tok == "" {
			writeError(w, http.StatusForbidden, "Not authenticated")
			return
		}

		claims := &tokenClaims{}
		_, err := jwt.ParseWithClaims(tok, claims, func(token *jwt.Token) (any, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, errors.New("invalid signing method")
			}
			return []byte(s.cfg.JWTSecret), nil
		})
		if err != nil || claims.Subject == "" {
			writeError(w, http.StatusUnauthorized, "Token inválido ou expirado")
			return
		}

		ctx := context.WithValue(r.Context(), contextKeyUsername{}, claims.Subject)
		next(w, r.WithContext(ctx))
	}
}

func (s *Server) staticHandler() http.Handler {
	staticDir := "/app/static"
	if info, err := os.Stat(staticDir); err != nil || !info.IsDir() {
		return http.NotFoundHandler()
	}

	fileServer := http.FileServer(http.Dir(staticDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/health" {
			http.NotFound(w, r)
			return
		}

		path := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
		if path == "." || path == "" {
			http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
			return
		}

		fullPath := filepath.Join(staticDir, path)
		_, statErr := os.Stat(fullPath)
		if statErr == nil {
			fileServer.ServeHTTP(w, r)
			return
		}
		if errors.Is(statErr, fs.ErrNotExist) {
			http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
	})
}

type contextKeyUsername struct{}

func usernameFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(contextKeyUsername{}).(string); ok {
		return v
	}
	return ""
}

func withCORS(next http.Handler, origin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, detail string) {
	writeJSON(w, status, map[string]string{"detail": detail})
}

func asString(v any, fallback string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return fallback
}

func asStringSlice(v any) []string {
	if v == nil {
		return []string{}
	}
	if arr, ok := v.([]any); ok {
		out := make([]string, 0, len(arr))
		for _, item := range arr {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	if arr, ok := v.([]string); ok {
		return arr
	}
	return []string{}
}

func (s *Server) HTTPServer() *http.Server {
	return &http.Server{
		Addr:              ":8080",
		Handler:           s.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
}
