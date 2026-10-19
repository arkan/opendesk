package mcpserver

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/useopendesk/opendesk/internal/ai"
	"github.com/useopendesk/opendesk/internal/auth"
)

const maxUploadBytes = 25 << 20
const maxUploadBase64 = 34952536

type ticketPreparation struct {
	Namespace string `json:"namespace"`
	Reference string `json:"reference"`
}

func draftTools() []*tool {
	identity := func() map[string]any {
		return map[string]any{
			"ticket": str(ticketArg), "draft_id": str("The shared draft id."),
			"expected_revision": map[string]any{"type": "integer", "minimum": 1, "description": "The saved revision being reviewed or changed."},
		}
	}
	fields := func(props map[string]any) map[string]any {
		props["body"] = strN("Draft body in markdown. Empty is allowed while composing.", 0, maxBodyChars)
		props["mailbox_id"] = map[string]any{"type": []string{"string", "null"}, "description": "Sending mailbox id, or null to inherit from the ticket."}
		props["cc"] = arr("Email addresses to copy.", str(""), 20)
		props["bcc"] = arr("Email addresses to blind copy.", str(""), 20)
		props["attachment_ids"] = arr("Uploaded file ids, in display order.", str(""), 20)
		return props
	}
	create := fields(map[string]any{"ticket": str(ticketArg), "request_id": strN("Durable creation key. Reuse only with the same original input.", 1, 255)})
	return []*tool{
		{Name: "get_ticket_draft", Title: "Get the shared draft", Description: "Read the ticket's shared unsent email draft, or null when none exists.", Scopes: []string{auth.ScopeTicketsRead}, ReadOnly: true, Idempotent: true, Schema: obj(map[string]any{"ticket": str(ticketArg)}, "ticket"), Run: getTicketDraft},
		{Name: "create_ticket_draft", Title: "Create a shared draft", Description: "Prepare an unsent email on an existing ticket. One shared draft per ticket. Never sends email.", Scopes: []string{auth.ScopeTicketsWrite}, Idempotent: true, Schema: obj(create, "ticket", "request_id"), Run: createTicketDraft},
		{Name: "update_ticket_draft", Title: "Update the shared draft", Description: "Update only supplied fields of the shared draft at its saved revision. A conflict preserves other teammates' edits. Never sends email.", Scopes: []string{auth.ScopeTicketsWrite}, Schema: obj(fields(identity()), "ticket", "draft_id", "expected_revision"), Run: updateTicketDraft},
		{Name: "discard_ticket_draft", Title: "Discard the shared draft", Description: "Permanently discard the shared draft at its saved revision, including its file reservations.", Scopes: []string{auth.ScopeTicketsWrite}, Destructive: true, Idempotent: true, Schema: obj(identity(), "ticket", "draft_id", "expected_revision"), Run: discardTicketDraft},
		{Name: "preview_ticket_draft", Title: "Preview the shared draft", Description: "Review current recipients, sender, rendered content and attachments of a saved draft. Never sends email.", Scopes: []string{auth.ScopeTicketsRead}, ReadOnly: true, Idempotent: true, Schema: obj(identity(), "ticket", "draft_id", "expected_revision"), Run: previewTicketDraft},
		{Name: "upload_attachment", Title: "Upload an attachment", Description: "Upload one file for a ticket draft or message. Supply standard base64 bytes and a filename, up to 25 MiB decoded. Returns an attachment id. Never sends email.", Scopes: []string{auth.ScopeTicketsWrite}, Schema: obj(map[string]any{"filename": strN("Filename including its extension.", 1, 200), "content_base64": strN("Standard base64, without a data URL prefix.", 1, maxUploadBase64)}, "filename", "content_base64"), Run: uploadAttachment},
	}
}

func draftRequest(ctx context.Context, c *caller, raw json.RawMessage, method, suffix string) (any, error) {
	// Preserve omitted fields and explicit null mailbox selection when forwarding PATCH.
	args, err := decode[map[string]json.RawMessage](raw)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{"ticket": true}
	switch method + suffix {
	case http.MethodPost:
		for _, k := range []string{"request_id", "body", "mailbox_id", "cc", "bcc", "attachment_ids"} {
			allowed[k] = true
		}
	case http.MethodPatch:
		for _, k := range []string{"draft_id", "expected_revision", "body", "mailbox_id", "cc", "bcc", "attachment_ids"} {
			allowed[k] = true
		}
	case http.MethodDelete, http.MethodPost + "/preview":
		allowed["draft_id"], allowed["expected_revision"] = true, true
	}
	for k := range args {
		if !allowed[k] {
			return nil, invalid("unknown argument: " + k)
		}
	}
	var ticket string
	if err := json.Unmarshal(args["ticket"], &ticket); err != nil {
		return nil, invalid("ticket is required")
	}
	ref, err := ticketRef(ticket)
	if err != nil {
		return nil, err
	}
	delete(args, "ticket")
	if body, ok := args["body"]; ok {
		var text string
		if string(body) == "null" || json.Unmarshal(body, &text) != nil {
			return nil, invalid("body must be a string")
		}
		if utf8.RuneCountInString(text) > maxBodyChars {
			return nil, invalid("body is longer than 20,000 characters")
		}
		html := ""
		if strings.TrimSpace(text) != "" {
			html = ai.MarkdownToHTML(text)
		}
		args["body_html"], _ = json.Marshal(html)
		delete(args, "body")
	}
	var body any = args
	if method == http.MethodGet {
		body = nil
	}
	var out json.RawMessage
	if err := c.do(ctx, method, "/v1/tickets/"+ref+"/draft"+suffix, nil, body, &out); err != nil {
		return nil, err
	}
	if method == http.MethodDelete {
		return map[string]any{"discarded": true}, nil
	}
	return out, nil
}

func getTicketDraft(ctx context.Context, c *caller, raw json.RawMessage) (any, error) {
	return draftRequest(ctx, c, raw, http.MethodGet, "")
}
func createTicketDraft(ctx context.Context, c *caller, raw json.RawMessage) (any, error) {
	return draftRequest(ctx, c, raw, http.MethodPost, "")
}
func updateTicketDraft(ctx context.Context, c *caller, raw json.RawMessage) (any, error) {
	return draftRequest(ctx, c, raw, http.MethodPatch, "")
}
func discardTicketDraft(ctx context.Context, c *caller, raw json.RawMessage) (any, error) {
	return draftRequest(ctx, c, raw, http.MethodDelete, "")
}
func previewTicketDraft(ctx context.Context, c *caller, raw json.RawMessage) (any, error) {
	return draftRequest(ctx, c, raw, http.MethodPost, "/preview")
}

func uploadAttachment(ctx context.Context, c *caller, raw json.RawMessage) (any, error) {
	// Check current permissions before the legacy upload route can replay its cached result.
	if _, err := auth.RequireWorkspace(auth.WithPrincipal(ctx, c.p), auth.RoleAgent, auth.ScopeTicketsWrite); err != nil {
		return nil, &apiError{Status: http.StatusForbidden, Code: "forbidden", Detail: "You are not allowed to upload attachments."}
	}
	args, err := decode[struct {
		Filename string `json:"filename"`
		Content  string `json:"content_base64"`
	}](raw)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(args.Filename) == "" || utf8.RuneCountInString(args.Filename) > 200 {
		return nil, invalid("filename must be 1 to 200 characters")
	}
	if len(args.Content) > maxUploadBase64 {
		return nil, invalid("file must be at most 25 MiB")
	}
	// DecodeString accepts CR/LF; reject them to require the standard, unbroken encoding.
	if strings.ContainsAny(args.Content, "\r\n") {
		return nil, invalid("content_base64 must be standard base64")
	}
	data, err := base64.StdEncoding.Strict().DecodeString(args.Content)
	if err != nil {
		return nil, invalid("content_base64 must be standard base64")
	}
	if len(data) == 0 || len(data) > maxUploadBytes {
		return nil, invalid("file must contain 1 byte to 25 MiB")
	}
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	uploadHash := sha256.Sum256(data)
	// A deterministic boundary gives an upload retry the same inner idempotency fingerprint.
	if err := writer.SetBoundary("opendesk-" + hex.EncodeToString(uploadHash[:24])); err != nil {
		return nil, err
	}
	part, err := writer.CreateFormFile("file", args.Filename)
	if err != nil {
		return nil, err
	}
	if _, err = part.Write(data); err != nil {
		return nil, err
	}
	if err = writer.Close(); err != nil {
		return nil, err
	}
	var out json.RawMessage
	if err = c.doRaw(ctx, http.MethodPost, "/v1/attachments", nil, buf.Bytes(), writer.FormDataContentType(), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func isDraftTool(name string) bool {
	switch name {
	case "get_ticket_draft", "create_ticket_draft", "update_ticket_draft", "discard_ticket_draft", "preview_ticket_draft":
		return true
	}
	return false
}
