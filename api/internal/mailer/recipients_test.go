package mailer

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGraphMessageAddsCcRecipients(t *testing.T) {
	payload := graphMessage(Message{To: "jane@example.com", Cc: []string{"dave@shop.test", " ", "amy@shop.test"}, Subject: "Hi", Body: "Hello"})
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		To []struct {
			EmailAddress struct{ Address string } `json:"emailAddress"`
		} `json:"toRecipients"`
		Cc []struct {
			EmailAddress struct{ Address string } `json:"emailAddress"`
		} `json:"ccRecipients"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if len(out.To) != 1 || out.To[0].EmailAddress.Address != "jane@example.com" {
		t.Fatalf("toRecipients = %+v", out.To)
	}
	if len(out.Cc) != 2 || out.Cc[0].EmailAddress.Address != "dave@shop.test" || out.Cc[1].EmailAddress.Address != "amy@shop.test" {
		t.Fatalf("ccRecipients = %+v", out.Cc)
	}
}

func TestGraphMessageOmitsEmptyCc(t *testing.T) {
	raw, err := json.Marshal(graphMessage(Message{To: "jane@example.com", Subject: "Hi", Body: "Hello"}))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "ccRecipients") {
		t.Fatalf("ccRecipients must be omitted when empty: %s", raw)
	}
	if strings.Contains(string(raw), "bccRecipients") {
		t.Fatalf("no bcc in MVP: %s", raw)
	}
}
