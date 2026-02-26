package domain

type Permission struct {
	ID       string `json:"id"`
	Code     string `json:"code"`
	Resource string `json:"resource"`
	Action   string `json:"action"`
}
