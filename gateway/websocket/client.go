package websocket

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// 	// 	// Time allowed to write a message to the peer
	writeWait = 10 * time.Second

	// 	// 	// Time allowed to read the next pong message from the peer
	pongWait = 60 * time.Second

	// 	// 	// Send pings to peer with this period (must be less than pongWait)
	pingPeriod = (pongWait * 9) / 10

	// 	// 	// Maximum message size allowed from peer
	maxMessageSize = 512 * 1024 // 512 KB
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// 		// 		// Allow all origins (configure this properly in production)
		return true
	},
}

// // // readPump pumps messages from the WebSocket connection to the hub
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		c.mu.Lock()
		c.lastPing = time.Now()
		c.mu.Unlock()
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		// 		// 		// Handle incoming messages
		var msg Message
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("Failed to unmarshal message: %v", err)
			continue
		}

		// 		// 		// Handle ping messages
		if msg.Type == MessageTypePing {
			c.send <- []byte(`{"type":"pong","timestamp":"` + time.Now().Format(time.RFC3339) + `"}`)
			continue
		}

		// 		// 		// You can add more client-to-server message handling here
		log.Printf("Received message from client %s: %s", c.userID, msg.Type)
	}
}

// // // writePump pumps messages from the hub to the WebSocket connection
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// 				// 				// The hub closed the channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// 			// 			// Add queued messages to the current WebSocket message
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// // // ServeWs handles WebSocket requests from clients
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request, userID string) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Failed to upgrade connection: %v", err)
		return
	}

	client := &Client{
		hub:      hub,
		conn:     conn,
		send:     make(chan []byte, 256),
		userID:   userID,
		lastPing: time.Now(),
	}

	client.hub.register <- client

	// 	// 	// Start read and write pumps in separate goroutines
	go client.writePump()
	go client.readPump()
}
