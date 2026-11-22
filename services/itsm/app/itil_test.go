package app

import (
	"encoding/json"
	"testing"
)

// A change names a requester and a second requester; the two must be different people.
func TestSameRequester(t *testing.T) {
	a := "3562fae7-f4ea-4db9-8fb4-38ed32c56219"
	upper := "3562FAE7-F4EA-4DB9-8FB4-38ED32C56219"
	b := "7efc0a7d-001a-41cd-b57c-fad2a59cc802"
	empty := ""
	cases := []struct {
		name          string
		requester, co *string
		want          bool
	}{
		{"same person", &a, &a, true},
		{"same person, other case", &a, &upper, true},
		{"two people", &a, &b, false},
		{"no second requester", &a, nil, false},
		{"no requester", nil, &b, false},
		{"empty requester", &empty, &empty, false},
	}
	for _, tc := range cases {
		if got := sameRequester(tc.requester, tc.co); got != tc.want {
			t.Errorf("%s: sameRequester = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// Setting or changing either requester is written to the change's activity log.
func TestChangeActivityTracksBothRequesters(t *testing.T) {
	thirupathi := "3562fae7-f4ea-4db9-8fb4-38ed32c56219"
	chandu := "7efc0a7d-001a-41cd-b57c-fad2a59cc802"
	before := Change{RequesterID: &chandu}
	after := Change{RequesterID: &thirupathi, CoRequesterID: &chandu}
	got := map[string]FieldChange{}
	for _, fc := range diffFields(before, after, changeTrackedFields...) {
		got[fc.Field] = fc
	}
	if fc, ok := got["requester_id"]; !ok || fc.From != chandu || fc.To != thirupathi {
		t.Errorf("requester_id change not tracked: %+v", got)
	}
	if fc, ok := got["co_requester_id"]; !ok || fc.From != nil || fc.To != chandu {
		t.Errorf("co_requester_id change not tracked: %+v", got)
	}
	if len(diffFields(after, after, changeTrackedFields...)) != 0 {
		t.Error("an unchanged change produced activity")
	}
}

// The API returns the second requester as co_requester_id and co_requester.
func TestChangeDTOCarriesSecondRequester(t *testing.T) {
	chandu := "7efc0a7d-001a-41cd-b57c-fad2a59cc802"
	dto := ChangeDTO{Change: &Change{CoRequesterID: &chandu}, CoRequester: &UserBrief{ID: chandu, Name: "Chandu Chitikam"}}
	raw, err := json.Marshal(dto)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if out["co_requester_id"] != chandu {
		t.Errorf("co_requester_id = %v", out["co_requester_id"])
	}
	co, ok := out["co_requester"].(map[string]interface{})
	if !ok || co["name"] != "Chandu Chitikam" {
		t.Errorf("co_requester = %v", out["co_requester"])
	}
}
