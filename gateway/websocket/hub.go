package websocket

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Message types for WebSocket communication
const (
	MessageTypeTaskCreated  = "task.created"
	MessageTypeTaskUpdated  = "task.updated"
	MessageTypeTaskDeleted  = "task.deleted"
	MessageTypeTaskAssigned = "task.assigned"
	MessageTypeNotification = "notification.new"
	MessageTypeUserOnline   = "user.online"
	MessageTypeUserOffline  = "user.offline"
	MessageTypePing         = "ping"
	MessageTypePong         = "pong"
)

// Message represents a WebSocket message
type Message struct {
	Type      string                 `json:"type"`
	UserID    string                 `json:"user_id,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
	Data      map[string]interface{} `json:"data"`
}

// Client represents a WebSocket client connection
type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	send     chan []byte
	userID   string
	mu       sync.Mutex
	lastPing time.Time
}

// Hub maintains active WebSocket clients and broadcasts messages
type Hub struct {
	clients    map[string]map[*Client]bool // userID -> clients
	broadcast  chan *Message
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

// NewHub creates a new WebSocket hub
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[string]map[*Client]bool),
		broadcast:  make(chan *Message, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// Run starts the hub's main loop
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.registerClient(client)

		case client := <-h.unregister:
			h.unregisterClient(client)

		case message := <-h.broadcast:
			h.broadcastMessage(message)
		}
	}
}

// registerClient registers a new client
func (h *Hub) registerClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.clients[client.userID] == nil {
		h.clients[client.userID] = make(map[*Client]bool)
	}
	h.clients[client.userID][client] = true

	log.Printf("Client registered: userID=%s, total_clients=%d", client.userID, h.getTotalClients())

	// Broadcast user online status
	h.broadcast <- &Message{
		Type:      MessageTypeUserOnline,
		UserID:    client.userID,
		Timestamp: time.Now(),
		Data: map[string]interface{}{
			"user_id": client.userID,
		},
	}
}

// unregisterClient unregisters a client
func (h *Hub) unregisterClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if clients, ok := h.clients[client.userID]; ok {
		if _, exists := clients[client]; exists {
			delete(clients, client)
			close(client.send)

			// Remove user entry if no more clients
			if len(clients) == 0 {
				delete(h.clients, client.userID)

				// Broadcast user offline status
				h.broadcast <- &Message{
					Type:      MessageTypeUserOffline,
					UserID:    client.userID,
					Timestamp: time.Now(),
					Data: map[string]interface{}{
						"user_id": client.userID,
					},
				}
			}

			log.Printf("Client unregistered: userID=%s, total_clients=%d", client.userID, h.getTotalClients())
		}
	}
}

// broadcastMessage broadcasts a message to relevant clients
func (h *Hub) broadcastMessage(message *Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	data, err := json.Marshal(message)
	if err != nil {
		log.Printf("Failed to marshal message: %v", err)
		return
	}

	// If message has a specific userID, send only to that user's clients
	if message.UserID != "" {
		if clients, ok := h.clients[message.UserID]; ok {
			for client := range clients {
				select {
				case client.send <- data:
				default:
					log.Printf("Client send buffer full, closing connection: userID=%s", message.UserID)
					close(client.send)
					delete(clients, client)
				}
			}
		}
	} else {
		// Broadcast to all clients
		for _, clients := range h.clients {
			for client := range clients {
				select {
				case client.send <- data:
				default:
					log.Printf("Client send buffer full, closing connection: userID=%s", client.userID)
					close(client.send)
					delete(clients, client)
				}
			}
		}
	}
}

// BroadcastToUser sends a message to all connections of a specific user
func (h *Hub) BroadcastToUser(userID string, messageType string, data map[string]interface{}) {
	h.broadcast <- &Message{
		Type:      messageType,
		UserID:    userID,
		Timestamp: time.Now(),
		Data:      data,
	}
}

// BroadcastToAll sends a message to all connected clients
func (h *Hub) BroadcastToAll(messageType string, data map[string]interface{}) {
	h.broadcast <- &Message{
		Type:      messageType,
		Timestamp: time.Now(),
		Data:      data,
	}
}

// GetOnlineUsers returns a list of currently online user IDs
func (h *Hub) GetOnlineUsers() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()

	users := make([]string, 0, len(h.clients))
	for userID := range h.clients {
		users = append(users, userID)
	}
	return users
}

// IsUserOnline checks if a user is currently online
func (h *Hub) IsUserOnline(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()

	clients, ok := h.clients[userID]
	return ok && len(clients) > 0
}

// getTotalClients returns total number of connected clients
func (h *Hub) getTotalClients() int {
	total := 0
	for _, clients := range h.clients {
		total += len(clients)
	}
	return total
}

// GetStats returns hub statistics
func (h *Hub) GetStats() map[string]interface{} {
	h.mu.RLock()
	defer h.mu.RUnlock()

	return map[string]interface{}{
		"total_users":      len(h.clients),
		"total_clients":    h.getTotalClients(),
		"broadcast_buffer": len(h.broadcast),
	}
}
