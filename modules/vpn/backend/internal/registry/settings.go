package registry

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

type settingItem struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type SettingsClient struct {
	baseURL       string
	serviceSecret string
	ttl           time.Duration
	httpClient    *http.Client

	mu      sync.RWMutex
	cache   map[string]string
	cacheAt time.Time
}

func NewSettingsClient(baseURL, serviceSecret string, ttl time.Duration) *SettingsClient {
	return &SettingsClient{
		baseURL:       baseURL,
		serviceSecret: serviceSecret,
		ttl:           ttl,
		httpClient:    &http.Client{Timeout: 5 * time.Second},
		cache:         map[string]string{},
	}
}

func (c *SettingsClient) GetVPNSettings(ctx context.Context) map[string]string {
	if c.baseURL == "" || c.serviceSecret == "" {
		return c.getCacheCopy()
	}

	c.mu.RLock()
	fresh := !c.cacheAt.IsZero() && time.Since(c.cacheAt) < c.ttl
	c.mu.RUnlock()
	if fresh {
		return c.getCacheCopy()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/modules/vpn/settings/service", nil)
	if err != nil {
		return c.getCacheCopy()
	}
	req.Header.Set("X-Service-Secret", c.serviceSecret)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return c.getCacheCopy()
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return c.getCacheCopy()
	}

	var items []settingItem
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return c.getCacheCopy()
	}

	next := make(map[string]string, len(items))
	for _, item := range items {
		next[item.Key] = item.Value
	}

	c.mu.Lock()
	c.cache = next
	c.cacheAt = time.Now()
	c.mu.Unlock()

	return c.getCacheCopy()
}

func (c *SettingsClient) getCacheCopy() map[string]string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make(map[string]string, len(c.cache))
	for k, v := range c.cache {
		out[k] = v
	}
	return out
}
