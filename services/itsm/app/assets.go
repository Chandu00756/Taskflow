package app

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Asset types
// ---------------------------------------------------------------------------

func (a *App) listAssetTypes(c *Ctx) error {
	var types []AssetType
	c.T(&AssetType{}).Order("name").Find(&types)
	counts := map[string]int64{}
	var rows []struct {
		AssetTypeID string
		N           int64
	}
	c.T(&Asset{}).Select("asset_type_id, count(*) AS n").Where("NOT is_deleted").Group("asset_type_id").Scan(&rows)
	for _, r := range rows {
		counts[r.AssetTypeID] = r.N
	}
	out := []map[string]interface{}{}
	for _, t := range types {
		var fields interface{}
		_ = json.Unmarshal(t.Fields, &fields)
		out = append(out, map[string]interface{}{"id": t.ID, "name": t.Name, "description": t.Description, "parent_id": t.ParentID,
			"fields": fields, "icon": t.Icon, "visible": t.Visible, "asset_count": counts[t.ID]})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
}

type typeField struct {
	Name    string   `json:"name"`
	Label   string   `json:"label"`
	Type    string   `json:"type"`
	Choices []string `json:"choices,omitempty"`
}

func (a *App) saveAssetType(create bool) handlerFunc {
	return func(c *Ctx) error {
		t := AssetType{Base: Base{OrgID: c.P.OrgID}, Visible: true, Fields: jsonOf([]typeField{})}
		if !create {
			if err := c.T(&AssetType{}).Where("id = ?", c.Param("id")).Take(&t).Error; err != nil {
				return errNotFound("asset type")
			}
		}
		var in struct {
			Name        *string      `json:"name"`
			Description *string      `json:"description"`
			ParentID    *string      `json:"parent_id"`
			Icon        *string      `json:"icon"`
			Visible     *bool        `json:"visible"`
			Fields      *[]typeField `json:"fields"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Name != nil {
			t.Name = strings.TrimSpace(*in.Name)
		}
		if t.Name == "" {
			errs["name"] = "is required"
		}
		setText(&t.Description, in.Description)
		setText(&t.Icon, in.Icon)
		if in.Visible != nil {
			t.Visible = *in.Visible
		}
		if in.ParentID != nil {
			t.ParentID = strPtr(*in.ParentID)
			if t.ParentID != nil && (*t.ParentID == t.ID || !c.existsInOrg(&AssetType{}, *t.ParentID)) {
				errs["parent_id"] = "is invalid"
			}
		}
		if in.Fields != nil {
			seen := map[string]bool{}
			for i, f := range *in.Fields {
				f.Name = strings.TrimSpace(strings.ToLower(strings.ReplaceAll(f.Name, " ", "_")))
				if f.Name == "" || seen[f.Name] {
					errs["fields"] = fmt.Sprintf("field %d needs a unique name", i+1)
				}
				if !oneOf(f.Type, "text", "number", "date", "dropdown", "checkbox", "paragraph") {
					errs["fields"] = fmt.Sprintf("field %d has an unsupported type", i+1)
				}
				seen[f.Name] = true
				(*in.Fields)[i] = f
			}
			t.Fields = jsonOf(*in.Fields)
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		var err error
		if create {
			err = c.DB().Create(&t).Error
		} else {
			err = c.DB().Save(&t).Error
		}
		if err != nil {
			return err
		}
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], t)
	}
}

func (a *App) deleteAssetType(c *Ctx) error {
	var t AssetType
	if err := c.T(&AssetType{}).Where("id = ?", c.Param("id")).Take(&t).Error; err != nil {
		return errNotFound("asset type")
	}
	var n int64
	c.T(&Asset{}).Where("asset_type_id = ? AND NOT is_deleted", t.ID).Count(&n)
	if n > 0 {
		return errConflict(fmt.Sprintf("%d asset(s) still use this type", n))
	}
	c.T(&AssetType{}).Where("parent_id = ?", t.ID).Count(&n)
	if n > 0 {
		return errConflict("delete or move the child types first")
	}
	if err := c.DB().Delete(&t).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// typeDescendants returns typeID and all of its descendant type ids.
func (c *Ctx) typeDescendants(typeID string) []string {
	var types []AssetType
	c.T(&AssetType{}).Select("id, parent_id").Find(&types)
	children := map[string][]string{}
	for _, t := range types {
		children[deref(t.ParentID)] = append(children[deref(t.ParentID)], t.ID)
	}
	out := []string{typeID}
	for i := 0; i < len(out); i++ {
		out = append(out, children[out[i]]...)
	}
	return out
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

// AssetDTO enriches an asset.
type AssetDTO struct {
	*Asset
	DisplayID  string      `json:"display_id"`
	AssetType  *Ref        `json:"asset_type"`
	User       *UserBrief  `json:"user"`
	Agent      *UserBrief  `json:"agent"`
	Group      *Ref        `json:"group"`
	Department *Ref        `json:"department"`
	Location   *Ref        `json:"location"`
	Product    *Ref        `json:"product"`
	Vendor     *Ref        `json:"vendor"`
	Tags       []string    `json:"tags"`
	TypeFlds   interface{} `json:"type_fields"`
}

func (c *Ctx) assetDTOs(items []Asset) []AssetDTO {
	var uids, gids, dids, tids, lids, pids, vids []string
	for _, as := range items {
		uids = append(uids, deref(as.UserID), deref(as.AgentID))
		gids = append(gids, deref(as.GroupID))
		dids = append(dids, deref(as.DepartmentID))
		tids = append(tids, as.AssetTypeID)
		lids = append(lids, deref(as.LocationID))
		pids = append(pids, deref(as.ProductID))
		vids = append(vids, deref(as.VendorID))
	}
	l := c.lookup(uids, gids, dids)
	refs := func(model interface{}, ids []string) map[string]*Ref {
		out := map[string]*Ref{}
		ids = uniq(ids)
		if len(ids) == 0 {
			return out
		}
		var rows []Ref
		c.T(model).Select("id, name").Where("id IN ?", ids).Scan(&rows)
		for i := range rows {
			out[rows[i].ID] = &rows[i]
		}
		return out
	}
	types, locs, prods, vends := refs(&AssetType{}, tids), refs(&Location{}, lids), refs(&Product{}, pids), refs(&Vendor{}, vids)
	get := func(m map[string]*Ref, id *string) *Ref {
		if id == nil {
			return nil
		}
		return m[*id]
	}
	out := make([]AssetDTO, len(items))
	for i := range items {
		as := &items[i]
		var tf interface{} = map[string]interface{}{}
		_ = json.Unmarshal(as.TypeFields, &tf)
		out[i] = AssetDTO{Asset: as, DisplayID: "ASSET-" + strconv.FormatInt(as.Number, 10), AssetType: types[as.AssetTypeID],
			User: l.user(as.UserID), Agent: l.user(as.AgentID), Group: l.group(as.GroupID), Department: l.dept(as.DepartmentID),
			Location: get(locs, as.LocationID), Product: get(prods, as.ProductID), Vendor: get(vends, as.VendorID),
			Tags: stringsFrom(as.Tags), TypeFlds: tf}
	}
	return out
}

func (a *App) listAssets(c *Ctx) error {
	pg := c.Paging()
	build := func() *gorm.DB {
		q := c.T(&Asset{})
		if c.Query("view") == "trash" {
			q = q.Where("is_deleted")
		} else {
			q = q.Where("NOT is_deleted")
		}
		if v := c.Query("asset_type_id"); isUUID(v) {
			q = q.Where("asset_type_id IN ?", c.typeDescendants(v))
		}
		if v := c.Query("state"); v != "" {
			q = q.Where("state IN ?", strings.Split(v, ","))
		}
		if v := c.Query("user_id"); isUUID(v) {
			q = q.Where("user_id = ?", v)
		}
		if v := c.Query("department_id"); isUUID(v) {
			q = q.Where("department_id = ?", v)
		}
		if v := c.Query("location_id"); isUUID(v) {
			q = q.Where("location_id = ?", v)
		}
		if v := c.Query("impact"); v != "" {
			q = q.Where("impact = ?", v)
		}
		if c.Query("warranty") == "expiring" {
			q = q.Where("warranty_expiry BETWEEN ? AND ?", now(), now().AddDate(0, 0, 30))
		}
		if v := strings.TrimSpace(c.Query("q")); v != "" {
			n, _ := refNumber(v)
			q = q.Where("(name ILIKE ? OR asset_tag ILIKE ? OR serial_number ILIKE ? OR type_fields::text ILIKE ? OR description ILIKE ? OR number = ?)",
				likeEscape(v), likeEscape(v), likeEscape(v), likeEscape(v), likeEscape(v), n)
		}
		return q
	}
	var total int64
	build().Count(&total)
	var items []Asset
	if err := build().Order(listOrder(c, "name", "created_at", "updated_at", "number", "warranty_expiry", "cost")).Offset(pg.Offset()).Limit(pg.PerPage).Find(&items).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, ListResponse{Items: c.assetDTOs(items), Total: total, Page: pg.Page, PerPage: pg.PerPage})
}

type assetInput struct {
	Name            *string                `json:"name"`
	AssetTag        *string                `json:"asset_tag"`
	AssetTypeID     *string                `json:"asset_type_id"`
	Description     *string                `json:"description"`
	Impact          *string                `json:"impact"`
	UsageType       *string                `json:"usage_type"`
	State           *string                `json:"state"`
	UserID          *string                `json:"user_id"`
	DepartmentID    *string                `json:"department_id"`
	LocationID      *string                `json:"location_id"`
	AgentID         *string                `json:"agent_id"`
	GroupID         *string                `json:"group_id"`
	ProductID       *string                `json:"product_id"`
	VendorID        *string                `json:"vendor_id"`
	Cost            *float64               `json:"cost"`
	SerialNumber    *string                `json:"serial_number"`
	AcquisitionDate *string                `json:"acquisition_date"`
	WarrantyExpiry  *string                `json:"warranty_expiry"`
	EndOfLife       *string                `json:"end_of_life"`
	TypeFields      map[string]interface{} `json:"type_fields"`
	Tags            *[]string              `json:"tags"`
}

var assetStates = []string{"in_use", "in_stock", "in_repair", "missing", "retired", "disposed"}

func (c *Ctx) applyAssetInput(as *Asset, in *assetInput) map[string]string {
	errs := map[string]string{}
	if in.Name != nil {
		as.Name = strings.TrimSpace(*in.Name)
	}
	if as.Name == "" {
		errs["name"] = "is required"
	}
	if in.AssetTag != nil {
		as.AssetTag = strings.TrimSpace(*in.AssetTag)
		if as.AssetTag != "" {
			var n int64
			excl := as.ID
			if excl == "" {
				excl = "00000000-0000-0000-0000-000000000000"
			}
			c.T(&Asset{}).Where("asset_tag = ? AND id <> ? AND NOT is_deleted", as.AssetTag, excl).Count(&n)
			if n > 0 {
				errs["asset_tag"] = "is already used by another asset"
			}
		}
	}
	if in.AssetTypeID != nil {
		as.AssetTypeID = *in.AssetTypeID
	}
	if !c.existsInOrg(&AssetType{}, as.AssetTypeID) {
		errs["asset_type_id"] = "is required"
	}
	setText(&as.Description, in.Description)
	if in.Impact != nil {
		if !oneOf(*in.Impact, "low", "medium", "high") {
			errs["impact"] = "must be low, medium or high"
		} else {
			as.Impact = *in.Impact
		}
	}
	if in.UsageType != nil {
		if !oneOf(*in.UsageType, "permanent", "loaner") {
			errs["usage_type"] = "must be permanent or loaner"
		} else {
			as.UsageType = *in.UsageType
		}
	}
	if in.State != nil {
		if !oneOf(*in.State, assetStates...) {
			errs["state"] = "is invalid"
		} else {
			as.State = *in.State
		}
	}
	if in.UserID != nil {
		prev := deref(as.UserID)
		as.UserID = strPtr(*in.UserID)
		c.optionalRef(errs, "user_id", as.UserID, c.userInOrg)
		if deref(as.UserID) != prev {
			if as.UserID != nil {
				n := now()
				as.AssignedOn = &n
				if as.State == "in_stock" {
					as.State = "in_use"
				}
			} else {
				as.AssignedOn = nil
			}
		}
	}
	if in.AgentID != nil {
		as.AgentID = strPtr(*in.AgentID)
		c.optionalRef(errs, "agent_id", as.AgentID, c.agentInOrg)
	}
	if in.GroupID != nil {
		as.GroupID = strPtr(*in.GroupID)
		c.optionalRef(errs, "group_id", as.GroupID, func(id string) bool { return c.existsInOrg(&AgentGroup{}, id) })
	}
	if in.DepartmentID != nil {
		as.DepartmentID = strPtr(*in.DepartmentID)
		c.optionalRef(errs, "department_id", as.DepartmentID, func(id string) bool { return c.existsInOrg(&Department{}, id) })
	}
	if in.LocationID != nil {
		as.LocationID = strPtr(*in.LocationID)
		c.optionalRef(errs, "location_id", as.LocationID, func(id string) bool { return c.existsInOrg(&Location{}, id) })
	}
	if in.ProductID != nil {
		as.ProductID = strPtr(*in.ProductID)
		c.optionalRef(errs, "product_id", as.ProductID, func(id string) bool { return c.existsInOrg(&Product{}, id) })
	}
	if in.VendorID != nil {
		as.VendorID = strPtr(*in.VendorID)
		c.optionalRef(errs, "vendor_id", as.VendorID, func(id string) bool { return c.existsInOrg(&Vendor{}, id) })
	}
	if in.Cost != nil {
		if *in.Cost < 0 || math.IsNaN(*in.Cost) {
			errs["cost"] = "must be a positive amount"
		} else {
			as.Cost = math.Round(*in.Cost*100) / 100
		}
	}
	setText(&as.SerialNumber, in.SerialNumber)
	setTime(errs, "acquisition_date", &as.AcquisitionDate, in.AcquisitionDate)
	setTime(errs, "warranty_expiry", &as.WarrantyExpiry, in.WarrantyExpiry)
	setTime(errs, "end_of_life", &as.EndOfLife, in.EndOfLife)
	if in.TypeFields != nil {
		var existing map[string]interface{}
		_ = json.Unmarshal(as.TypeFields, &existing)
		if existing == nil {
			existing = map[string]interface{}{}
		}
		for k, v := range in.TypeFields {
			existing[k] = v
		}
		as.TypeFields = jsonOf(existing)
	}
	if in.Tags != nil {
		as.Tags = jsonOf(normalizeTags(*in.Tags))
	}
	return errs
}

func (a *App) createAsset(c *Ctx) error {
	var in assetInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	as := Asset{Base: Base{OrgID: c.P.OrgID}, Impact: "low", UsageType: "permanent", State: "in_stock", Tags: jsonOf([]string{}), TypeFields: jsonOf(map[string]interface{}{})}
	if errs := c.applyAssetInput(&as, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		n, err := nextNumber(tx, c.P.OrgID, "asset")
		if err != nil {
			return err
		}
		as.Number = n
		if as.AssetTag == "" {
			as.AssetTag = fmt.Sprintf("ASSET-%d", n)
		}
		if err := tx.Create(&as).Error; err != nil {
			return err
		}
		c.activity(tx, "asset", as.ID, "created", "created the asset", nil)
		return nil
	})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, c.assetDTOs([]Asset{as})[0])
}

func (a *App) getAsset(c *Ctx) error {
	var as Asset
	if err := c.T(&Asset{}).Where("id = ?", c.Param("id")).Take(&as).Error; err != nil {
		return errNotFound("asset")
	}
	var acts []Activity
	c.T(&Activity{}).Where("entity_type = 'asset' AND entity_id = ?", as.ID).Order("created_at DESC").Limit(100).Find(&acts)
	ids := []string{}
	for _, ac := range acts {
		ids = append(ids, deref(ac.ActorID))
	}
	l := c.lookup(ids, nil, nil)
	history := []map[string]interface{}{}
	for _, ac := range acts {
		history = append(history, map[string]interface{}{"id": ac.ID, "summary": ac.Summary, "changes": ac.Changes, "actor": l.user(ac.ActorID), "created_at": ac.CreatedAt})
	}
	var contracts []Contract
	c.T(&Contract{}).Where("asset_ids @> ?", string(jsonOf([]string{as.ID}))).Find(&contracts)
	var installs []SoftwareInstallation
	c.T(&SoftwareInstallation{}).Where("asset_id = ?", as.ID).Find(&installs)
	software := []map[string]interface{}{}
	for _, in := range installs {
		var sw Software
		if c.T(&Software{}).Where("id = ?", in.SoftwareID).Take(&sw).Error == nil {
			software = append(software, map[string]interface{}{"id": in.ID, "software_id": sw.ID, "name": sw.Name, "publisher": sw.Publisher, "version": in.Version, "installed_at": in.InstalledAt})
		}
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"asset": c.assetDTOs([]Asset{as})[0], "history": history, "contracts": contracts,
		"software": software, "relationships": c.assetRelationships(as.ID)})
}

func (a *App) updateAsset(c *Ctx) error {
	var as Asset
	if err := c.T(&Asset{}).Where("id = ?", c.Param("id")).Take(&as).Error; err != nil {
		return errNotFound("asset")
	}
	before := as
	var in assetInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	if errs := c.applyAssetInput(&as, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	changes := diffFields(before, as, "name", "state", "user_id", "department_id", "location_id", "agent_id", "group_id", "impact", "asset_type_id", "cost", "warranty_expiry")
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&as).Error; err != nil {
			return err
		}
		if len(changes) > 0 {
			c.activity(tx, "asset", as.ID, "updated", "updated the asset", changes)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if deref(before.UserID) != deref(as.UserID) && as.UserID != nil && *as.UserID != c.P.UserID {
		notify(c.DB(), *as.UserID, "asset_assigned", "Asset assigned to you: "+as.Name, as.AssetTag, map[string]string{"asset_id": as.ID})
	}
	return c.JSON(http.StatusOK, c.assetDTOs([]Asset{as})[0])
}

func (a *App) exportAssets(c *Ctx) error {
	var items []Asset
	c.T(&Asset{}).Where("NOT is_deleted").Order("number").Limit(20000).Find(&items)
	dtos := c.assetDTOs(items)
	c.W.Header().Set("Content-Type", "text/csv; charset=utf-8")
	c.W.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="assets-%s.csv"`, now().Format("20060102")))
	w := csv.NewWriter(c.W)
	_ = w.Write([]string{"ID", "Name", "Asset tag", "Type", "State", "Impact", "Used by", "Department", "Location", "Serial number", "Cost", "Acquired", "Warranty expiry"})
	d := func(t *time.Time) string {
		if t == nil {
			return ""
		}
		return t.Format("2006-01-02")
	}
	name := func(r *Ref) string {
		if r == nil {
			return ""
		}
		return r.Name
	}
	for _, as := range dtos {
		user := ""
		if as.User != nil {
			user = as.User.Name
		}
		_ = w.Write([]string{as.DisplayID, csvSafe(as.Name), csvSafe(as.AssetTag), name(as.AssetType), as.State, as.Impact, csvSafe(user), name(as.Department),
			name(as.Location), csvSafe(as.SerialNumber), strconv.FormatFloat(as.Cost, 'f', 2, 64), d(as.AcquisitionDate), d(as.WarrantyExpiry)})
	}
	w.Flush()
	return w.Error()
}

// ---------------------------------------------------------------------------
// CMDB relationships
// ---------------------------------------------------------------------------

var relationshipTypes = map[string]string{
	"depends_on": "Used by", "runs_on": "Runs", "hosted_on": "Hosts", "connected_to": "Connected to",
	"contains": "Contained in", "member_of": "Has member", "backed_up_by": "Backs up", "sends_data_to": "Receives data from",
}

func (c *Ctx) assetRelationships(assetID string) []map[string]interface{} {
	var rels []AssetRelationship
	c.T(&AssetRelationship{}).Where("source_id = ? OR target_id = ?", assetID, assetID).Find(&rels)
	ids := []string{}
	for _, r := range rels {
		ids = append(ids, r.SourceID, r.TargetID)
	}
	assets := map[string]Asset{}
	if len(ids) > 0 {
		var as []Asset
		c.T(&Asset{}).Where("id IN ?", uniq(ids)).Find(&as)
		for _, x := range as {
			assets[x.ID] = x
		}
	}
	out := []map[string]interface{}{}
	for _, r := range rels {
		other, label := r.TargetID, titleCase(r.Type)
		if r.TargetID == assetID {
			other, label = r.SourceID, relationshipTypes[r.Type]
		}
		o, ok := assets[other]
		if !ok {
			continue
		}
		out = append(out, map[string]interface{}{"id": r.ID, "type": r.Type, "label": label, "direction": map[bool]string{true: "outgoing", false: "incoming"}[r.SourceID == assetID],
			"asset": map[string]interface{}{"id": o.ID, "name": o.Name, "display_id": "ASSET-" + strconv.FormatInt(o.Number, 10), "state": o.State, "impact": o.Impact}})
	}
	return out
}

func (a *App) createRelationship(c *Ctx) error {
	sourceID := c.Param("id")
	if !c.existsInOrg(&Asset{}, sourceID) {
		return errNotFound("asset")
	}
	var in struct {
		TargetID string `json:"target_id"`
		Type     string `json:"type"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	if _, ok := relationshipTypes[in.Type]; !ok {
		return errValidation(map[string]string{"type": "is not a supported relationship type"})
	}
	if in.TargetID == sourceID || !c.existsInOrg(&Asset{}, in.TargetID) {
		return errValidation(map[string]string{"target_id": "is invalid"})
	}
	var n int64
	c.T(&AssetRelationship{}).Where("source_id = ? AND target_id = ? AND type = ?", sourceID, in.TargetID, in.Type).Count(&n)
	if n > 0 {
		return errConflict("this relationship already exists")
	}
	r := AssetRelationship{Base: Base{OrgID: c.P.OrgID}, SourceID: sourceID, TargetID: in.TargetID, Type: in.Type}
	if err := c.DB().Create(&r).Error; err != nil {
		return err
	}
	c.activity(c.DB(), "asset", sourceID, "relationship", "added relationship "+titleCase(in.Type), nil)
	return c.JSON(http.StatusCreated, r)
}

func (a *App) deleteRelationship(c *Ctx) error {
	var r AssetRelationship
	if err := c.T(&AssetRelationship{}).Where("id = ?", c.Param("id")).Take(&r).Error; err != nil {
		return errNotFound("relationship")
	}
	if err := c.DB().Delete(&r).Error; err != nil {
		return err
	}
	c.activity(c.DB(), "asset", r.SourceID, "relationship", "removed relationship "+titleCase(r.Type), nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// impactAnalysis walks "depends on" style edges upstream to list every CI
// that would be affected if this asset fails.
func (a *App) impactAnalysis(c *Ctx) error {
	root := c.Param("id")
	if !c.existsInOrg(&Asset{}, root) {
		return errNotFound("asset")
	}
	var rels []AssetRelationship
	c.T(&AssetRelationship{}).Find(&rels)
	dependents := map[string][]string{}
	for _, r := range rels {
		switch r.Type {
		case "depends_on", "runs_on", "hosted_on", "backed_up_by":
			dependents[r.TargetID] = append(dependents[r.TargetID], r.SourceID)
		case "contains":
			dependents[r.SourceID] = append(dependents[r.SourceID], r.TargetID)
		}
	}
	depth := map[string]int{root: 0}
	queue := []string{root}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, d := range dependents[cur] {
			if _, seen := depth[d]; !seen {
				depth[d] = depth[cur] + 1
				queue = append(queue, d)
			}
		}
	}
	delete(depth, root)
	ids := make([]string, 0, len(depth))
	for id := range depth {
		ids = append(ids, id)
	}
	var assets []Asset
	if len(ids) > 0 {
		c.T(&Asset{}).Where("id IN ?", ids).Find(&assets)
	}
	out := []map[string]interface{}{}
	for _, dto := range c.assetDTOs(assets) {
		out = append(out, map[string]interface{}{"asset": dto, "depth": depth[dto.ID]})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
}

// ---------------------------------------------------------------------------
// Products, vendors, software
// ---------------------------------------------------------------------------

// simpleCRUD registers list/create/update/delete handlers for a flat model.
type simpleModel interface {
	*Product | *Vendor | *Software
}

func (a *App) listSimple(newSlice func() interface{}, order string) handlerFunc {
	return func(c *Ctx) error {
		items := newSlice()
		q := c.DB().Where("org_id = ?", c.P.OrgID)
		if v := c.Query("q"); v != "" {
			q = q.Where("name ILIKE ?", likeEscape(v))
		}
		if err := q.Order(order).Find(items).Error; err != nil {
			return err
		}
		return c.JSON(http.StatusOK, map[string]interface{}{"items": items})
	}
}

func (a *App) saveProduct(create bool) handlerFunc {
	return func(c *Ctx) error {
		p := Product{Base: Base{OrgID: c.P.OrgID}, Status: "in_production", ProcurementMode: "buy"}
		if !create {
			if err := c.T(&Product{}).Where("id = ?", c.Param("id")).Take(&p).Error; err != nil {
				return errNotFound("product")
			}
		}
		base := p.Base
		if err := c.Bind(&p); err != nil {
			return err
		}
		p.Base = base
		errs := map[string]string{}
		if p.Name = strings.TrimSpace(p.Name); p.Name == "" {
			errs["name"] = "is required"
		}
		if !oneOf(p.Status, "in_production", "in_pipeline", "retired") {
			errs["status"] = "is invalid"
		}
		if !oneOf(p.ProcurementMode, "buy", "lease", "both") {
			errs["procurement_mode"] = "is invalid"
		}
		if p.AssetTypeID != nil && *p.AssetTypeID == "" {
			p.AssetTypeID = nil
		}
		c.optionalRef(errs, "asset_type_id", p.AssetTypeID, func(id string) bool { return c.existsInOrg(&AssetType{}, id) })
		if len(errs) > 0 {
			return errValidation(errs)
		}
		return saveAndRespond(c, &p, create)
	}
}

func saveAndRespond(c *Ctx, v interface{}, create bool) error {
	var err error
	if create {
		err = c.DB().Create(v).Error
	} else {
		err = c.DB().Save(v).Error
	}
	if err != nil {
		return err
	}
	return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], v)
}

func (a *App) saveVendor(create bool) handlerFunc {
	return func(c *Ctx) error {
		v := Vendor{Base: Base{OrgID: c.P.OrgID}}
		if !create {
			if err := c.T(&Vendor{}).Where("id = ?", c.Param("id")).Take(&v).Error; err != nil {
				return errNotFound("vendor")
			}
		}
		base := v.Base
		if err := c.Bind(&v); err != nil {
			return err
		}
		v.Base = base
		errs := map[string]string{}
		if v.Name = strings.TrimSpace(v.Name); v.Name == "" {
			errs["name"] = "is required"
		}
		if v.Email != "" && !validEmail(v.Email) {
			errs["email"] = "is invalid"
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		return saveAndRespond(c, &v, create)
	}
}

func (a *App) saveSoftware(create bool) handlerFunc {
	return func(c *Ctx) error {
		s := Software{Base: Base{OrgID: c.P.OrgID}, Status: "managed"}
		if !create {
			if err := c.T(&Software{}).Where("id = ?", c.Param("id")).Take(&s).Error; err != nil {
				return errNotFound("software")
			}
		}
		base := s.Base
		if err := c.Bind(&s); err != nil {
			return err
		}
		s.Base = base
		errs := map[string]string{}
		if s.Name = strings.TrimSpace(s.Name); s.Name == "" {
			errs["name"] = "is required"
		}
		if !oneOf(s.Status, "managed", "restricted", "ignored", "disabled") {
			errs["status"] = "is invalid"
		}
		if s.ManagedByID != nil && *s.ManagedByID == "" {
			s.ManagedByID = nil
		}
		c.optionalRef(errs, "managed_by_id", s.ManagedByID, c.agentInOrg)
		if len(errs) > 0 {
			return errValidation(errs)
		}
		return saveAndRespond(c, &s, create)
	}
}

func (a *App) deleteSimple(model interface{}, entity string, refCheck func(c *Ctx, id string) int64) handlerFunc {
	return func(c *Ctx) error {
		id := c.Param("id")
		if !c.existsInOrg(model, id) {
			return errNotFound(entity)
		}
		if refCheck != nil {
			if n := refCheck(c, id); n > 0 {
				return errConflict(fmt.Sprintf("this %s is still referenced by %d record(s)", entity, n))
			}
		}
		if err := c.T(model).Where("id = ?", id).Delete(model).Error; err != nil {
			return err
		}
		c.audit(entity+".deleted", entity, id, "Deleted "+entity, nil)
		return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
	}
}

func (a *App) listSoftware(c *Ctx) error {
	var items []Software
	q := c.T(&Software{})
	if v := c.Query("q"); v != "" {
		q = q.Where("name ILIKE ? OR publisher ILIKE ?", likeEscape(v), likeEscape(v))
	}
	q.Order("name").Find(&items)
	out := []map[string]interface{}{}
	for _, s := range items {
		var installs, licenses int64
		c.T(&SoftwareInstallation{}).Where("software_id = ?", s.ID).Count(&installs)
		c.T(&Contract{}).Select("COALESCE(SUM(license_count),0)").Where("software_id = ? AND status = 'active'", s.ID).Scan(&licenses)
		out = append(out, map[string]interface{}{"software": s, "installations": installs, "licenses": licenses,
			"compliance": map[bool]string{true: "compliant", false: "over_deployed"}[licenses == 0 || installs <= licenses]})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
}

func (a *App) getSoftware(c *Ctx) error {
	var s Software
	if err := c.T(&Software{}).Where("id = ?", c.Param("id")).Take(&s).Error; err != nil {
		return errNotFound("software")
	}
	var installs []SoftwareInstallation
	c.T(&SoftwareInstallation{}).Where("software_id = ?", s.ID).Order("created_at DESC").Find(&installs)
	assetIDs, userIDs := []string{}, []string{}
	for _, in := range installs {
		assetIDs = append(assetIDs, in.AssetID)
		userIDs = append(userIDs, deref(in.UserID))
	}
	var assets []Asset
	if len(assetIDs) > 0 {
		c.T(&Asset{}).Where("id IN ?", uniq(assetIDs)).Find(&assets)
	}
	am := map[string]Asset{}
	for _, x := range assets {
		am[x.ID] = x
	}
	l := c.lookup(userIDs, nil, nil)
	rows := []map[string]interface{}{}
	for _, in := range installs {
		as := am[in.AssetID]
		rows = append(rows, map[string]interface{}{"id": in.ID, "version": in.Version, "installed_at": in.InstalledAt, "user": l.user(in.UserID),
			"asset": map[string]interface{}{"id": as.ID, "name": as.Name, "display_id": "ASSET-" + strconv.FormatInt(as.Number, 10)}})
	}
	var contracts []Contract
	c.T(&Contract{}).Where("software_id = ?", s.ID).Find(&contracts)
	return c.JSON(http.StatusOK, map[string]interface{}{"software": s, "installations": rows, "contracts": contracts})
}

func (a *App) addInstallation(c *Ctx) error {
	swID := c.Param("id")
	if !c.existsInOrg(&Software{}, swID) {
		return errNotFound("software")
	}
	var in struct {
		AssetID string  `json:"asset_id"`
		Version string  `json:"version"`
		UserID  *string `json:"user_id"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	if !c.existsInOrg(&Asset{}, in.AssetID) {
		return errValidation(map[string]string{"asset_id": "is invalid"})
	}
	inst := SoftwareInstallation{Base: Base{OrgID: c.P.OrgID}, SoftwareID: swID, AssetID: in.AssetID, Version: strings.TrimSpace(in.Version), InstalledAt: ptrTime(now())}
	if in.UserID != nil && *in.UserID != "" {
		if !c.userInOrg(*in.UserID) {
			return errValidation(map[string]string{"user_id": "is invalid"})
		}
		inst.UserID = in.UserID
	}
	if err := c.DB().Create(&inst).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, inst)
}

func (a *App) removeInstallation(c *Ctx) error {
	res := c.T(&SoftwareInstallation{}).Where("id = ?", c.Param("id")).Delete(&SoftwareInstallation{})
	if res.RowsAffected == 0 {
		return errNotFound("installation")
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

func (a *App) listContracts(c *Ctx) error {
	var items []Contract
	q := c.T(&Contract{})
	if v := c.Query("status"); v != "" {
		q = q.Where("status IN ?", strings.Split(v, ","))
	}
	if v := c.Query("contract_type"); v != "" {
		q = q.Where("contract_type = ?", v)
	}
	if c.Query("expiring") == "true" {
		q = q.Where("status = 'active' AND end_date BETWEEN ? AND ?", now(), now().AddDate(0, 0, 60))
	}
	if v := c.Query("q"); v != "" {
		q = q.Where("name ILIKE ?", likeEscape(v))
	}
	q.Order("end_date ASC NULLS LAST").Find(&items)
	vids := []string{}
	for _, ct := range items {
		vids = append(vids, deref(ct.VendorID))
	}
	vendors := map[string]string{}
	if ids := uniq(vids); len(ids) > 0 {
		var vs []Vendor
		c.T(&Vendor{}).Where("id IN ?", ids).Find(&vs)
		for _, v := range vs {
			vendors[v.ID] = v.Name
		}
	}
	out := []map[string]interface{}{}
	for _, ct := range items {
		out = append(out, map[string]interface{}{"contract": ct, "display_id": fmt.Sprintf("CNT-%d", ct.Number), "vendor_name": vendors[deref(ct.VendorID)],
			"asset_ids": stringsFrom(ct.AssetIDs), "days_to_expiry": daysUntil(ct.EndDate)})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
}

func daysUntil(t *time.Time) *int {
	if t == nil {
		return nil
	}
	d := int(math.Ceil(time.Until(*t).Hours() / 24))
	return &d
}

func (a *App) saveContract(create bool) handlerFunc {
	return func(c *Ctx) error {
		ct := Contract{Base: Base{OrgID: c.P.OrgID}, Status: "draft", ContractType: "maintenance", RenewalNoticeDays: 30,
			NotifyToIDs: jsonOf([]string{}), AssetIDs: jsonOf([]string{})}
		if !create {
			if err := c.T(&Contract{}).Where("id = ?", c.Param("id")).Take(&ct).Error; err != nil {
				return errNotFound("contract")
			}
		}
		var in struct {
			Name              *string   `json:"name"`
			ContractType      *string   `json:"contract_type"`
			Status            *string   `json:"status"`
			VendorID          *string   `json:"vendor_id"`
			ApproverID        *string   `json:"approver_id"`
			Cost              *float64  `json:"cost"`
			StartDate         *string   `json:"start_date"`
			EndDate           *string   `json:"end_date"`
			AutoRenew         *bool     `json:"auto_renew"`
			RenewalNoticeDays *int      `json:"renewal_notice_days"`
			NotifyToIDs       *[]string `json:"notify_to_ids"`
			Description       *string   `json:"description"`
			LicenseType       *string   `json:"license_type"`
			LicenseCount      *int      `json:"license_count"`
			BillingCycle      *string   `json:"billing_cycle"`
			SoftwareID        *string   `json:"software_id"`
			AssetIDs          *[]string `json:"asset_ids"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Name != nil {
			ct.Name = strings.TrimSpace(*in.Name)
		}
		if ct.Name == "" {
			errs["name"] = "is required"
		}
		if in.ContractType != nil {
			if !oneOf(*in.ContractType, "lease", "maintenance", "software_license", "warranty") {
				errs["contract_type"] = "is invalid"
			} else {
				ct.ContractType = *in.ContractType
			}
		}
		if in.Status != nil {
			if !oneOf(*in.Status, "draft", "pending_approval", "active", "expired", "terminated", "rejected") {
				errs["status"] = "is invalid"
			} else {
				ct.Status = *in.Status
			}
		}
		if in.VendorID != nil {
			ct.VendorID = strPtr(*in.VendorID)
			c.optionalRef(errs, "vendor_id", ct.VendorID, func(id string) bool { return c.existsInOrg(&Vendor{}, id) })
		}
		if in.ApproverID != nil {
			ct.ApproverID = strPtr(*in.ApproverID)
			c.optionalRef(errs, "approver_id", ct.ApproverID, c.userInOrg)
		}
		if in.Cost != nil {
			if *in.Cost < 0 {
				errs["cost"] = "must be positive"
			}
			ct.Cost = math.Round(*in.Cost*100) / 100
		}
		setTime(errs, "start_date", &ct.StartDate, in.StartDate)
		setTime(errs, "end_date", &ct.EndDate, in.EndDate)
		if ct.StartDate != nil && ct.EndDate != nil && ct.EndDate.Before(*ct.StartDate) {
			errs["end_date"] = "must be after the start date"
		}
		if in.AutoRenew != nil {
			ct.AutoRenew = *in.AutoRenew
		}
		if in.RenewalNoticeDays != nil {
			ct.RenewalNoticeDays = clampInt(*in.RenewalNoticeDays, 0, 365, 30)
			ct.ExpiryNotifiedAt = nil
		}
		if in.NotifyToIDs != nil {
			for _, id := range *in.NotifyToIDs {
				if !c.userInOrg(id) {
					errs["notify_to_ids"] = "contains an unknown user"
				}
			}
			ct.NotifyToIDs = jsonOf(uniq(*in.NotifyToIDs))
		}
		setText(&ct.Description, in.Description)
		setText(&ct.LicenseType, in.LicenseType)
		setText(&ct.BillingCycle, in.BillingCycle)
		if in.LicenseCount != nil {
			ct.LicenseCount = clampInt(*in.LicenseCount, 0, 10000000, 0)
		}
		if in.SoftwareID != nil {
			ct.SoftwareID = strPtr(*in.SoftwareID)
			c.optionalRef(errs, "software_id", ct.SoftwareID, func(id string) bool { return c.existsInOrg(&Software{}, id) })
		}
		if in.AssetIDs != nil {
			for _, id := range *in.AssetIDs {
				if !c.existsInOrg(&Asset{}, id) {
					errs["asset_ids"] = "contains an unknown asset"
				}
			}
			ct.AssetIDs = jsonOf(uniq(*in.AssetIDs))
		}
		if in.EndDate != nil {
			ct.ExpiryNotifiedAt = nil
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		err := c.DB().Transaction(func(tx *gorm.DB) error {
			if create {
				n, err := nextNumber(tx, c.P.OrgID, "contract")
				if err != nil {
					return err
				}
				ct.Number = n
				return tx.Create(&ct).Error
			}
			return tx.Save(&ct).Error
		})
		if err != nil {
			return err
		}
		c.audit("contract.saved", "contract", ct.ID, "Saved contract "+ct.Name, nil)
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], ct)
	}
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

// POItem is one purchase order line.
type POItem struct {
	ID          string  `json:"id"`
	ItemType    string  `json:"item_type"`
	ItemName    string  `json:"item_name"`
	AssetTypeID string  `json:"asset_type_id,omitempty"`
	ProductID   string  `json:"product_id,omitempty"`
	Description string  `json:"description"`
	Cost        float64 `json:"cost"`
	Quantity    int     `json:"quantity"`
	Received    int     `json:"received"`
}

func poTotal(po *PurchaseOrder, items []POItem) float64 {
	sub := 0.0
	for _, it := range items {
		sub += it.Cost * float64(it.Quantity)
	}
	sub -= sub * po.DiscountPercent / 100
	total := sub + sub*po.TaxPercent/100 + po.ShippingCost
	return math.Round(total*100) / 100
}

func (a *App) listPurchaseOrders(c *Ctx) error {
	var items []PurchaseOrder
	q := c.T(&PurchaseOrder{})
	if v := c.Query("status"); v != "" {
		q = q.Where("status IN ?", strings.Split(v, ","))
	}
	if v := c.Query("q"); v != "" {
		q = q.Where("name ILIKE ? OR po_number ILIKE ?", likeEscape(v), likeEscape(v))
	}
	q.Order("created_at DESC").Find(&items)
	out := []map[string]interface{}{}
	for _, po := range items {
		var lines []POItem
		_ = json.Unmarshal(po.Items, &lines)
		out = append(out, map[string]interface{}{"purchase_order": po, "display_id": fmt.Sprintf("PO-%d", po.Number), "items": lines})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
}

func (a *App) getPurchaseOrder(c *Ctx) error {
	var po PurchaseOrder
	if err := c.T(&PurchaseOrder{}).Where("id = ?", c.Param("id")).Take(&po).Error; err != nil {
		return errNotFound("purchase order")
	}
	var lines []POItem
	_ = json.Unmarshal(po.Items, &lines)
	var vendor *Vendor
	if po.VendorID != nil {
		var v Vendor
		if c.T(&Vendor{}).Where("id = ?", *po.VendorID).Take(&v).Error == nil {
			vendor = &v
		}
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"purchase_order": po, "display_id": fmt.Sprintf("PO-%d", po.Number), "items": lines, "vendor": vendor})
}

func (a *App) savePurchaseOrder(create bool) handlerFunc {
	return func(c *Ctx) error {
		po := PurchaseOrder{Base: Base{OrgID: c.P.OrgID}, Status: "open", Currency: "USD", CreatedByID: c.P.UserID}
		if !create {
			if err := c.T(&PurchaseOrder{}).Where("id = ?", c.Param("id")).Take(&po).Error; err != nil {
				return errNotFound("purchase order")
			}
		}
		var in struct {
			Name             *string   `json:"name"`
			PONumber         *string   `json:"po_number"`
			VendorID         *string   `json:"vendor_id"`
			Status           *string   `json:"status"`
			ExpectedDelivery *string   `json:"expected_delivery"`
			ShippingAddress  *string   `json:"shipping_address"`
			BillingAddress   *string   `json:"billing_address"`
			Currency         *string   `json:"currency"`
			TaxPercent       *float64  `json:"tax_percent"`
			ShippingCost     *float64  `json:"shipping_cost"`
			DiscountPercent  *float64  `json:"discount_percent"`
			DepartmentID     *string   `json:"department_id"`
			Terms            *string   `json:"terms"`
			Items            *[]POItem `json:"items"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Name != nil {
			po.Name = strings.TrimSpace(*in.Name)
		}
		if po.Name == "" {
			errs["name"] = "is required"
		}
		setText(&po.PONumber, in.PONumber)
		if in.VendorID != nil {
			po.VendorID = strPtr(*in.VendorID)
			c.optionalRef(errs, "vendor_id", po.VendorID, func(id string) bool { return c.existsInOrg(&Vendor{}, id) })
		}
		if po.VendorID == nil {
			errs["vendor_id"] = "is required"
		}
		if in.Status != nil {
			if !oneOf(*in.Status, "open", "ordered", "partially_received", "received", "cancelled") {
				errs["status"] = "is invalid"
			} else {
				po.Status = *in.Status
			}
		}
		setTime(errs, "expected_delivery", &po.ExpectedDelivery, in.ExpectedDelivery)
		setText(&po.ShippingAddress, in.ShippingAddress)
		setText(&po.BillingAddress, in.BillingAddress)
		setText(&po.Currency, in.Currency)
		setText(&po.Terms, in.Terms)
		pct := func(field string, dst *float64, v *float64) {
			if v != nil {
				if *v < 0 || *v > 100 {
					errs[field] = "must be between 0 and 100"
				}
				*dst = *v
			}
		}
		pct("tax_percent", &po.TaxPercent, in.TaxPercent)
		pct("discount_percent", &po.DiscountPercent, in.DiscountPercent)
		if in.ShippingCost != nil {
			if *in.ShippingCost < 0 {
				errs["shipping_cost"] = "must be positive"
			}
			po.ShippingCost = *in.ShippingCost
		}
		if in.DepartmentID != nil {
			po.DepartmentID = strPtr(*in.DepartmentID)
			c.optionalRef(errs, "department_id", po.DepartmentID, func(id string) bool { return c.existsInOrg(&Department{}, id) })
		}
		var lines []POItem
		_ = json.Unmarshal(po.Items, &lines)
		if in.Items != nil {
			prev := map[string]int{}
			for _, l := range lines {
				prev[l.ID] = l.Received
			}
			lines = *in.Items
			for i := range lines {
				l := &lines[i]
				if l.ID == "" {
					l.ID = randomKey(6)
				}
				l.Received = prev[l.ID]
				if strings.TrimSpace(l.ItemName) == "" || l.Quantity <= 0 || l.Cost < 0 {
					errs["items"] = fmt.Sprintf("line %d needs a name, a quantity and a non-negative cost", i+1)
				}
				if !oneOf(l.ItemType, "asset", "software", "consumable", "service") {
					l.ItemType = "asset"
				}
				if l.AssetTypeID != "" && !c.existsInOrg(&AssetType{}, l.AssetTypeID) {
					errs["items"] = fmt.Sprintf("line %d has an unknown asset type", i+1)
				}
			}
		}
		if len(lines) == 0 {
			errs["items"] = "add at least one line item"
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		po.Items = jsonOf(lines)
		po.Total = poTotal(&po, lines)
		err := c.DB().Transaction(func(tx *gorm.DB) error {
			if create {
				n, err := nextNumber(tx, c.P.OrgID, "purchase_order")
				if err != nil {
					return err
				}
				po.Number = n
				if po.PONumber == "" {
					po.PONumber = fmt.Sprintf("PO-%d", n)
				}
				return tx.Create(&po).Error
			}
			return tx.Save(&po).Error
		})
		if err != nil {
			return err
		}
		c.audit("purchase_order.saved", "purchase_order", po.ID, "Saved purchase order "+po.Name, nil)
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], po)
	}
}

// receivePurchaseOrder records received quantities and creates assets for
// received asset lines.
func (a *App) receivePurchaseOrder(c *Ctx) error {
	var po PurchaseOrder
	if err := c.T(&PurchaseOrder{}).Where("id = ?", c.Param("id")).Take(&po).Error; err != nil {
		return errNotFound("purchase order")
	}
	if oneOf(po.Status, "cancelled", "received") {
		return errBadRequest("this purchase order is " + po.Status)
	}
	var in struct {
		Lines []struct {
			ID         string `json:"id"`
			Quantity   int    `json:"quantity"`
			LocationID string `json:"location_id"`
		} `json:"lines"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	var lines []POItem
	_ = json.Unmarshal(po.Items, &lines)
	created := []string{}
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		for _, rl := range in.Lines {
			for i := range lines {
				l := &lines[i]
				if l.ID != rl.ID || rl.Quantity <= 0 {
					continue
				}
				qty := rl.Quantity
				if l.Received+qty > l.Quantity {
					return errBadRequest(fmt.Sprintf("cannot receive more than ordered for %s", l.ItemName))
				}
				l.Received += qty
				if l.ItemType != "asset" || l.AssetTypeID == "" {
					continue
				}
				for k := 0; k < qty; k++ {
					n, err := nextNumber(tx, c.P.OrgID, "asset")
					if err != nil {
						return err
					}
					acquired := now()
					as := Asset{Base: Base{OrgID: c.P.OrgID}, Number: n, Name: l.ItemName, AssetTag: fmt.Sprintf("ASSET-%d", n), AssetTypeID: l.AssetTypeID,
						Description: l.Description, Impact: "low", UsageType: "permanent", State: "in_stock", VendorID: po.VendorID, Cost: l.Cost,
						AcquisitionDate: &acquired, DepartmentID: po.DepartmentID, Tags: jsonOf([]string{}), TypeFields: jsonOf(map[string]interface{}{"purchase_order": po.PONumber})}
					if l.ProductID != "" && c.existsInOrg(&Product{}, l.ProductID) {
						pid := l.ProductID
						as.ProductID = &pid
					}
					if isUUID(rl.LocationID) && c.existsInOrg(&Location{}, rl.LocationID) {
						loc := rl.LocationID
						as.LocationID = &loc
					}
					if err := tx.Create(&as).Error; err != nil {
						return err
					}
					recordActivity(tx, c.P.OrgID, "asset", as.ID, &c.P.UserID, "created", "received from purchase order "+po.PONumber, nil)
					created = append(created, as.ID)
				}
			}
		}
		all, any := true, false
		for _, l := range lines {
			if l.Received < l.Quantity {
				all = false
			}
			if l.Received > 0 {
				any = true
			}
		}
		switch {
		case all:
			po.Status = "received"
		case any:
			po.Status = "partially_received"
		}
		po.Items = jsonOf(lines)
		return tx.Save(&po).Error
	})
	if err != nil {
		return err
	}
	c.audit("purchase_order.received", "purchase_order", po.ID, fmt.Sprintf("Received items on %s; %d asset(s) created", po.PONumber, len(created)), nil)
	return c.JSON(http.StatusOK, map[string]interface{}{"purchase_order": po, "created_asset_ids": created})
}

var _ = datatypes.JSON{}
