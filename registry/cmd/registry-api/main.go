package main

import (
	"context"
	"log"

	"commandops/registry/internal/api"
	"commandops/registry/internal/config"
	"commandops/registry/internal/db"
)

func main() {
	cfg := config.Load()
	database, err := db.Open(cfg.PostgresURL)
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()

	s := api.New(cfg, database)
	if err := s.InitData(context.Background()); err != nil {
		log.Fatal(err)
	}
	log.Println("registry listening on :8000")
	if err := s.HTTPServer().ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
