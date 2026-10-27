// Package publishworker is an offline, database-free static publication worker.
// Its only control plane is the fixed HTTP protocol over a private Unix socket.
package publishworker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

const MaxMessage = 1 << 20

type ResultResponse = publishmodel.ResultResponse

type Control interface {
	Claim(context.Context) (*publishmodel.Assignment, error)
	Heartbeat(context.Context, string, publishmodel.HeartbeatRequest) error
	Prepared(context.Context, string, publishmodel.PreparedRequest) (publishmodel.PreparedResponse, error)
	Result(context.Context, string, publishmodel.ResultRequest) (ResultResponse, error)
}

type UnixClient struct{ http *http.Client }

func NewUnixClient(socket string) (*UnixClient, error) {
	if !filepath.IsAbs(socket) || len(socket) > 200 {
		return nil, errors.New("invalid publisher socket")
	}
	dialer := net.Dialer{Timeout: 5 * time.Second}
	transport := &http.Transport{Proxy: nil, DisableCompression: true, MaxConnsPerHost: 2, ResponseHeaderTimeout: 45 * time.Second,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, "unix", socket)
		},
	}
	return &UnixClient{http: &http.Client{Transport: transport, Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (c *UnixClient) call(ctx context.Context, endpoint string, body, target any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	if len(data) > MaxMessage {
		return errors.New("publisher request too large")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://publisher"+publishmodel.InternalPrefix+endpoint, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	response, err := c.http.Do(req)
	if err != nil {
		return errors.New("publisher control unavailable")
	}
	defer response.Body.Close()
	data, err = io.ReadAll(io.LimitReader(response.Body, MaxMessage+1))
	if err != nil || len(data) > MaxMessage {
		return errors.New("invalid publisher response")
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("publisher control status %d", response.StatusCode)
	}
	var envelope struct {
		Data      json.RawMessage `json:"data"`
		RequestID string          `json:"requestId,omitempty"`
	}
	if err = strictJSON(data, &envelope); err != nil {
		return err
	}
	if len(envelope.Data) == 0 {
		return errors.New("missing publisher response")
	}
	if target == nil {
		return nil
	}
	return strictJSON(envelope.Data, target)
}

func strictJSON(data []byte, target any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		return errors.New("invalid publisher JSON")
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("invalid publisher JSON")
	}
	return nil
}

func (c *UnixClient) Claim(ctx context.Context) (*publishmodel.Assignment, error) {
	var r publishmodel.ClaimResponse
	err := c.call(ctx, "/claim", publishmodel.ClaimRequest{ProtocolVersion: 1, WorkerID: publishmodel.WorkerID}, &r)
	return r.Job, err
}
func (c *UnixClient) Heartbeat(ctx context.Context, id string, r publishmodel.HeartbeatRequest) error {
	return c.call(ctx, "/jobs/"+id+"/heartbeat", r, nil)
}
func (c *UnixClient) Prepared(ctx context.Context, id string, r publishmodel.PreparedRequest) (publishmodel.PreparedResponse, error) {
	var response publishmodel.PreparedResponse
	err := c.call(ctx, "/jobs/"+id+"/prepared", r, &response)
	return response, err
}
func (c *UnixClient) Result(ctx context.Context, id string, r publishmodel.ResultRequest) (ResultResponse, error) {
	var response ResultResponse
	err := c.call(ctx, "/jobs/"+id+"/result", r, &response)
	return response, err
}
