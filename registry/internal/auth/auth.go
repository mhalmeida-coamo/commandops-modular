package auth

import (
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	Username        string
	HashedPassword  string
	Role            string
	IsPlatformAdmin bool
	AllowedModules  string
}

type Claims struct {
	Role            string   `json:"role"`
	IsPlatformAdmin bool     `json:"is_platform_admin"`
	AllowedModules  []string `json:"allowed_modules"`
	jwt.RegisteredClaims
}

func VerifyPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func AllowedList(raw string) []string {
	if strings.TrimSpace(raw) == "*" {
		return []string{"*"}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return []string{"*"}
	}
	return out
}

func CreateToken(user User, secret string, expireMinutes int) (string, error) {
	exp := time.Now().UTC().Add(time.Duration(expireMinutes) * time.Minute)
	claims := Claims{
		Role:            user.Role,
		IsPlatformAdmin: user.IsPlatformAdmin,
		AllowedModules:  AllowedList(user.AllowedModules),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.Username,
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString([]byte(secret))
}

func ParseToken(tokenStr, secret string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("invalid signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if claims.Subject == "" {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
