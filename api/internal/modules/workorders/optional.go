package workorders

import (
	"bytes"
	"encoding/json"
)

// OptionalFloat distinguishes an omitted JSON field (Set=false) from an explicit
// null (Set=true, Value=nil) and a number.
type OptionalFloat struct {
	Set   bool
	Value *float64
}

func (o *OptionalFloat) UnmarshalJSON(b []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		o.Value = nil
		return nil
	}
	var v float64
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	o.Value = &v
	return nil
}
