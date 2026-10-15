package rules

import "testing"

func TestEvaluateAllAndAny(t *testing.T) {
	fields := map[string]interface{}{"priority": 4, "subject": "VPN is down", "source": "email", "tags": []interface{}{"network", "vpn"}}
	all := ConditionSet{Match: "all", Rules: []Condition{
		{Field: "priority", Operator: "is", Value: "4"},
		{Field: "subject", Operator: "contains", Value: "vpn"},
	}}
	if !Evaluate(all, fields, nil) {
		t.Fatal("expected all-match")
	}
	all.Rules = append(all.Rules, Condition{Field: "source", Operator: "is", Value: "portal"})
	if Evaluate(all, fields, nil) {
		t.Fatal("expected all-match to fail")
	}
	any := ConditionSet{Match: "any", Rules: all.Rules}
	if !Evaluate(any, fields, nil) {
		t.Fatal("expected any-match")
	}
}

func TestOperators(t *testing.T) {
	f := map[string]interface{}{"status": "open", "priority": 3, "group_id": nil, "tags": []interface{}{"vpn"}, "subject": "Printer jam"}
	cases := []struct {
		c    Condition
		want bool
	}{
		{Condition{"status", "is_not", "closed"}, true},
		{Condition{"status", "in", []interface{}{"open", "pending"}}, true},
		{Condition{"status", "not_in", "open,pending"}, false},
		{Condition{"group_id", "is_empty", nil}, true},
		{Condition{"subject", "is_not_empty", nil}, true},
		{Condition{"priority", "greater_than", 2}, true},
		{Condition{"priority", "less_than", "2"}, false},
		{Condition{"tags", "contains", "VPN"}, true},
		{Condition{"tags", "not_contains", "email"}, true},
		{Condition{"subject", "starts_with", "print"}, true},
		{Condition{"subject", "ends_with", "JAM"}, true},
	}
	for _, tc := range cases {
		if got := Evaluate(ConditionSet{Rules: []Condition{tc.c}}, f, nil); got != tc.want {
			t.Errorf("%+v: got %v want %v", tc.c, got, tc.want)
		}
	}
}

func TestChangeOperators(t *testing.T) {
	f := map[string]interface{}{"status": "resolved"}
	ch := map[string]Change{"status": {From: "open", To: "resolved"}}
	if !Evaluate(ConditionSet{Rules: []Condition{{"status", "changed_to", "resolved"}}}, f, ch) {
		t.Fatal("changed_to")
	}
	if !Evaluate(ConditionSet{Rules: []Condition{{"status", "changed_from", "open"}}}, f, ch) {
		t.Fatal("changed_from")
	}
	if Evaluate(ConditionSet{Rules: []Condition{{"priority", "changed", nil}}}, f, ch) {
		t.Fatal("unchanged field must not match")
	}
}

func TestValidate(t *testing.T) {
	if err := (ConditionSet{Match: "some"}).Validate(); err == nil {
		t.Fatal("bad match")
	}
	if err := (ConditionSet{Rules: []Condition{{Field: "x", Operator: "regex"}}}).Validate(); err == nil {
		t.Fatal("bad operator")
	}
	if err := (ConditionSet{Rules: []Condition{{Field: "x", Operator: "is"}}}).Validate(); err != nil {
		t.Fatal(err)
	}
}
