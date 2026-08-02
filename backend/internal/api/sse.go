package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

// sseWriter streams named events to a client.
//
// It serializes writes because the pipeline emits from several goroutines: the
// checks land as they complete, and two interleaved event frames would be
// unparseable rather than merely out of order.
type sseWriter struct {
	mu      sync.Mutex
	w       http.ResponseWriter
	flusher http.Flusher
	closed  bool
}

func newSSE(w http.ResponseWriter) (*sseWriter, bool) {
	f, ok := w.(http.Flusher)
	if !ok {
		return nil, false
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	// Without this an intermediary can hold the whole stream and defeat the
	// entire point of streaming stages.
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	f.Flush()
	return &sseWriter{w: w, flusher: f}, true
}

// Emit writes one event. Payloads are single-line JSON, so no data frame ever
// needs continuation.
func (s *sseWriter) Emit(event string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal %s event: %w", event, err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	if _, err := fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", event, body); err != nil {
		s.closed = true
		return fmt.Errorf("write %s event: %w", event, err)
	}
	s.flusher.Flush()
	return nil
}
