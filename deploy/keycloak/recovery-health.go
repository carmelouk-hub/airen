package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	http.HandleFunc("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, "{\"status\":\"UP\",\"mode\":\"keycloak-recovery\"}")
	})
	http.HandleFunc("/health/live", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, "{\"status\":\"UP\",\"mode\":\"keycloak-recovery\"}")
	})
	log.Fatal(http.ListenAndServe(":10000", nil))
}
