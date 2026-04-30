package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"commandops/registry/internal/auth"
	"commandops/registry/internal/config"
	"golang.org/x/crypto/bcrypt"
)

type Server struct {
	cfg config.Config
	db  *sql.DB
}

type module struct {
	ID            string
	Name          string
	Version       string
	Status        string
	NavLabel      string
	NavOrder      int
	Icon          string
	RemoteURL     string
	APIURL        string
	HealthURL     sql.NullString
	RequiredRoles []string
	Enabled       bool
}

type moduleOut struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Version       string   `json:"version"`
	Status        string   `json:"status"`
	NavLabel      string   `json:"nav_label"`
	NavOrder      int      `json:"nav_order"`
	Icon          string   `json:"icon"`
	RemoteURL     string   `json:"remote_url"`
	APIURL        string   `json:"api_url"`
	RequiredRoles []string `json:"required_roles"`
	Health        string   `json:"health"`
	LatencyMS     *int     `json:"latency_ms"`
}

type governanceOut struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Version       string   `json:"version"`
	Status        string   `json:"status"`
	Enabled       bool     `json:"enabled"`
	NavLabel      string   `json:"nav_label"`
	NavOrder      int      `json:"nav_order"`
	Icon          string   `json:"icon"`
	Dependencies  []string `json:"dependencies"`
	Configured    bool     `json:"configured"`
	Health        string   `json:"health"`
	LatencyMS     *int     `json:"latency_ms"`
}

type settingOut struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	IsSecret bool   `json:"is_secret"`
}

type settingIn struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	IsSecret bool   `json:"is_secret"`
}

func New(cfg config.Config, db *sql.DB) *Server { return &Server{cfg: cfg, db: db} }

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/auth/token", s.login)
	mux.HandleFunc("/modules", s.withAuth(s.modulesRoot))
	mux.HandleFunc("/modules/governance", s.withAuth(s.modulesGovernance))
	mux.HandleFunc("/modules/", s.withAuth(s.modulesSubroutes))
	return withCORS(mux)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "registry"})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "payload inválido")
		return
	}
	in.Username = strings.TrimSpace(in.Username)
	if in.Username == "" || in.Password == "" {
		writeErr(w, http.StatusUnauthorized, "Credenciais inválidas")
		return
	}

	u, err := s.getUser(r.Context(), in.Username)
	if err != nil || !auth.VerifyPassword(u.HashedPassword, in.Password) {
		writeErr(w, http.StatusUnauthorized, "Credenciais inválidas")
		return
	}
	token, err := auth.CreateToken(u, s.cfg.JWTSecret, s.cfg.JWTExpireMinutes)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "erro ao gerar token")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user": map[string]any{
			"username":          u.Username,
			"role":              u.Role,
			"is_platform_admin": u.IsPlatformAdmin,
			"allowed_modules":   auth.AllowedList(u.AllowedModules),
		},
	})
}

func (s *Server) modulesRoot(w http.ResponseWriter, r *http.Request, u auth.User) {
	switch r.Method {
	case http.MethodGet:
		s.listModules(w, r, u)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) modulesGovernance(w http.ResponseWriter, r *http.Request, u auth.User) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !u.IsPlatformAdmin {
		writeErr(w, http.StatusForbidden, "Requer permissão de administrador da plataforma")
		return
	}
	mods, err := s.fetchModules(r.Context(), true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	outs := make([]governanceOut, 0, len(mods))
	for _, m := range mods {
		health, latency := s.checkModuleHealth(m)
		deps, configured, err := s.dependenciesAndConfigured(r.Context(), m.ID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		outs = append(outs, governanceOut{ID: m.ID, Name: m.Name, Version: m.Version, Status: m.Status, Enabled: m.Enabled, NavLabel: m.NavLabel, NavOrder: m.NavOrder, Icon: m.Icon, Dependencies: deps, Configured: configured, Health: health, LatencyMS: latency})
	}
	sort.Slice(outs, func(i, j int) bool { return outs[i].NavOrder < outs[j].NavOrder })
	writeJSON(w, http.StatusOK, outs)
}

func (s *Server) modulesSubroutes(w http.ResponseWriter, r *http.Request, u auth.User) {
	path := strings.TrimPrefix(r.URL.Path, "/modules/")
	if path == "" {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	parts := strings.Split(path, "/")
	moduleID := parts[0]
	if len(parts) == 2 && parts[1] == "enabled" {
		s.setEnabled(w, r, u, moduleID)
		return
	}
	if len(parts) == 2 && parts[1] == "settings" {
		s.settingsAdmin(w, r, u, moduleID)
		return
	}
	if len(parts) == 3 && parts[1] == "settings" && parts[2] == "service" {
		s.settingsService(w, r, moduleID)
		return
	}
	writeErr(w, http.StatusNotFound, "not found")
}

func (s *Server) setEnabled(w http.ResponseWriter, r *http.Request, u auth.User, moduleID string) {
	if r.Method != http.MethodPatch {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !u.IsPlatformAdmin {
		writeErr(w, http.StatusForbidden, "Requer permissão de administrador da plataforma")
		return
	}
	var in struct{ Enabled bool `json:"enabled"` }
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "payload inválido")
		return
	}
	status := "disabled"
	if in.Enabled {
		status = "enabled"
	}
	res, err := s.db.ExecContext(r.Context(), "update modules set enabled=$1, status=$2 where id=$3", in.Enabled, status, moduleID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	ra, _ := res.RowsAffected()
	if ra == 0 {
		writeErr(w, http.StatusNotFound, "Módulo não encontrado")
		return
	}
	m, err := s.getModule(r.Context(), moduleID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	health, latency := s.checkModuleHealth(m)
	deps, configured, _ := s.dependenciesAndConfigured(r.Context(), moduleID)
	writeJSON(w, http.StatusOK, governanceOut{ID: m.ID, Name: m.Name, Version: m.Version, Status: m.Status, Enabled: m.Enabled, NavLabel: m.NavLabel, NavOrder: m.NavOrder, Icon: m.Icon, Dependencies: deps, Configured: configured, Health: health, LatencyMS: latency})
}

func (s *Server) settingsAdmin(w http.ResponseWriter, r *http.Request, u auth.User, moduleID string) {
	if !u.IsPlatformAdmin {
		writeErr(w, http.StatusForbidden, "Requer permissão de administrador")
		return
	}
	if _, err := s.getModule(r.Context(), moduleID); err != nil {
		writeErr(w, http.StatusNotFound, "Módulo não encontrado")
		return
	}
	switch r.Method {
	case http.MethodGet:
		rows, err := s.fetchSettings(r.Context(), moduleID)
		if err != nil { writeErr(w, 500, err.Error()); return }
		out := make([]settingOut, 0, len(rows))
		for _, it := range rows {
			if strings.HasPrefix(it.Key, "__meta_") { continue }
			val := it.Value
			if it.IsSecret { val = "***" }
			out = append(out, settingOut{Key: it.Key, Value: val, IsSecret: it.IsSecret})
		}
		writeJSON(w, 200, out)
	case http.MethodPut:
		var body []settingIn
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil { writeErr(w, 400, "payload inválido"); return }
		if err := s.putSettings(r.Context(), moduleID, body); err != nil { writeErr(w, 400, err.Error()); return }
		rows, _ := s.fetchSettings(r.Context(), moduleID)
		out := make([]settingOut, 0, len(rows))
		for _, it := range rows {
			if strings.HasPrefix(it.Key, "__meta_") { continue }
			val := it.Value
			if it.IsSecret { val = "***" }
			out = append(out, settingOut{Key: it.Key, Value: val, IsSecret: it.IsSecret})
		}
		writeJSON(w, 200, out)
	default:
		writeErr(w, 405, "method not allowed")
	}
}

func (s *Server) settingsService(w http.ResponseWriter, r *http.Request, moduleID string) {
	if r.Method != http.MethodGet { writeErr(w, 405, "method not allowed"); return }
	if strings.TrimSpace(r.Header.Get("X-Service-Secret")) != s.cfg.ServiceSecret {
		writeErr(w, 403, "Acesso negado")
		return
	}
	if _, err := s.getModule(r.Context(), moduleID); err != nil {
		writeErr(w, 404, "Módulo não encontrado")
		return
	}
	rows, err := s.fetchSettings(r.Context(), moduleID)
	if err != nil { writeErr(w, 500, err.Error()); return }
	out := make([]settingOut, 0, len(rows))
	for _, it := range rows {
		out = append(out, settingOut{Key: it.Key, Value: it.Value, IsSecret: it.IsSecret})
	}
	writeJSON(w, 200, out)
}

func (s *Server) listModules(w http.ResponseWriter, r *http.Request, u auth.User) {
	includeDisabled := strings.EqualFold(r.URL.Query().Get("include_disabled"), "true") && u.IsPlatformAdmin
	mods, err := s.fetchModules(r.Context(), includeDisabled)
	if err != nil { writeErr(w, 500, err.Error()); return }

	allowed := map[string]bool{}
	all := u.AllowedModules == "*"
	if !all {
		for _, v := range strings.Split(u.AllowedModules, ",") {
			allowed[strings.TrimSpace(v)] = true
		}
	}

	out := make([]moduleOut, 0, len(mods))
	for _, m := range mods {
		if !all && !u.IsPlatformAdmin && !allowed[m.ID] { continue }
		health, latency := s.checkModuleHealth(m)
		out = append(out, moduleOut{ID: m.ID, Name: m.Name, Version: m.Version, Status: m.Status, NavLabel: m.NavLabel, NavOrder: m.NavOrder, Icon: m.Icon, RemoteURL: m.RemoteURL, APIURL: m.APIURL, RequiredRoles: m.RequiredRoles, Health: health, LatencyMS: latency})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].NavOrder < out[j].NavOrder })
	writeJSON(w, 200, out)
}

func (s *Server) withAuth(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h := strings.TrimSpace(r.Header.Get("Authorization"))
		if !strings.HasPrefix(h, "Bearer ") { writeErr(w, 403, "Not authenticated"); return }
		tok := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
		claims, err := auth.ParseToken(tok, s.cfg.JWTSecret)
		if err != nil { writeErr(w, 401, "Token inválido"); return }
		u, err := s.getUser(r.Context(), claims.Subject)
		if err != nil { writeErr(w, 401, "Usuário não encontrado"); return }
		next(w, r, u)
	}
}

func (s *Server) getUser(ctx context.Context, username string) (auth.User, error) {
	var u auth.User
	err := s.db.QueryRowContext(ctx, `select username, hashed_password, role, is_platform_admin, allowed_modules from users where username=$1`, username).
		Scan(&u.Username, &u.HashedPassword, &u.Role, &u.IsPlatformAdmin, &u.AllowedModules)
	return u, err
}

func (s *Server) fetchModules(ctx context.Context, includeDisabled bool) ([]module, error) {
	q := `select id,name,version,status,nav_label,nav_order,icon,remote_url,api_url,health_url,required_roles,enabled from modules`
	if !includeDisabled { q += ` where enabled=true` }
	q += ` order by nav_order`
	rows, err := s.db.QueryContext(ctx, q)
	if err != nil { return nil, err }
	defer rows.Close()
	mods := []module{}
	for rows.Next() {
		var m module
		var rolesJSON []byte
		if err := rows.Scan(&m.ID,&m.Name,&m.Version,&m.Status,&m.NavLabel,&m.NavOrder,&m.Icon,&m.RemoteURL,&m.APIURL,&m.HealthURL,&rolesJSON,&m.Enabled); err != nil { return nil, err }
		if len(rolesJSON) > 0 { _ = json.Unmarshal(rolesJSON, &m.RequiredRoles) }
		if m.RequiredRoles == nil { m.RequiredRoles = []string{} }
		mods = append(mods, m)
	}
	return mods, rows.Err()
}

func (s *Server) getModule(ctx context.Context, id string) (module, error) {
	mods, err := s.fetchModules(ctx, true)
	if err != nil { return module{}, err }
	for _, m := range mods { if m.ID == id { return m, nil } }
	return module{}, errors.New("not found")
}

type settingRow struct{ ID int; Key, Value string; IsSecret bool }

func (s *Server) fetchSettings(ctx context.Context, moduleID string) ([]settingRow, error) {
	rows, err := s.db.QueryContext(ctx, `select id,key,value,is_secret from module_settings where module_id=$1`, moduleID)
	if err != nil { return nil, err }
	defer rows.Close()
	out := []settingRow{}
	for rows.Next() {
		var r settingRow
		if err := rows.Scan(&r.ID, &r.Key, &r.Value, &r.IsSecret); err != nil { return nil, err }
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Server) putSettings(ctx context.Context, moduleID string, body []settingIn) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil { return err }
	defer func(){ _ = tx.Rollback() }()

	existingRows, err := tx.QueryContext(ctx, `select id,key,value,is_secret from module_settings where module_id=$1`, moduleID)
	if err != nil { return err }
	existing := map[string]settingRow{}
	for existingRows.Next() {
		var r settingRow
		if err := existingRows.Scan(&r.ID, &r.Key, &r.Value, &r.IsSecret); err != nil { return err }
		existing[r.Key] = r
	}
	existingRows.Close()

	incoming := map[string]bool{}
	for _, item := range body {
		if strings.HasPrefix(item.Key, "__meta_") { return errors.New("Chave reservada para uso interno") }
		incoming[item.Key] = true
		if row, ok := existing[item.Key]; ok {
			value := item.Value
			if item.IsSecret && item.Value == "***" { value = row.Value }
			if _, err := tx.ExecContext(ctx, `update module_settings set value=$1, is_secret=$2 where id=$3`, value, item.IsSecret, row.ID); err != nil { return err }
		} else {
			if _, err := tx.ExecContext(ctx, `insert into module_settings(module_id,key,value,is_secret) values($1,$2,$3,$4)`, moduleID, item.Key, item.Value, item.IsSecret); err != nil { return err }
		}
	}
	for k, row := range existing {
		if strings.HasPrefix(k, "__meta_") { continue }
		if !incoming[k] {
			if _, err := tx.ExecContext(ctx, `delete from module_settings where id=$1`, row.ID); err != nil { return err }
		}
	}
	return tx.Commit()
}

func (s *Server) dependenciesAndConfigured(ctx context.Context, moduleID string) ([]string, bool, error) {
	rows, err := s.fetchSettings(ctx, moduleID)
	if err != nil { return nil, false, err }
	deps := []string{}
	configured := true
	for _, r := range rows {
		if strings.HasPrefix(r.Key, "__meta_") { continue }
		deps = append(deps, r.Key)
		if strings.TrimSpace(r.Value) == "" { configured = false }
	}
	if len(deps) == 0 { configured = true }
	sort.Strings(deps)
	return deps, configured, nil
}

func (s *Server) checkModuleHealth(m module) (string, *int) {
	url := strings.TrimRight(m.APIURL, "/") + "/health"
	if m.HealthURL.Valid && strings.TrimSpace(m.HealthURL.String) != "" {
		url = strings.TrimRight(strings.TrimSpace(m.HealthURL.String), "/") + "/health"
	}
	client := http.Client{Timeout: time.Duration(s.cfg.HealthTimeoutSec) * time.Second}
	started := time.Now()
	res, err := client.Get(url)
	if err != nil { return "unreachable", nil }
	_ = res.Body.Close()
	lat := int(time.Since(started).Milliseconds())
	if lat < 1 { lat = 1 }
	if res.StatusCode == http.StatusOK { return "healthy", &lat }
	return "degraded", &lat
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Service-Secret")
		if r.Method == http.MethodOptions { w.WriteHeader(http.StatusNoContent); return }
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, status int, detail string) {
	writeJSON(w, status, map[string]string{"detail": detail})
}

func (s *Server) HTTPServer() *http.Server {
	return &http.Server{Addr: ":8000", Handler: s.Routes(), ReadHeaderTimeout: 10 * time.Second}
}

func (s *Server) InitData(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
create table if not exists users (
  username text primary key,
  hashed_password text not null,
  role text not null default 'viewer',
  is_platform_admin boolean default false,
  allowed_modules text default '*'
);
create table if not exists modules (
  id text primary key,
  name text not null,
  description text default '',
  version text not null default '1.0.0',
  status text not null default 'enabled',
  nav_label text not null,
  nav_order integer not null default 99,
  icon text default '📦',
  remote_url text not null,
  api_url text not null,
  health_url text null,
  required_roles jsonb not null default '[]'::jsonb,
  enabled boolean default true
);
create table if not exists module_settings (
  id serial primary key,
  module_id text references modules(id) on delete cascade,
  key text not null,
  value text not null default '',
  is_secret boolean default false
);
`)
	if err != nil {
		return err
	}

	// seed admin if missing
	var count int
	if err := s.db.QueryRowContext(ctx, `select count(*) from users where username='admin'`).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		hash, err := bcryptHash(s.cfg.AdminPassword)
		if err != nil { return err }
		_, err = s.db.ExecContext(ctx, `insert into users(username,hashed_password,role,is_platform_admin,allowed_modules) values('admin',$1,'admin',true,'*')`, hash)
		if err != nil { return err }
	}

	// seed vpn module if missing
	if err := s.db.QueryRowContext(ctx, `select count(*) from modules where id='vpn'`).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		roles := `[
  "admin",
  "operador"
]`
		_, err = s.db.ExecContext(ctx, `insert into modules(id,name,description,version,status,nav_label,nav_order,icon,remote_url,api_url,health_url,required_roles,enabled) values('vpn','VPN','Gerenciamento de túneis VPN e conectividade remota','1.0.0','enabled','VPN',1,'🔐',$1,$1,'http://vpn:8080',$2::jsonb,true)`, "http://localhost:5101", roles)
		if err != nil { return err }
	}

	// seed vpn settings if missing
	for _, k := range []string{"AD_WORKER_URL", "AD_WORKER_TOKEN"} {
		if err := s.db.QueryRowContext(ctx, `select count(*) from module_settings where module_id='vpn' and key=$1`, k).Scan(&count); err != nil { return err }
		if count == 0 {
			isSecret := k == "AD_WORKER_TOKEN"
			if _, err := s.db.ExecContext(ctx, `insert into module_settings(module_id,key,value,is_secret) values('vpn',$1,'',$2)`, k, isSecret); err != nil { return err }
		}
	}

	log.Println("registry data initialized")
	return nil
}

func bcryptHash(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil { return "", fmt.Errorf("bcrypt: %w", err) }
	return string(b), nil
}
