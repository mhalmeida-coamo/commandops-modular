package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Host            string
	Port            string
	WorkerToken     string
	Realm           string
	Domain          string
	BaseDN          string
	LDAPServer      string
	LDAPPort        int
	KRB5Config      string
	KeytabPath      string
	ServicePrincipal string
	AutoKinit       bool
}

func Load() Config {
	host := strings.TrimSpace(os.Getenv("AD_WORKER_HOST"))
	if host == "" {
		host = "0.0.0.0"
	}
	port := strings.TrimSpace(os.Getenv("AD_WORKER_PORT"))
	if port == "" {
		port = "8010"
	}
	ldapPort := 389
	if p := strings.TrimSpace(os.Getenv("AD_LDAP_PORT")); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			ldapPort = v
		}
	}
	return Config{
		Host:           host,
		Port:           port,
		WorkerToken:    strings.TrimSpace(os.Getenv("AD_WORKER_API_TOKEN")),
		Realm:          env("AD_REALM", "COAMO.COM.BR"),
		Domain:         env("AD_DOMAIN", "coamo.com.br"),
		BaseDN:         env("AD_BASE_DN", "DC=coamo,DC=com,DC=br"),
		LDAPServer:     env("AD_LDAP_SERVER", "admdc01.coamo.com.br"),
		LDAPPort:       ldapPort,
		KRB5Config:     env("AD_KRB5_CONFIG", "/etc/krb5.conf"),
		KeytabPath:     env("AD_KEYTAB_PATH", "/run/secrets/svc_infratools_ad.keytab"),
		ServicePrincipal: env("AD_SERVICE_PRINCIPAL", "svc_infratools_ad@COAMO.COM.BR"),
		AutoKinit:      asBool(env("AD_WORKER_AUTO_KINIT", "true")),
	}
}

func env(k, d string) string {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" {
		return d
	}
	return v
}

func asBool(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
