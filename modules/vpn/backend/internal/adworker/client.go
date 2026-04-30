package adworker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	httpClient *http.Client
}

func New(timeout time.Duration) *Client {
	return &Client{httpClient: &http.Client{Timeout: timeout}}
}

func (c *Client) Post(ctx context.Context, url, token string, payload any) (map[string]any, int, string, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(url, "/"), bytes.NewReader(body))
	if err != nil {
		return nil, 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Worker-Token", token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		if nerr, ok := err.(net.Error); ok && nerr.Timeout() {
			return nil, http.StatusGatewayTimeout, "AD Worker timeout", nil
		}
		return nil, http.StatusServiceUnavailable, fmt.Sprintf("AD Worker indisponível: %v", err), nil
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail := strings.TrimSpace(string(data))
		if detail == "" {
			detail = "erro desconhecido"
		}
		return nil, http.StatusBadGateway, fmt.Sprintf("AD Worker error: %s", detail), nil
	}

	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, http.StatusBadGateway, "AD Worker error: resposta inválida", nil
	}
	return out, 0, "", nil
}
