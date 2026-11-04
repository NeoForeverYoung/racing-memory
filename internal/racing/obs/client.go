// Package obs controls OBS Replay Buffer through obs-websocket v5.
package obs

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Client struct {
	conn *websocket.Conn
	mu   sync.Mutex
	next uint64
}

type envelope struct {
	Op int             `json:"op"`
	D  json.RawMessage `json:"d"`
}

func Dial(ctx context.Context, address, password string) (*Client, error) {
	if address == "" {
		address = "ws://127.0.0.1:4455"
	}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, address, nil)
	if err != nil {
		return nil, err
	}
	client := &Client{conn: conn}
	if err := client.identify(password); err != nil {
		conn.Close()
		return nil, err
	}
	return client, nil
}

func (c *Client) identify(password string) error {
	_, raw, err := c.conn.ReadMessage()
	if err != nil {
		return err
	}
	var hello envelope
	if err := json.Unmarshal(raw, &hello); err != nil || hello.Op != 0 {
		return errors.New("OBS did not send a valid Hello")
	}
	var data struct {
		RPCVersion     int `json:"rpcVersion"`
		Authentication *struct {
			Challenge string `json:"challenge"`
			Salt      string `json:"salt"`
		} `json:"authentication"`
	}
	if err := json.Unmarshal(hello.D, &data); err != nil {
		return err
	}
	identify := map[string]any{"rpcVersion": 1}
	if data.Authentication != nil {
		if password == "" {
			return errors.New("OBS websocket requires a password")
		}
		identify["authentication"] = authentication(password, data.Authentication.Salt, data.Authentication.Challenge)
	}
	if err := c.conn.WriteJSON(map[string]any{"op": 1, "d": identify}); err != nil {
		return err
	}
	_, raw, err = c.conn.ReadMessage()
	if err != nil {
		return err
	}
	var identified envelope
	if err := json.Unmarshal(raw, &identified); err != nil || identified.Op != 2 {
		return errors.New("OBS identification failed")
	}
	return nil
}

func (c *Client) EnsureReplayBuffer(ctx context.Context) error {
	var status struct {
		OutputActive bool `json:"outputActive"`
	}
	if err := c.request(ctx, "GetReplayBufferStatus", nil, &status); err != nil {
		return err
	}
	if status.OutputActive {
		return nil
	}
	return c.request(ctx, "StartReplayBuffer", nil, nil)
}

func (c *Client) SaveReplayBuffer(ctx context.Context) (string, error) {
	var result struct {
		SavedReplayPath string `json:"savedReplayPath"`
	}
	if err := c.request(ctx, "SaveReplayBuffer", nil, &result); err != nil {
		return "", err
	}
	if result.SavedReplayPath == "" {
		return "", errors.New("OBS returned an empty replay path")
	}
	return result.SavedReplayPath, nil
}

func (c *Client) request(ctx context.Context, requestType string, requestData any, result any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.next++
	id := fmt.Sprintf("racing-%d", c.next)
	if requestData == nil {
		requestData = map[string]any{}
	}
	if err := c.conn.SetWriteDeadline(deadline(ctx)); err != nil {
		return err
	}
	if err := c.conn.WriteJSON(map[string]any{"op": 6, "d": map[string]any{
		"requestType": requestType, "requestId": id, "requestData": requestData,
	}}); err != nil {
		return err
	}
	if err := c.conn.SetReadDeadline(deadline(ctx)); err != nil {
		return err
	}
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return err
		}
		var message envelope
		if err := json.Unmarshal(raw, &message); err != nil || message.Op != 7 {
			continue
		}
		var response struct {
			RequestID     string `json:"requestId"`
			RequestStatus struct {
				Result  bool   `json:"result"`
				Code    int    `json:"code"`
				Comment string `json:"comment"`
			} `json:"requestStatus"`
			ResponseData json.RawMessage `json:"responseData"`
		}
		if err := json.Unmarshal(message.D, &response); err != nil || response.RequestID != id {
			continue
		}
		if !response.RequestStatus.Result {
			return fmt.Errorf("OBS %s failed (%d): %s", requestType, response.RequestStatus.Code, response.RequestStatus.Comment)
		}
		if result != nil && len(response.ResponseData) > 0 {
			return json.Unmarshal(response.ResponseData, result)
		}
		return nil
	}
}

func (c *Client) Close() error { return c.conn.Close() }

func authentication(password, salt, challenge string) string {
	secretHash := sha256.Sum256([]byte(password + salt))
	secret := base64.StdEncoding.EncodeToString(secretHash[:])
	authHash := sha256.Sum256([]byte(secret + challenge))
	return base64.StdEncoding.EncodeToString(authHash[:])
}

func deadline(ctx context.Context) time.Time {
	if value, ok := ctx.Deadline(); ok {
		return value
	}
	return time.Now().Add(10 * time.Second)
}
