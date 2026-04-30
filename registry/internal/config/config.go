package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	PostgresURL      string
	JWTSecret        string
	JWTAlgorithm     string
	JWTExpireMinutes int
	ServiceSecret    string
	AdminPassword    string
	HealthTimeoutSec int
}

func Load() Config {
	return Config{
		PostgresURL:      env("POSTGRES_URL", "postgresql://commandops:commandops@postgres:5432/commandops_registry"),
		JWTSecret:        env("JWT_SECRET", "dev-secret-change-in-prod"),
		JWTAlgorithm:     env("JWT_ALGORITHM", "HS256"),
		JWTExpireMinutes: envInt("JWT_EXPIRE_MINUTES", 480),
		ServiceSecret:    env("SERVICE_SECRET", "dev-service-secret-change-in-prod"),
		AdminPassword:    env("ADMIN_PASSWORD", "admin"),
		HealthTimeoutSec: envInt("MODULE_HEALTH_TIMEOUT_SECONDS", 3),
	}
}

func env(k, d string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return d
}

func envInt(k string, d int) int {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" {
		return d
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return d
	}
	return n
}
