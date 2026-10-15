// Package rules evaluates automation conditions against a record's fields.
package rules

import (
	"fmt"
	"strconv"
	"strings"
)

// Condition compares one field with a value using an operator.
type Condition struct {
	Field    string      `json:"field"`
	Operator string      `json:"operator"`
	Value    interface{} `json:"value"`
}

// ConditionSet groups conditions with "all" (AND) or "any" (OR) semantics.
// An empty set always matches.
type ConditionSet struct {
	Match string      `json:"match"`
	Rules []Condition `json:"rules"`
}

// Change records a field's value before and after an update.
type Change struct {
	From interface{}
	To   interface{}
}

// Operators supported by Evaluate, exposed for validation and UI building.
var Operators = []string{
	"is", "is_not", "in", "not_in", "contains", "not_contains", "starts_with", "ends_with",
	"is_empty", "is_not_empty", "greater_than", "less_than", "changed", "changed_to", "changed_from",
}

// Validate reports the first invalid condition in the set.
func (s ConditionSet) Validate() error {
	if s.Match != "" && s.Match != "all" && s.Match != "any" {
		return fmt.Errorf("match must be 'all' or 'any'")
	}
	for i, c := range s.Rules {
		if strings.TrimSpace(c.Field) == "" {
			return fmt.Errorf("condition %d: field is required", i+1)
		}
		if !validOperator(c.Operator) {
			return fmt.Errorf("condition %d: unsupported operator %q", i+1, c.Operator)
		}
	}
	return nil
}

func validOperator(op string) bool {
	for _, o := range Operators {
		if o == op {
			return true
		}
	}
	return false
}

// Evaluate checks the set against the current field values. changes holds
// fields modified by the triggering event and may be nil for create events.
func Evaluate(s ConditionSet, fields map[string]interface{}, changes map[string]Change) bool {
	if len(s.Rules) == 0 {
		return true
	}
	any := s.Match == "any"
	for _, c := range s.Rules {
		ok := evalOne(c, fields, changes)
		if any && ok {
			return true
		}
		if !any && !ok {
			return false
		}
	}
	return !any
}

func evalOne(c Condition, fields map[string]interface{}, changes map[string]Change) bool {
	actual := fields[c.Field]
	switch c.Operator {
	case "is":
		return equal(actual, c.Value)
	case "is_not":
		return !equal(actual, c.Value)
	case "in":
		return inList(actual, c.Value)
	case "not_in":
		return !inList(actual, c.Value)
	case "contains":
		return contains(actual, c.Value)
	case "not_contains":
		return !contains(actual, c.Value)
	case "starts_with":
		return strings.HasPrefix(lower(actual), lower(c.Value))
	case "ends_with":
		return strings.HasSuffix(lower(actual), lower(c.Value))
	case "is_empty":
		return isEmpty(actual)
	case "is_not_empty":
		return !isEmpty(actual)
	case "greater_than":
		a, ok1 := number(actual)
		b, ok2 := number(c.Value)
		return ok1 && ok2 && a > b
	case "less_than":
		a, ok1 := number(actual)
		b, ok2 := number(c.Value)
		return ok1 && ok2 && a < b
	case "changed":
		_, ok := changes[c.Field]
		return ok
	case "changed_to":
		ch, ok := changes[c.Field]
		return ok && equal(ch.To, c.Value)
	case "changed_from":
		ch, ok := changes[c.Field]
		return ok && equal(ch.From, c.Value)
	}
	return false
}

// Stringify renders a value in the canonical form used for comparisons.
func Stringify(v interface{}) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case *string:
		if t == nil {
			return ""
		}
		return *t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(t), 'f', -1, 32)
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	case bool:
		return strconv.FormatBool(t)
	default:
		return fmt.Sprint(t)
	}
}

func lower(v interface{}) string { return strings.ToLower(Stringify(v)) }

func toList(v interface{}) []interface{} {
	switch t := v.(type) {
	case []interface{}:
		return t
	case []string:
		out := make([]interface{}, len(t))
		for i, s := range t {
			out[i] = s
		}
		return out
	case nil:
		return nil
	case string:
		if strings.Contains(t, ",") {
			parts := strings.Split(t, ",")
			out := make([]interface{}, len(parts))
			for i, p := range parts {
				out[i] = strings.TrimSpace(p)
			}
			return out
		}
		return []interface{}{t}
	default:
		return []interface{}{t}
	}
}

func equal(a, b interface{}) bool {
	if la, ok := a.([]interface{}); ok {
		for _, x := range la {
			if equal(x, b) {
				return true
			}
		}
		return false
	}
	if la, ok := a.([]string); ok {
		for _, x := range la {
			if equal(x, b) {
				return true
			}
		}
		return false
	}
	return strings.EqualFold(Stringify(a), Stringify(b))
}

func inList(actual, list interface{}) bool {
	for _, v := range toList(list) {
		if equal(actual, v) {
			return true
		}
	}
	return false
}

func contains(actual, needle interface{}) bool {
	switch actual.(type) {
	case []interface{}, []string:
		return equal(actual, needle)
	}
	return strings.Contains(lower(actual), lower(needle))
}

func isEmpty(v interface{}) bool {
	switch t := v.(type) {
	case nil:
		return true
	case []interface{}:
		return len(t) == 0
	case []string:
		return len(t) == 0
	case *string:
		return t == nil || strings.TrimSpace(*t) == ""
	}
	return strings.TrimSpace(Stringify(v)) == ""
}

func number(v interface{}) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(Stringify(v)), 64)
	return f, err == nil
}
