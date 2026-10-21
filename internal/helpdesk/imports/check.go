package imports

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/useopendesk/opendesk/internal/helpdesk/hd"
	"github.com/useopendesk/opendesk/internal/helpdesk/imports/source"
	"github.com/useopendesk/opendesk/internal/httpx"
)

// ImportCheck is what checking a source found (contracts/imports.md ImportCheck).
type ImportCheck struct {
	Account     ImportAccount      `json:"account"`
	Totals      ImportTotals       `json:"totals"`
	Agents      []ImportCheckAgent `json:"agents"`
	Groups      []ImportCheckGroup `json:"groups"`
	Samples     []ImportSample     `json:"samples"`
	HasArticles bool               `json:"has_articles"`
}

// ImportCheckAgent is a source agent and the member with their email, if any.
type ImportCheckAgent struct {
	ID     string     `json:"id"`
	Name   string     `json:"name"`
	Email  string     `json:"email"`
	UserID *uuid.UUID `json:"user_id"`
}

// ImportCheckGroup is a source group and the team with its name, if any.
type ImportCheckGroup struct {
	ID     string     `json:"id"`
	Name   string     `json:"name"`
	TeamID *uuid.UUID `json:"team_id"`
}

// ImportSample is a source ticket as it will look here, shortened.
type ImportSample struct {
	Ref          string                `json:"ref"`
	Subject      string                `json:"subject"`
	Status       string                `json:"status" enum:"open,pending,on_hold,solved,closed"`
	CreatedAt    time.Time             `json:"created_at"`
	Requester    *ImportSamplePerson   `json:"requester"`
	Messages     []ImportSampleMessage `json:"messages"`
	MessageCount int                   `json:"message_count"`
	Tags         []string              `json:"tags"`
}

type ImportSamplePerson struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type ImportSampleMessage struct {
	Author      string    `json:"author"`
	Agent       bool      `json:"agent"`
	Note        bool      `json:"note"`
	Text        string    `json:"text"`
	CreatedAt   time.Time `json:"created_at"`
	Attachments int       `json:"attachments"`
}

// Samples shown, messages per sample, and how long loading them may take.
const (
	maxSamples        = 3
	maxSampleMessages = 6
	sampleBudget      = 15 * time.Second
)

// sourceError answers a source's refusal in words the user can act on.
func sourceError(src string, err error) error {
	name := sourceName(src)
	var inv *source.InvalidError
	var rl *source.RateLimited
	var un *source.Unreachable
	var re *source.RemoteError
	switch {
	case errors.As(err, &inv):
		e := httpx.Validation(inv.Detail)
		e.Errors = []*huma.ErrorDetail{{Location: "body.credentials." + inv.Field, Message: inv.Detail}}
		return e
	case errors.Is(err, source.ErrAuth):
		detail := name + " refused these credentials. Check them and try again."
		// A source may say what kind of sign-in it needs ("sign in as a Zendesk admin").
		if _, why, ok := strings.Cut(err.Error(), source.ErrAuth.Error()+": "); ok && why != "" {
			detail = name + " refused these credentials: " + why + "."
		}
		return httpx.E(http.StatusUnprocessableEntity, "import_auth_failed", detail)
	case errors.Is(err, source.ErrNotFound):
		return httpx.E(http.StatusUnprocessableEntity, "import_not_found", "No "+name+" account answers at that address. Check it and try again.")
	case errors.As(err, &rl):
		wait := "a second"
		if secs := int(rl.RetryAfter.Round(time.Second) / time.Second); secs > 1 {
			wait = fmt.Sprintf("%d seconds", secs)
		}
		return httpx.E(http.StatusTooManyRequests, "import_rate_limited", name+" asked us to slow down. Try again in "+wait+".")
	case errors.As(err, &un), errors.As(err, &re):
		return httpx.E(http.StatusBadGateway, "import_unreachable", name+" did not answer as expected. Try again in a moment.")
	}
	return httpx.Wrap(err)
}

// check reads what a source has and how it maps onto the workspace.
func (s *Service) check(ctx context.Context, wid uuid.UUID, srcKey string, src source.Source) (ImportCheck, source.Scan, error) {
	scan, err := src.Check(ctx)
	if err != nil {
		return ImportCheck{}, scan, sourceError(srcKey, err)
	}
	out := ImportCheck{Account: ImportAccount{Name: scan.Account.Name, URL: scan.Account.URL}, Agents: []ImportCheckAgent{}, Groups: []ImportCheckGroup{},
		Samples: []ImportSample{}, HasArticles: scan.HasArticles}
	if scan.Tickets >= 0 {
		n := scan.Tickets
		out.Totals.Tickets = &n
	}
	if scan.HasArticles && scan.Articles >= 0 {
		n := scan.Articles
		out.Totals.Articles = &n
	}
	members := map[string]uuid.UUID{}
	rows, err := s.d.DB.Pool.Query(ctx, `SELECT lower(u.email), u.id FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1`, wid)
	if err != nil {
		return out, scan, httpx.Wrap(err)
	}
	for rows.Next() {
		var email string
		var id uuid.UUID
		if err := rows.Scan(&email, &id); err != nil {
			rows.Close()
			return out, scan, httpx.Wrap(err)
		}
		members[email] = id
	}
	rows.Close()
	teams := map[string]uuid.UUID{}
	rows, err = s.d.DB.Pool.Query(ctx, `SELECT lower(name), id FROM teams WHERE workspace_id = $1`, wid)
	if err != nil {
		return out, scan, httpx.Wrap(err)
	}
	for rows.Next() {
		var name string
		var id uuid.UUID
		if err := rows.Scan(&name, &id); err != nil {
			rows.Close()
			return out, scan, httpx.Wrap(err)
		}
		teams[name] = id
	}
	rows.Close()
	for _, a := range scan.Agents {
		ca := ImportCheckAgent{ID: a.ID, Name: a.Name, Email: strings.ToLower(a.Email)}
		if id, ok := members[ca.Email]; ok && ca.Email != "" {
			ca.UserID = &id
		}
		out.Agents = append(out.Agents, ca)
	}
	for _, g := range scan.Groups {
		cg := ImportCheckGroup{ID: g.ID, Name: g.Name}
		if id, ok := teams[strings.ToLower(strings.TrimSpace(g.Name))]; ok {
			cg.TeamID = &id
		}
		out.Groups = append(out.Groups, cg)
	}
	out.Samples = samples(ctx, src)
	return out, scan, nil
}

// samples loads the first few tickets as they will look. Any trouble leaves them out:
// the check itself passed.
func samples(ctx context.Context, src source.Source) []ImportSample {
	ctx, cancel := context.WithTimeout(ctx, sampleBudget)
	defer cancel()
	out := []ImportSample{}
	cursor := ""
	for range 3 {
		page, err := src.Tickets(ctx, cursor, nil, nil)
		if err != nil {
			return out
		}
		for i := range page.Items {
			t := &page.Items[i]
			if t.Skip {
				continue
			}
			if !t.Loaded {
				if err := src.Load(ctx, t); err != nil {
					return out
				}
				if t.Skip {
					continue
				}
			}
			out = append(out, sampleOf(t))
			if len(out) >= maxSamples {
				return out
			}
		}
		if page.Next == "" {
			return out
		}
		cursor = page.Next
	}
	return out
}

func sampleOf(t *source.Ticket) ImportSample {
	sm := ImportSample{Ref: t.Ref, Subject: t.Subject, Status: t.Status, CreatedAt: t.CreatedAt, Messages: []ImportSampleMessage{},
		MessageCount: len(t.Messages), Tags: t.Tags}
	if sm.Tags == nil {
		sm.Tags = []string{}
	}
	if sm.Status == "" {
		sm.Status = "open"
	}
	if t.Requester != nil {
		sm.Requester = &ImportSamplePerson{Name: t.Requester.Name, Email: strings.ToLower(t.Requester.Email)}
	}
	for _, m := range t.Messages {
		if len(sm.Messages) >= maxSampleMessages {
			break
		}
		text := strings.TrimSpace(m.Text)
		if strings.TrimSpace(m.HTML) != "" {
			text = hd.HTMLToText(hd.SanitizeEmailHTML(m.HTML))
		}
		author := strings.TrimSpace(m.Author.Name)
		if author == "" {
			author = m.Author.Email
		}
		sm.Messages = append(sm.Messages, ImportSampleMessage{Author: author, Agent: m.Agent, Note: m.Note, Text: hd.Excerpt(text, 400),
			CreatedAt: m.CreatedAt, Attachments: len(m.Attachments)})
	}
	if sm.Subject == "" && len(sm.Messages) > 0 {
		sm.Subject = firstWords(sm.Messages[0].Text, 80)
	}
	return sm
}
