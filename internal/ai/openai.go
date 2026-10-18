package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
)

// OpenAI calls any OpenAI-compatible /chat/completions endpoint (OpenAI, Azure OpenAI,
// Ollama, vLLM, LM Studio, OpenRouter) over plain HTTP.
type OpenAI struct {
	name    string
	baseURL string
	apiKey  string
	http    *http.Client
	// jsonMode is the strongest response_format the endpoint accepted: 2 json_schema,
	// 1 json_object, 0 none. It steps down when a server rejects a mode.
	jsonMode atomic.Int32
	// headers are sent with every request (OpenRouter attribution).
	headers map[string]string
	// extra is merged into every request body (OpenRouter provider routing).
	extra map[string]any
	// cacheParts sends system blocks as content parts with cache_control markers, which
	// OpenRouter forwards to models that support prompt caching.
	cacheParts bool
}

// NewOpenAI returns an OpenAI-compatible provider for baseURL (e.g. https://api.openai.com/v1).
func NewOpenAI(baseURL, apiKey string) *OpenAI {
	o := &OpenAI{name: "openai", baseURL: strings.TrimRight(baseURL, "/"), apiKey: apiKey, http: newHTTPClient()}
	o.jsonMode.Store(2)
	return o
}

// NewOpenRouter returns the OpenRouter provider. base is the API root
// (https://openrouter.ai/api). Requests are routed only to providers that do not
// retain or train on prompts, and each response reports its cost.
func NewOpenRouter(base, apiKey, appURL string) *OpenAI {
	o := NewOpenAI(strings.TrimRight(base, "/")+"/v1", apiKey)
	o.name = "openrouter"
	o.headers = map[string]string{"HTTP-Referer": appURL, "X-Title": "opendesk"}
	o.extra = map[string]any{"provider": map[string]any{"data_collection": "deny"}}
	o.cacheParts = true
	return o
}

func (o *OpenAI) Name() string { return o.name }

// withClient replaces the HTTP client (a guarded one for user-chosen endpoints).
func (o *OpenAI) withClient(c *http.Client) *OpenAI {
	o.http = c
	return o
}

type oaMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type oaPart struct {
	Type         string         `json:"type"`
	Text         string         `json:"text"`
	CacheControl map[string]any `json:"cache_control,omitempty"`
}

// systemContent is the system message content: one string, or with cacheParts, text
// parts whose cached prefixes end in a cache_control marker.
func (o *OpenAI) systemContent(blocks []Block) any {
	if !o.cacheParts {
		var parts []string
		for _, b := range blocks {
			parts = append(parts, b.Text)
		}
		return strings.Join(parts, "\n\n")
	}
	parts := make([]oaPart, 0, len(blocks))
	for _, b := range blocks {
		p := oaPart{Type: "text", Text: b.Text}
		if b.Cache {
			p.CacheControl = map[string]any{"type": "ephemeral"}
		}
		parts = append(parts, p)
	}
	return parts
}

// withExtra merges the provider's extra body keys into body.
func (o *OpenAI) withExtra(body map[string]any) map[string]any {
	for k, v := range o.extra {
		if _, set := body[k]; !set {
			body[k] = v
		}
	}
	return body
}

func (o *OpenAI) body(req Request, stream bool, mode int32) map[string]any {
	var msgs []oaMessage
	if len(req.System) > 0 {
		msgs = append(msgs, oaMessage{Role: "system", Content: o.systemContent(req.System)})
	}
	for _, m := range req.Messages {
		var parts []string
		for _, b := range m.Blocks {
			parts = append(parts, b.Text)
		}
		role := "user"
		if m.Role == "assistant" {
			role = "assistant"
		}
		msgs = append(msgs, oaMessage{Role: role, Content: strings.Join(parts, "\n\n")})
	}
	body := map[string]any{"model": req.Model, "messages": msgs}
	if o.name == "openai" && strings.HasPrefix(req.Model, "gpt-6") {
		body["max_completion_tokens"] = max(req.MaxTokens, 256)
	} else {
		body["max_tokens"] = max(req.MaxTokens, 256)
	}
	if stream {
		body["stream"] = true
		body["stream_options"] = map[string]any{"include_usage": true}
	}
	if req.JSONSchema != nil {
		name := req.SchemaName
		if name == "" {
			name = "result"
		}
		switch mode {
		case 2:
			body["response_format"] = map[string]any{"type": "json_schema",
				"json_schema": map[string]any{"name": name, "schema": req.JSONSchema, "strict": true}}
		case 1:
			body["response_format"] = map[string]any{"type": "json_object"}
		}
	}
	return o.withExtra(body)
}

// do posts with retries on 429 and 5xx. A 400 on a JSON request steps the JSON mode
// down (some servers support only json_object, or no response_format) and retries.
func (o *OpenAI) do(ctx context.Context, req Request, stream bool) (*http.Response, error) {
	return o.send(ctx, func(mode int32) map[string]any { return o.body(req, stream, mode) }, req.JSONSchema != nil, stream)
}

// send posts the body build returns for the current JSON mode, with retries.
func (o *OpenAI) send(ctx context.Context, build func(mode int32) map[string]any, jsonReq, stream bool) (*http.Response, error) {
	attempt := 0
	for {
		attempt++
		mode := o.jsonMode.Load()
		raw, _ := json.Marshal(build(mode))
		hr, err := http.NewRequestWithContext(ctx, http.MethodPost, o.baseURL+"/chat/completions", bytes.NewReader(raw))
		if err != nil {
			return nil, ErrUnavailable
		}
		hr.Header.Set("Content-Type", "application/json")
		if stream {
			hr.Header.Set("Accept", "text/event-stream")
		}
		if o.apiKey != "" {
			hr.Header.Set("Authorization", "Bearer "+o.apiKey)
			if o.name == "openai" {
				hr.Header.Set("api-key", o.apiKey) // Azure OpenAI
			}
		}
		for k, v := range o.headers {
			if v != "" {
				hr.Header.Set(k, v)
			}
		}
		res, err := o.http.Do(hr)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ErrUnavailable
			}
			if attempt < maxAttempts {
				if sleepCtx(ctx, backoff(attempt, nil)) != nil {
					return nil, ErrUnavailable
				}
				continue
			}
			return nil, ErrUnavailable
		}
		if res.StatusCode == http.StatusOK {
			return res, nil
		}
		// The body is read only to spot an exhausted quota; it is never logged or returned.
		errBody, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		res.Body.Close()
		if res.StatusCode == http.StatusTooManyRequests && bytes.Contains(errBody, []byte("insufficient_quota")) {
			return nil, errors.Join(ErrUnavailable, ErrNoFunds)
		}
		if res.StatusCode == http.StatusBadRequest && jsonReq && mode > 0 {
			o.jsonMode.CompareAndSwap(mode, mode-1)
			continue
		}
		if retryable(res.StatusCode) && attempt < maxAttempts {
			if sleepCtx(ctx, backoff(attempt, res.Header)) != nil {
				return nil, ErrUnavailable
			}
			continue
		}
		return nil, statusError(res.StatusCode)
	}
}

type oaChoice struct {
	Message struct {
		Content string `json:"content"`
		Refusal string `json:"refusal"`
	} `json:"message"`
	Delta struct {
		Content string `json:"content"`
	} `json:"delta"`
	FinishReason string `json:"finish_reason"`
}

type oaResponse struct {
	Model   string     `json:"model"`
	Choices []oaChoice `json:"choices"`
	Usage   *oaUsage   `json:"usage"`
}

// oaUsage is a response's usage. Cost (USD) is reported by OpenRouter only.
type oaUsage struct {
	PromptTokens     int     `json:"prompt_tokens"`
	CompletionTokens int     `json:"completion_tokens"`
	Cost             float64 `json:"cost"`
}

func (o *OpenAI) Complete(ctx context.Context, req Request) (Response, error) {
	ctx, cancel := context.WithTimeout(ctx, completeTimeout*maxAttempts)
	defer cancel()
	res, err := o.do(ctx, req, false)
	if err != nil {
		return Response{}, err
	}
	defer res.Body.Close()
	var r oaResponse
	if err := json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&r); err != nil || len(r.Choices) == 0 {
		return Response{}, ErrUnavailable
	}
	c := r.Choices[0]
	if c.Message.Refusal != "" || c.FinishReason == "content_filter" {
		return Response{}, ErrRefused
	}
	out := Response{Text: c.Message.Content, Model: firstNonEmpty(r.Model, req.Model), StopReason: c.FinishReason}
	if r.Usage != nil {
		out.InputTokens, out.OutputTokens, out.CostUSD = r.Usage.PromptTokens, r.Usage.CompletionTokens, r.Usage.Cost
	}
	return out, nil
}

func (o *OpenAI) Stream(ctx context.Context, req Request, onDelta func(string)) (Response, error) {
	ctx, cancel := context.WithTimeout(ctx, streamTimeout)
	defer cancel()
	res, err := o.do(ctx, req, true)
	if err != nil {
		return Response{}, err
	}
	defer res.Body.Close()
	out := Response{Model: req.Model}
	var text strings.Builder
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var chunk oaResponse
		if json.Unmarshal([]byte(data), &chunk) != nil {
			continue
		}
		if chunk.Model != "" {
			out.Model = chunk.Model
		}
		if chunk.Usage != nil {
			out.InputTokens, out.OutputTokens, out.CostUSD = chunk.Usage.PromptTokens, chunk.Usage.CompletionTokens, chunk.Usage.Cost
		}
		for _, c := range chunk.Choices {
			if c.Delta.Content != "" {
				text.WriteString(c.Delta.Content)
				onDelta(c.Delta.Content)
			}
			if c.FinishReason != "" {
				out.StopReason = c.FinishReason
			}
		}
	}
	if err := sc.Err(); err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return Response{}, context.Canceled
		}
		return Response{}, ErrUnavailable
	}
	if out.StopReason == "content_filter" {
		return Response{}, ErrRefused
	}
	out.Text = text.String()
	return out, nil
}

func firstNonEmpty(s ...string) string {
	for _, v := range s {
		if v != "" {
			return v
		}
	}
	return ""
}
