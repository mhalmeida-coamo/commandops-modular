package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"commandops/services/adworker/internal/config"
)

type Server struct {
	cfg config.Config
}

type vpnStatusIn struct {
	Username string `json:"username"`
}

type vpnProcessIn struct {
	Username string `json:"username"`
	Enabled  bool   `json:"enabled"`
}

func New(cfg config.Config) *Server { return &Server{cfg: cfg} }

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/health/ready", s.ready)
	mux.HandleFunc("/capabilities", s.withToken(s.capabilities))
	mux.HandleFunc("/auth/kinit", s.withToken(s.kinitHandler))
	mux.HandleFunc("/operations/vpn-user/status", s.withToken(s.vpnStatus))
	mux.HandleFunc("/operations/vpn-user/execute", s.withToken(s.vpnExecute))
	return mux
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"component": "ad-worker-go",
		"kerberos": map[string]any{
			"realm":             s.cfg.Realm,
			"domain":            s.cfg.Domain,
			"krb5_config":       s.cfg.KRB5Config,
			"service_principal": s.cfg.ServicePrincipal,
			"keytab_present":    fileExists(s.cfg.KeytabPath),
		},
		"ldap": map[string]any{"server": s.cfg.LDAPServer, "port": s.cfg.LDAPPort},
		"ticket_loaded": hasTicket(s.cfg.KRB5Config),
		"capabilities":  []string{"vpn_toggle", "vpn_status"},
	})
}

func (s *Server) ready(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ready":            hasTicket(s.cfg.KRB5Config) && fileExists(s.cfg.KeytabPath) && s.cfg.WorkerToken != "",
		"token_configured": s.cfg.WorkerToken != "",
		"keytab_present":   fileExists(s.cfg.KeytabPath),
		"ticket_loaded":    hasTicket(s.cfg.KRB5Config),
	})
}

func (s *Server) capabilities(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"items": []string{"vpn_toggle", "vpn_status"}})
}

func (s *Server) kinitHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if err := s.ensureTicket(); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "ticket kerberos obtido"})
}

func (s *Server) vpnStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var in vpnStatusIn
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "payload inválido")
		return
	}
	username := strings.TrimSpace(in.Username)
	if len(username) < 3 {
		writeErr(w, http.StatusBadRequest, "username inválido")
		return
	}
	if err := s.ensureTicket(); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}

	userDN, attrs, err := s.findUser(username)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	login := firstNonEmpty(attrs["sAMAccountName"], username)
	display := firstNonEmpty(attrs["displayName"], login)
	vpnValue := "NOT_SET"
	if strings.EqualFold(firstNonEmpty(attrs["msNPAllowDialin"], ""), "TRUE") {
		vpnValue = "TRUE"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"username":    username,
		"login":       login,
		"display_name": display,
		"user_dn":     userDN,
		"vpn_value":   vpnValue,
	})
}

func (s *Server) vpnExecute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var in vpnProcessIn
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "payload inválido")
		return
	}
	username := strings.TrimSpace(in.Username)
	if len(username) < 3 {
		writeErr(w, http.StatusBadRequest, "username inválido")
		return
	}
	if err := s.ensureTicket(); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}

	userDN, attrs, err := s.findUser(username)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	login := firstNonEmpty(attrs["sAMAccountName"], username)
	display := firstNonEmpty(attrs["displayName"], login)
	company := firstNonEmpty(attrs["company"], "")
	prevVpn := "NOT_SET"
	if strings.EqualFold(firstNonEmpty(attrs["msNPAllowDialin"], ""), "TRUE") {
		prevVpn = "TRUE"
	}

	warnings := []string{}
	vpnValue := prevVpn
	if in.Enabled {
		if err := s.modifyReplace(userDN, "msNPAllowDialin", "TRUE"); err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		vpnValue = "TRUE"
	} else {
		if prevVpn == "TRUE" {
			if err := s.modifyDelete(userDN, "msNPAllowDialin"); err != nil {
				writeErr(w, http.StatusBadGateway, err.Error())
				return
			}
		}
		vpnValue = "NOT_SET"
	}

	memberOf := parseMultiValues(attrs["memberOf"])
	memberSet := map[string]bool{}
	for _, g := range memberOf {
		memberSet[strings.ToUpper(strings.TrimSpace(g))] = true
	}

	caGroup := "CA - Bloqueio Ext"
	caDN, caFound := s.resolveGroupDN(caGroup)
	bloqAction := "not_found"
	if caFound {
		bloqAction = s.groupModify(caDN, userDN, memberSet, !in.Enabled, &warnings)
	} else {
		warnings = append(warnings, fmt.Sprintf("Grupo '%s' não encontrado no AD.", caGroup))
	}

	legacyGroup := "Bloqueio_Webmail"
	if in.Enabled {
		if legacyDN, ok := s.resolveGroupDN(legacyGroup); ok {
			legacyAction := s.groupModify(legacyDN, userDN, memberSet, false, &warnings)
			if legacyAction == "removed" {
				warnings = append(warnings, "Grupo legado 'Bloqueio_Webmail' removido — usuário migrado para 'CA - Bloqueio Ext'.")
			}
		}
	}

	internetGroup := internetMailGroup(company)
	internetDN, internetFound := s.resolveGroupDN(internetGroup)
	internetAction := "not_found"
	if internetFound {
		if in.Enabled {
			internetAction = s.groupModify(internetDN, userDN, memberSet, true, &warnings)
		} else {
			blockEmailDN, ok := s.resolveGroupDN("Bloqueio_envio_Email_Externo_Office365")
			hasBlockEmail := ok && memberSet[strings.ToUpper(blockEmailDN)]
			if hasBlockEmail {
				internetAction = s.groupModify(internetDN, userDN, memberSet, false, &warnings)
			} else {
				internetAction = "already_present"
			}
		}
	} else {
		warnings = append(warnings, fmt.Sprintf("Grupo InternetMail '%s' não encontrado no AD.", internetGroup))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":              "ok",
		"username":            username,
		"login":               login,
		"display_name":        display,
		"user_dn":             userDN,
		"previous_vpn_value":  prevVpn,
		"vpn_value":           vpnValue,
		"bloqueio_ext_action": bloqAction,
		"internet_mail_action": internetAction,
		"internet_mail_group":  internetGroup,
		"warnings":             warnings,
	})
}

func (s *Server) findUser(username string) (string, map[string]string, error) {
	safe := ldapEscape(username)
	filter := fmt.Sprintf("(&(objectClass=person)(|(sAMAccountName=%s)(mail=%s)(userPrincipalName=%s)))", safe, safe, safe)
	rows, err := s.ldapSearch(s.cfg.BaseDN, filter, []string{"distinguishedName", "sAMAccountName", "displayName", "company", "msNPAllowDialin", "memberOf"})
	if err != nil || len(rows) == 0 {
		return "", nil, fmt.Errorf("Usuário não encontrado: %s", username)
	}
	attrs := rows[0]
	dn := firstNonEmpty(attrs["dn"], attrs["distinguishedName"])
	if dn == "" {
		return "", nil, fmt.Errorf("Usuário não encontrado: %s", username)
	}
	return dn, attrs, nil
}

func (s *Server) resolveGroupDN(group string) (string, bool) {
	raw := strings.TrimSpace(group)
	if raw == "" {
		return "", false
	}
	if strings.Contains(strings.ToUpper(raw), "DC=") && strings.Contains(raw, ",") {
		return raw, true
	}
	safe := ldapEscape(raw)
	filter := fmt.Sprintf("(&(objectClass=group)(|(sAMAccountName=%s)(cn=%s)(name=%s)))", safe, safe, safe)
	rows, err := s.ldapSearch(s.cfg.BaseDN, filter, []string{"distinguishedName"})
	if err != nil || len(rows) == 0 {
		return "", false
	}
	dn := firstNonEmpty(rows[0]["distinguishedName"], rows[0]["dn"])
	if dn == "" {
		return "", false
	}
	return dn, true
}

func (s *Server) groupModify(groupDN, userDN string, memberSet map[string]bool, add bool, warnings *[]string) string {
	groupKey := strings.ToUpper(strings.TrimSpace(groupDN))
	inGroup := memberSet[groupKey]
	if add {
		if inGroup {
			return "already_present"
		}
		if err := s.modifyAdd(groupDN, "member", userDN); err != nil {
			*warnings = append(*warnings, fmt.Sprintf("Falha ao adicionar grupo: %v", err))
			return "failed"
		}
		return "added"
	}
	if !inGroup {
		return "already_absent"
	}
	if err := s.modifyDeleteValue(groupDN, "member", userDN); err != nil {
		*warnings = append(*warnings, fmt.Sprintf("Falha ao remover grupo: %v", err))
		return "failed"
	}
	return "removed"
}

func (s *Server) ensureTicket() error {
	if hasTicket(s.cfg.KRB5Config) {
		return nil
	}
	if !fileExists(s.cfg.KeytabPath) {
		return fmt.Errorf("keytab ausente")
	}
	cmd := exec.Command("kinit", "-k", "-t", s.cfg.KeytabPath, s.cfg.ServicePrincipal)
	cmd.Env = append(os.Environ(), "KRB5_CONFIG="+s.cfg.KRB5Config)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf(msg)
	}
	return nil
}

func hasTicket(krb5Config string) bool {
	cmd := exec.Command("klist", "-s")
	cmd.Env = append(os.Environ(), "KRB5_CONFIG="+krb5Config)
	return cmd.Run() == nil
}

func (s *Server) ldapSearch(baseDN, filter string, attrs []string) ([]map[string]string, error) {
	args := []string{"-LLL", "-Y", "GSSAPI", "-H", fmt.Sprintf("ldap://%s:%d", s.cfg.LDAPServer, s.cfg.LDAPPort), "-b", baseDN, filter}
	args = append(args, attrs...)
	cmd := exec.Command("ldapsearch", args...)
	cmd.Env = append(os.Environ(), "KRB5_CONFIG="+s.cfg.KRB5Config)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf(strings.TrimSpace(string(out)))
	}
	return parseLDIF(string(out)), nil
}

func (s *Server) ldapModify(ldif string) error {
	cmd := exec.Command("ldapmodify", "-Y", "GSSAPI", "-H", fmt.Sprintf("ldap://%s:%d", s.cfg.LDAPServer, s.cfg.LDAPPort))
	cmd.Env = append(os.Environ(), "KRB5_CONFIG="+s.cfg.KRB5Config)
	cmd.Stdin = strings.NewReader(ldif)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf(strings.TrimSpace(string(out)))
	}
	return nil
}

func (s *Server) modifyReplace(dn, attr, value string) error {
	ldif := fmt.Sprintf("dn: %s\nchangetype: modify\nreplace: %s\n%s: %s\n\n", dn, attr, attr, value)
	return s.ldapModify(ldif)
}

func (s *Server) modifyDelete(dn, attr string) error {
	ldif := fmt.Sprintf("dn: %s\nchangetype: modify\ndelete: %s\n\n", dn, attr)
	return s.ldapModify(ldif)
}

func (s *Server) modifyDeleteValue(dn, attr, value string) error {
	ldif := fmt.Sprintf("dn: %s\nchangetype: modify\ndelete: %s\n%s: %s\n\n", dn, attr, attr, value)
	return s.ldapModify(ldif)
}

func (s *Server) modifyAdd(dn, attr, value string) error {
	ldif := fmt.Sprintf("dn: %s\nchangetype: modify\nadd: %s\n%s: %s\n\n", dn, attr, attr, value)
	return s.ldapModify(ldif)
}

func (s *Server) withToken(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := strings.TrimSpace(r.Header.Get("X-Worker-Token"))
		if strings.TrimSpace(s.cfg.WorkerToken) == "" {
			writeErr(w, http.StatusServiceUnavailable, "AD worker token nao configurado")
			return
		}
		if tok == "" || tok != s.cfg.WorkerToken {
			writeErr(w, http.StatusUnauthorized, "Token do worker invalido")
			return
		}
		next(w, r)
	}
}

func parseLDIF(s string) []map[string]string {
	lines := []string{}
	sc := bufio.NewScanner(strings.NewReader(s))
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	joined := []string{}
	for _, l := range lines {
		if strings.HasPrefix(l, " ") && len(joined) > 0 {
			joined[len(joined)-1] += strings.TrimPrefix(l, " ")
			continue
		}
		joined = append(joined, l)
	}

	entries := []map[string]string{}
	cur := map[string]string{}
	for _, l := range joined {
		if strings.TrimSpace(l) == "" {
			if len(cur) > 0 {
				entries = append(entries, cur)
				cur = map[string]string{}
			}
			continue
		}
		parts := strings.SplitN(l, ":", 2)
		if len(parts) != 2 {
			continue
		}
		k := strings.TrimSpace(parts[0])
		v := strings.TrimSpace(parts[1])
		if old, ok := cur[k]; ok && old != "" {
			cur[k] = old + "\n" + v
		} else {
			cur[k] = v
		}
	}
	if len(cur) > 0 {
		entries = append(entries, cur)
	}
	return entries
}

func parseMultiValues(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, "\n")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func ldapEscape(in string) string {
	rep := strings.NewReplacer(
		"\\", "\\5c",
		"*", "\\2a",
		"(", "\\28",
		")", "\\29",
		"\x00", "\\00",
	)
	return rep.Replace(in)
}

func internetMailGroup(company string) string {
	upper := strings.ToUpper(strings.TrimSpace(company))
	compact := strings.ReplaceAll(upper, " ", "")
	switch {
	case strings.Contains(upper, "CREDICOAMO SEGUROS") || strings.Contains(compact, "CREDICOAMOSEGUROS"):
		return "InternetMail - CredicoamoSeguros"
	case strings.Contains(upper, "VIA SOLLUS") || strings.Contains(compact, "VIASOLLUS"):
		return "InternetMail - Via Sollus"
	case strings.Contains(upper, "CREDICOAMO"):
		return "InternetMail - Credicoamo"
	case strings.Contains(upper, "FUPS"):
		return "InternetMail - FUPS"
	case strings.Contains(upper, "ARCAM"):
		return "InternetMail - ARCAM"
	default:
		return "InternetMail"
	}
}

func firstNonEmpty(v ...string) string {
	for _, x := range v {
		x = strings.TrimSpace(x)
		if x != "" {
			return x
		}
	}
	return ""
}

func fileExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	_, err := os.Stat(filepath.Clean(path))
	return err == nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, status int, detail string) {
	writeJSON(w, status, map[string]string{"detail": detail})
}
