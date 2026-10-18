package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

type openAITestTransport func(*http.Request) (*http.Response, error)

func (f openAITestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestOpenAICompletionTokens(t *testing.T) {
	for _, model := range []string{"gpt-6.1-sol", "gpt-6-luna", "gpt-6.1-sol-2026-09-29", "gpt-4.1", "llama3.1:8b"} {
		for _, stream := range []bool{false, true} {
			for _, format := range []string{"plain", "json_schema", "fallback"} {
				t.Run(fmt.Sprintf("%s/stream=%v/%s", model, stream, format), func(t *testing.T) {
					p := NewOpenAI("https://provider.invalid/v1", "")
					calls := 0
					p.withClient(&http.Client{Transport: openAITestTransport(func(r *http.Request) (*http.Response, error) {
						calls++
						var body map[string]any
						if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
							t.Fatal(err)
						}
						response := func(status int, text string) (*http.Response, error) {
							return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(text))}, nil
						}
						wanted, unwanted := "max_tokens", "max_completion_tokens"
						if strings.HasPrefix(model, "gpt-6") {
							wanted, unwanted = unwanted, wanted
							if _, found := body["max_tokens"]; found {
								return response(400, `{"error":{"code":"unsupported_parameter","param":"max_tokens","message":"Use max_completion_tokens instead."}}`)
							}
						}
						if _, found := body[unwanted]; found || body[wanted] != float64(3000) {
							t.Errorf("expected %s=3000 without %s", wanted, unwanted)
						}
						if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" || body["model"] != model {
							t.Error("endpoint or model changed")
						}
						if stream && (body["stream"] != true || body["stream_options"].(map[string]any)["include_usage"] != true) {
							t.Error("stream options missing")
						}
						if format == "plain" || (format == "fallback" && calls == 3) {
							if body["response_format"] != nil {
								t.Error("unexpected response format")
							}
						} else {
							want := "json_schema"
							if calls == 2 {
								want = "json_object"
							}
							if body["response_format"].(map[string]any)["type"] != want {
								t.Error("response format changed")
							}
							if format == "fallback" {
								return response(400, `{"error":{"param":"response_format"}}`)
							}
						}
						if stream {
							return response(200, "data: {\"choices\":[{\"delta\":{\"content\":\"{}\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
						}
						return response(200, `{"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}]}`)
					})})
					req := Request{Model: model, MaxTokens: 3000, Messages: []Message{UserText("test")}}
					if format != "plain" {
						req.JSONSchema = map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}
					}
					var out Response
					var err error
					var deltas strings.Builder
					if stream {
						out, err = p.Stream(context.Background(), req, func(s string) { deltas.WriteString(s) })
					} else {
						out, err = p.Complete(context.Background(), req)
					}
					if err != nil || out.Text != "{}" || out.Model != model || (stream && deltas.String() != "{}") {
						t.Fatalf("completion failed: %v", err)
					}
					wantCalls := 1
					if format == "fallback" {
						wantCalls = 3
					}
					if calls != wantCalls {
						t.Fatalf("got %d requests, want %d", calls, wantCalls)
					}
				})
			}
		}
	}
}

func TestOpenAITokenLimitCompatibility(t *testing.T) {
	for _, model := range []string{"gpt-6.1-sol", "gpt-6-luna", "gpt-4.1", "llama3.1:8b"} {
		for _, limit := range []int{-1, 0, 128, 3000} {
			for _, p := range []*OpenAI{NewOpenAI("https://provider.invalid/v1", ""), NewOpenRouter("https://provider.invalid/api", "", "")} {
				wanted, unwanted := "max_tokens", "max_completion_tokens"
				if p.Name() == "openai" && strings.HasPrefix(model, "gpt-6") {
					wanted, unwanted = unwanted, wanted
				}
				body := p.body(Request{Model: model, MaxTokens: limit}, false, 0)
				if _, found := body[unwanted]; found || body[wanted] != max(limit, 256) {
					t.Fatalf("%s/%s: incorrect token limit", p.Name(), model)
				}
			}
		}
	}
}
