package main

import (
	"log"
	"net/http"

	"commandops/services/adworker/internal/api"
	"commandops/services/adworker/internal/config"
)

func main() {
	cfg := config.Load()
	srv := api.New(cfg)
	addr := cfg.Host + ":" + cfg.Port
	log.Printf("adworker listening on %s", addr)
	if err := http.ListenAndServe(addr, srv.Handler()); err != nil {
		log.Fatal(err)
	}
}
