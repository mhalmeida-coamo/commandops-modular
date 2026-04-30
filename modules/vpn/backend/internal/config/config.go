package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	JWTSecret        string
	RegistryURL      string
	ServiceSecret    string
	ADWorkerURL      string
	ADWorkerToken    string
	ShellOrigin      string
	ADWorkerTimeout  time.Duration
	SettingsCacheTTL time.Duration
}

func Load() Config {
	timeout := envInt("AD_WORKER_TIMEOUT_SECONDS", 30)
	cacheTTL := envInt("SETTINGS_CACHE_TTL_SECONDS", 60)

	return Config{
		JWTSecret:        env("JWT_SECRET", "dev-secret-change-in-prod"),
		RegistryURL:      strings.TrimRight(strings.TrimSpace(os.Getenv("REGISTRY_URL")), "/"),
		ServiceSecret:    strings.TrimSpace(os.Getenv("SERVICE_SECRET")),
		ADWorkerURL:      strings.TrimRight(strings.TrimSpace(os.Getenv("AD_WORKER_URL")), "/"),
		ADWorkerToken:    strings.TrimSpace(os.Getenv("AD_WORKER_TOKEN")),
		ShellOrigin:      env("SHELL_ORIGIN", "http://localhost:5000"),
		ADWorkerTimeout:  time.Duration(timeout) * time.Second,
		SettingsCacheTTL: time.Duration(cacheTTL) * time.Second,
	}
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}
