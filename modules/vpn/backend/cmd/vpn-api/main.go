package main

import (
	"log"

	"commandops/modules/vpn/backend/internal/api"
	"commandops/modules/vpn/backend/internal/config"
)

func main() {
	cfg := config.Load()
	srv := api.New(cfg).HTTPServer()
	log.Printf("vpn-go listening on %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
