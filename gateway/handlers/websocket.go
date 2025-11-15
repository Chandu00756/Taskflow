package handlers

import (
	"net/http"
	"strings"

	"github.com/chanduchitikam/task-management-system/gateway/websocket"
	"github.com/chanduchitikam/task-management-system/pkg/auth"
)

// WebSocketHandler handles WebSocket connections
type WebSocketHandler struct {
	hub        *websocket.Hub
	jwtManager *auth.JWTManager
}

// NewWebSocketHandler creates a new WebSocket handler
func NewWebSocketHandler(hub *websocket.Hub, jwtManager *auth.JWTManager) *WebSocketHandler {
	return &WebSocketHandler{
		hub:        hub,
		jwtManager: jwtManager,
	}
}

// HandleConnection handles WebSocket connection requests
func (h *WebSocketHandler) HandleConnection(w http.ResponseWriter, r *http.Request) {
	// Extract JWT token from query parameter or Authorization header
	token := r.URL.Query().Get("token")
	if token == "" {
		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}

	if token == "" {
		http.Error(w, "Missing authentication token", http.StatusUnauthorized)
		return
	}

	// Verify JWT token
	claims, err := h.jwtManager.Verify(token)
	if err != nil {
		http.Error(w, "Invalid authentication token", http.StatusUnauthorized)
		return
	}

	// Upgrade connection and start client
	websocket.ServeWs(h.hub, w, r, claims.UserID)
}

// HandleStats returns WebSocket hub statistics
func (h *WebSocketHandler) HandleStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	stats := h.hub.GetStats()

	w.WriteHeader(http.StatusOK)
	// Simple JSON encoding without importing encoding/json again
	w.Write([]byte(`{"total_users":`))
	w.Write([]byte(string(rune(stats["total_users"].(int) + '0'))))
	w.Write([]byte(`,"total_clients":`))
	w.Write([]byte(string(rune(stats["total_clients"].(int) + '0'))))
	w.Write([]byte(`}`))
}

// HandleOnlineUsers returns list of online users
func (h *WebSocketHandler) HandleOnlineUsers(w http.ResponseWriter, r *http.Request) {
	users := h.hub.GetOnlineUsers()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	// Simple JSON array encoding
	w.Write([]byte(`{"users":[`))
	for i, user := range users {
		if i > 0 {
			w.Write([]byte(`,`))
		}
		w.Write([]byte(`"`))
		w.Write([]byte(user))
		w.Write([]byte(`"`))
	}
	w.Write([]byte(`]}`))
}
