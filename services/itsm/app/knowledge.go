package app

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"

	"regexp"

	"github.com/chanduchitikam/task-management-system/services/itsm/rules"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ---------------------------------------------------------------------------
// Service catalog
// ---------------------------------------------------------------------------

// CatalogField is a form field on a catalog item.
type CatalogField struct {
	Name        string   `json:"name"`
	Label       string   `json:"label"`
	Type        string   `json:"type"`
	Required    bool     `json:"required"`
	Choices     []string `json:"choices,omitempty"`
	Placeholder string   `json:"placeholder,omitempty"`
}

func (c *Ctx) catalogVisible(item *CatalogItem) bool {
	if c.P.IsAgent {
		return true
	}
	if item.Status != "published" {
		return false
	}
	if item.Visibility == "departments" {
		return c.inAnyUnit(stringsFrom(item.DepartmentIDs))
	}
	return true
}

func (a *App) listCatalog(c *Ctx) error {
	var cats []CatalogCategory
	c.T(&CatalogCategory{}).Order("position, name").Find(&cats)
	q := c.T(&CatalogItem{})
	if !c.P.IsAgent || c.Query("portal") == "1" {
		q = q.Where("status = 'published'")
	}
	if v := c.Query("q"); v != "" {
		q = q.Where("(name ILIKE ? OR short_description ILIKE ?)", likeEscape(v), likeEscape(v))
	}
	if v := c.Query("category_id"); isUUID(v) {
		q = q.Where("category_id = ?", v)
	}
	var items []CatalogItem
	q.Order("position, name").Find(&items)
	visible := []map[string]interface{}{}
	for i := range items {
		if !c.catalogVisible(&items[i]) {
			continue
		}
		visible = append(visible, catalogItemJSON(&items[i]))
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"categories": cats, "items": visible})
}

func catalogItemJSON(it *CatalogItem) map[string]interface{} {
	var fields []CatalogField
	_ = json.Unmarshal(it.Fields, &fields)
	if fields == nil {
		fields = []CatalogField{}
	}
	return map[string]interface{}{"id": it.ID, "category_id": it.CategoryID, "name": it.Name, "short_description": it.ShortDescription,
		"description": it.Description, "cost": it.Cost, "delivery_hours": it.DeliveryHours, "status": it.Status, "icon": it.Icon,
		"quantity_enabled": it.QuantityEnabled, "fields": fields, "approval_required": it.ApprovalRequired, "approver_type": it.ApproverType,
		"approver_ids": stringsFrom(it.ApproverIDs), "delivery_group_id": it.DeliveryGroupID, "delivery_agent_id": it.DeliveryAgentID,
		"product_id": it.ProductID, "allow_attachments": it.AllowAttachments, "visibility": it.Visibility,
		"department_ids": stringsFrom(it.DepartmentIDs), "position": it.Position, "created_at": it.CreatedAt, "updated_at": it.UpdatedAt}
}

func (a *App) getCatalogItem(c *Ctx) error {
	var it CatalogItem
	if err := c.T(&CatalogItem{}).Where("id = ?", c.Param("id")).Take(&it).Error; err != nil || !c.catalogVisible(&it) {
		return errNotFound("catalog item")
	}
	return c.JSON(http.StatusOK, catalogItemJSON(&it))
}

func (a *App) saveCatalogCategory(create bool) handlerFunc {
	return func(c *Ctx) error {
		cat := CatalogCategory{Base: Base{OrgID: c.P.OrgID}}
		if !create {
			if err := c.T(&CatalogCategory{}).Where("id = ?", c.Param("id")).Take(&cat).Error; err != nil {
				return errNotFound("category")
			}
		}
		base := cat.Base
		if err := c.Bind(&cat); err != nil {
			return err
		}
		cat.Base = base
		if cat.Name = strings.TrimSpace(cat.Name); cat.Name == "" {
			return errValidation(map[string]string{"name": "is required"})
		}
		return saveAndRespond(c, &cat, create)
	}
}

func (a *App) deleteCatalogCategory(c *Ctx) error {
	var cat CatalogCategory
	if err := c.T(&CatalogCategory{}).Where("id = ?", c.Param("id")).Take(&cat).Error; err != nil {
		return errNotFound("category")
	}
	c.T(&CatalogItem{}).Where("category_id = ?", cat.ID).Update("category_id", nil)
	c.DB().Delete(&cat)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

func (a *App) saveCatalogItem(create bool) handlerFunc {
	return func(c *Ctx) error {
		it := CatalogItem{Base: Base{OrgID: c.P.OrgID}, Status: "draft", Visibility: "all", ApproverType: "specific",
			ApproverIDs: jsonOf([]string{}), DepartmentIDs: jsonOf([]string{}), Fields: jsonOf([]CatalogField{}), Icon: "package"}
		if !create {
			if err := c.T(&CatalogItem{}).Where("id = ?", c.Param("id")).Take(&it).Error; err != nil {
				return errNotFound("catalog item")
			}
		}
		var in struct {
			CategoryID       *string         `json:"category_id"`
			Name             *string         `json:"name"`
			ShortDescription *string         `json:"short_description"`
			Description      *string         `json:"description"`
			Cost             *float64        `json:"cost"`
			DeliveryHours    *int            `json:"delivery_hours"`
			Status           *string         `json:"status"`
			Icon             *string         `json:"icon"`
			QuantityEnabled  *bool           `json:"quantity_enabled"`
			Fields           *[]CatalogField `json:"fields"`
			ApprovalRequired *bool           `json:"approval_required"`
			ApproverType     *string         `json:"approver_type"`
			ApproverIDs      *[]string       `json:"approver_ids"`
			DeliveryGroupID  *string         `json:"delivery_group_id"`
			DeliveryAgentID  *string         `json:"delivery_agent_id"`
			ProductID        *string         `json:"product_id"`
			AllowAttachments *bool           `json:"allow_attachments"`
			Visibility       *string         `json:"visibility"`
			DepartmentIDs    *[]string       `json:"department_ids"`
			Position         *int            `json:"position"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Name != nil {
			it.Name = strings.TrimSpace(*in.Name)
		}
		if it.Name == "" {
			errs["name"] = "is required"
		}
		if in.CategoryID != nil {
			it.CategoryID = strPtr(*in.CategoryID)
			c.optionalRef(errs, "category_id", it.CategoryID, func(id string) bool { return c.existsInOrg(&CatalogCategory{}, id) })
		}
		setText(&it.ShortDescription, in.ShortDescription)
		setText(&it.Description, in.Description)
		setText(&it.Icon, in.Icon)
		if in.Cost != nil {
			if *in.Cost < 0 {
				errs["cost"] = "must be positive"
			}
			it.Cost = math.Round(*in.Cost*100) / 100
		}
		if in.DeliveryHours != nil {
			it.DeliveryHours = clampInt(*in.DeliveryHours, 0, 24*365, 0)
		}
		if in.Status != nil {
			if !oneOf(*in.Status, "draft", "published") {
				errs["status"] = "must be draft or published"
			} else {
				it.Status = *in.Status
			}
		}
		if in.QuantityEnabled != nil {
			it.QuantityEnabled = *in.QuantityEnabled
		}
		if in.Fields != nil {
			seen := map[string]bool{}
			for i, f := range *in.Fields {
				f.Name = strings.TrimSpace(strings.ToLower(strings.ReplaceAll(f.Name, " ", "_")))
				if f.Name == "" {
					f.Name = fmt.Sprintf("field_%d", i+1)
				}
				if seen[f.Name] || strings.TrimSpace(f.Label) == "" {
					errs["fields"] = fmt.Sprintf("field %d needs a unique name and a label", i+1)
				}
				if !oneOf(f.Type, "text", "paragraph", "number", "dropdown", "checkbox", "date", "multi_select") {
					errs["fields"] = fmt.Sprintf("field %d has an unsupported type", i+1)
				}
				if oneOf(f.Type, "dropdown", "multi_select") && len(f.Choices) == 0 {
					errs["fields"] = fmt.Sprintf("field %d needs choices", i+1)
				}
				seen[f.Name] = true
				(*in.Fields)[i] = f
			}
			it.Fields = jsonOf(*in.Fields)
		}
		if in.ApprovalRequired != nil {
			it.ApprovalRequired = *in.ApprovalRequired
		}
		if in.ApproverType != nil {
			if !oneOf(*in.ApproverType, "reporting_manager", "department_head", "specific") {
				errs["approver_type"] = "is invalid"
			} else {
				it.ApproverType = *in.ApproverType
			}
		}
		if in.ApproverIDs != nil {
			for _, id := range *in.ApproverIDs {
				if !c.userInOrg(id) {
					errs["approver_ids"] = "contains an unknown user"
				}
			}
			it.ApproverIDs = jsonOf(uniq(*in.ApproverIDs))
		}
		if it.ApprovalRequired && it.ApproverType == "specific" && len(stringsFrom(it.ApproverIDs)) == 0 {
			errs["approver_ids"] = "select at least one approver"
		}
		if in.DeliveryGroupID != nil {
			it.DeliveryGroupID = strPtr(*in.DeliveryGroupID)
			c.optionalRef(errs, "delivery_group_id", it.DeliveryGroupID, func(id string) bool { return c.existsInOrg(&AgentGroup{}, id) })
		}
		if in.DeliveryAgentID != nil {
			it.DeliveryAgentID = strPtr(*in.DeliveryAgentID)
			c.optionalRef(errs, "delivery_agent_id", it.DeliveryAgentID, c.agentInOrg)
		}
		if in.ProductID != nil {
			it.ProductID = strPtr(*in.ProductID)
			c.optionalRef(errs, "product_id", it.ProductID, func(id string) bool { return c.existsInOrg(&Product{}, id) })
		}
		if in.AllowAttachments != nil {
			it.AllowAttachments = *in.AllowAttachments
		}
		if in.Visibility != nil {
			if !oneOf(*in.Visibility, "all", "departments") {
				errs["visibility"] = "is invalid"
			} else {
				it.Visibility = *in.Visibility
			}
		}
		if in.DepartmentIDs != nil {
			it.DepartmentIDs = jsonOf(uniq(*in.DepartmentIDs))
		}
		if in.Position != nil {
			it.Position = *in.Position
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		var err error
		if create {
			err = c.DB().Create(&it).Error
		} else {
			err = c.DB().Save(&it).Error
		}
		if err != nil {
			return err
		}
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], catalogItemJSON(&it))
	}
}

func (a *App) deleteCatalogItem(c *Ctx) error {
	var it CatalogItem
	if err := c.T(&CatalogItem{}).Where("id = ?", c.Param("id")).Take(&it).Error; err != nil {
		return errNotFound("catalog item")
	}
	var n int64
	c.T(&RequestedItem{}).Where("item_id = ?", it.ID).Count(&n)
	if n > 0 {
		// Keep history intact; unpublish instead of deleting.
		c.DB().Model(&it).Update("status", "draft")
		return c.JSON(http.StatusOK, map[string]string{"message": "item has request history and was unpublished instead"})
	}
	c.DB().Delete(&it)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// placeRequest creates a service request ticket for a catalog item.
func (a *App) placeRequest(c *Ctx) error {
	var it CatalogItem
	if err := c.T(&CatalogItem{}).Where("id = ?", c.Param("id")).Take(&it).Error; err != nil || it.Status != "published" || !c.catalogVisible(&it) {
		return errNotFound("catalog item")
	}
	var in struct {
		Quantity       int                    `json:"quantity"`
		RequestedForID string                 `json:"requested_for_id"`
		Fields         map[string]interface{} `json:"fields"`
		Notes          string                 `json:"notes"`
		AttachmentIDs  []string               `json:"attachment_ids"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	if in.Quantity < 1 || !it.QuantityEnabled {
		in.Quantity = 1
	}
	if in.Quantity > 100 {
		return errValidation(map[string]string{"quantity": "must be 100 or less"})
	}
	if in.Fields == nil {
		in.Fields = map[string]interface{}{}
	}
	var defs []CatalogField
	_ = json.Unmarshal(it.Fields, &defs)
	errs := map[string]string{}
	lines := []string{}
	clean := map[string]interface{}{}
	for _, f := range defs {
		v := in.Fields[f.Name]
		sv := strings.TrimSpace(rules.Stringify(v))
		if f.Type == "checkbox" {
			b, _ := v.(bool)
			clean[f.Name] = b
			sv = map[bool]string{true: "Yes", false: "No"}[b]
		} else if f.Type == "multi_select" {
			list, _ := v.([]interface{})
			parts := []string{}
			for _, x := range list {
				parts = append(parts, rules.Stringify(x))
			}
			clean[f.Name] = parts
			sv = strings.Join(parts, ", ")
		} else {
			clean[f.Name] = sv
		}
		if f.Required && (sv == "" || sv == "No" && f.Type == "checkbox") {
			errs["fields."+f.Name] = f.Label + " is required"
			continue
		}
		if f.Type == "dropdown" && sv != "" && !oneOf(sv, f.Choices...) {
			errs["fields."+f.Name] = f.Label + " has an invalid choice"
		}
		if sv != "" {
			lines = append(lines, fmt.Sprintf("**%s:** %s", f.Label, sv))
		}
	}
	requestedFor := c.P.UserID
	if in.RequestedForID != "" && in.RequestedForID != c.P.UserID {
		if !c.userInOrg(in.RequestedForID) {
			errs["requested_for_id"] = "is invalid"
		}
		requestedFor = in.RequestedForID
	}
	if len(errs) > 0 {
		return errValidation(errs)
	}
	s := c.settings()
	desc := fmt.Sprintf("Service request for **%s** (quantity %d).\n\n%s", it.Name, in.Quantity, strings.Join(lines, "\n"))
	if in.Notes != "" {
		desc += "\n\n**Notes:** " + in.Notes
	}
	t := Ticket{Base: Base{OrgID: c.P.OrgID}, Type: "service_request", Subject: "Request for " + it.Name, Description: desc, Status: "open",
		Priority: 2, Urgency: 1, Impact: 1, Source: "portal", RequesterID: requestedFor, GroupID: it.DeliveryGroupID, ResponderID: it.DeliveryAgentID,
		Tags: jsonOf([]string{"service-request"}), CCEmails: jsonOf([]string{}), CustomFields: jsonOf(map[string]interface{}{}), CreatedByID: c.P.UserID}
	var dept *string
	c.DB().Model(&Person{}).Select("department_id").Where("user_id = ?", requestedFor).Scan(&dept)
	t.DepartmentID = dept
	var approvers []string
	if it.ApprovalRequired {
		switch it.ApproverType {
		case "reporting_manager":
			var mgr *string
			c.DB().Model(&Person{}).Select("reporting_manager_id").Where("user_id = ?", requestedFor).Scan(&mgr)
			if mgr != nil {
				approvers = []string{*mgr}
			}
		case "department_head":
			if dept != nil {
				var head *string
				c.T(&Department{}).Select("head_user_id").Where("id = ?", *dept).Scan(&head)
				if head != nil {
					approvers = []string{*head}
				}
			}
		default:
			approvers = stringsFrom(it.ApproverIDs)
		}
		if len(approvers) == 0 {
			// Fall back to account admins so the request is never stuck.
			c.DB().Table("users").Where("org_id = ? AND role IN ('org_admin','admin') AND is_active", c.P.OrgID).Limit(1).Pluck("id", &approvers)
		}
	}
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		n, err := nextNumber(tx, c.P.OrgID, "ticket")
		if err != nil {
			return err
		}
		t.Number = n
		t.CreatedAt = now()
		applySLA(tx, &t)
		if it.DeliveryHours > 0 {
			due := calendarFor(tx, t.OrgID, t.GroupID).Add(t.CreatedAt, hoursDuration(it.DeliveryHours)).UTC()
			t.DueBy = &due
		}
		if err := tx.Create(&t).Error; err != nil {
			return err
		}
		ri := RequestedItem{Base: Base{OrgID: c.P.OrgID}, TicketID: t.ID, ItemID: it.ID, Quantity: in.Quantity, Stage: "requested",
			Cost: math.Round(it.Cost*float64(in.Quantity)*100) / 100, FieldValues: jsonOf(clean), RequestedForID: requestedFor}
		if it.ApprovalRequired {
			ri.Stage = "requested"
		} else {
			ri.Stage = "in_progress"
		}
		if err := tx.Create(&ri).Error; err != nil {
			return err
		}
		c.attachFiles(tx, "ticket", t.ID, in.AttachmentIDs)
		c.activity(tx, "ticket", t.ID, "created", "requested "+it.Name, nil)
		if len(approvers) > 0 {
			if _, err := a.requestApprovals(c, tx, "ticket", t.ID, ticketDisplayID(s, &t)+" "+t.Subject, approvers); err != nil {
				return err
			}
			c.activity(tx, "ticket", t.ID, "approval", "approval requested", nil)
		}
		return nil
	})
	if err != nil {
		return err
	}
	a.afterTicketCreated(c, &t, s)
	return c.JSON(http.StatusCreated, c.ticketDTOs([]Ticket{t})[0])
}

func (a *App) updateRequestedItem(c *Ctx) error {
	var ri RequestedItem
	if err := c.T(&RequestedItem{}).Where("id = ?", c.Param("id")).Take(&ri).Error; err != nil {
		return errNotFound("requested item")
	}
	if _, err := c.loadTicket(ri.TicketID); err != nil {
		return err
	}
	var in struct {
		Stage string `json:"stage"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	if !oneOf(in.Stage, "requested", "in_progress", "delivered", "cancelled") {
		return errValidation(map[string]string{"stage": "is invalid"})
	}
	ri.Stage = in.Stage
	c.DB().Save(&ri)
	c.activity(c.DB(), "ticket", ri.TicketID, "requested_item", "marked the requested item as "+strings.ReplaceAll(in.Stage, "_", " "), nil)
	return c.JSON(http.StatusOK, ri)
}

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

func (c *Ctx) folderVisible(f *KBFolder) bool {
	if c.P.IsAgent {
		return true
	}
	switch f.Visibility {
	case "agents":
		return false
	case "departments":
		return c.inAnyUnit(stringsFrom(f.DepartmentIDs))
	}
	return true
}

func (c *Ctx) visibleFolderIDs() []string {
	var folders []KBFolder
	c.T(&KBFolder{}).Find(&folders)
	out := []string{}
	for i := range folders {
		if c.folderVisible(&folders[i]) {
			out = append(out, folders[i].ID)
		}
	}
	return out
}

func (c *Ctx) canSeeArticle(id string) bool {
	var art KBArticle
	if c.T(&KBArticle{}).Where("id = ?", id).Take(&art).Error != nil {
		return false
	}
	if c.P.IsAgent {
		return true
	}
	if art.Status != "published" {
		return false
	}
	var f KBFolder
	return c.T(&KBFolder{}).Where("id = ?", art.FolderID).Take(&f).Error == nil && c.folderVisible(&f)
}

func (a *App) kbTree(c *Ctx) error {
	var cats []KBCategory
	c.T(&KBCategory{}).Order("position, name").Find(&cats)
	var folders []KBFolder
	c.T(&KBFolder{}).Order("position, name").Find(&folders)
	countQ := c.T(&KBArticle{}).Select("folder_id, count(*) AS n")
	if !c.P.IsAgent {
		countQ = countQ.Where("status = 'published'")
	}
	var counts []struct {
		FolderID string
		N        int64
	}
	countQ.Group("folder_id").Scan(&counts)
	cm := map[string]int64{}
	for _, x := range counts {
		cm[x.FolderID] = x.N
	}
	out := []map[string]interface{}{}
	for _, cat := range cats {
		fl := []map[string]interface{}{}
		for i := range folders {
			f := &folders[i]
			if f.CategoryID != cat.ID || !c.folderVisible(f) {
				continue
			}
			fl = append(fl, map[string]interface{}{"id": f.ID, "name": f.Name, "description": f.Description, "visibility": f.Visibility,
				"department_ids": stringsFrom(f.DepartmentIDs), "position": f.Position, "article_count": cm[f.ID], "category_id": f.CategoryID})
		}
		if !c.P.IsAgent && len(fl) == 0 {
			continue
		}
		out = append(out, map[string]interface{}{"id": cat.ID, "name": cat.Name, "description": cat.Description, "position": cat.Position, "folders": fl})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
}

// ArticleDTO adds author and folder details.
type ArticleDTO struct {
	*KBArticle
	Author *UserBrief `json:"author"`
	Folder *Ref       `json:"folder"`
	Tags   []string   `json:"tags"`
}

func (c *Ctx) articleDTOs(items []KBArticle) []ArticleDTO {
	var uids, fids []string
	for _, ar := range items {
		uids = append(uids, ar.AuthorID)
		fids = append(fids, ar.FolderID)
	}
	l := c.lookup(uids, nil, nil)
	folders := map[string]*Ref{}
	if ids := uniq(fids); len(ids) > 0 {
		var fs []KBFolder
		c.T(&KBFolder{}).Where("id IN ?", ids).Find(&fs)
		for _, f := range fs {
			folders[f.ID] = &Ref{ID: f.ID, Name: f.Name}
		}
	}
	out := make([]ArticleDTO, len(items))
	for i := range items {
		out[i] = ArticleDTO{KBArticle: &items[i], Author: l.userS(items[i].AuthorID), Folder: folders[items[i].FolderID], Tags: stringsFrom(items[i].Tags)}
	}
	return out
}

func (a *App) listArticles(c *Ctx) error {
	pg := c.Paging()
	folders := c.visibleFolderIDs()
	build := func() *gorm.DB {
		q := c.T(&KBArticle{}).Where("folder_id IN ?", append(folders, "00000000-0000-0000-0000-000000000000"))
		if !c.P.IsAgent {
			q = q.Where("status = 'published'")
		} else if v := c.Query("status"); v != "" {
			q = q.Where("status = ?", v)
		}
		if v := c.Query("folder_id"); isUUID(v) {
			q = q.Where("folder_id = ?", v)
		}
		if v := c.Query("tag"); v != "" {
			q = q.Where("tags @> ?", string(jsonOf([]string{strings.ToLower(v)})))
		}
		if v := c.Query("q"); v != "" {
			if tsq := prefixQuery(v, "&"); tsq != "" {
				q = q.Where(`(`+kbVector+` @@ to_tsquery('simple', ?) OR title ILIKE ?)`, tsq, likeEscape(v))
			} else {
				q = q.Where("title ILIKE ?", likeEscape(v))
			}
		}
		return q
	}
	var total int64
	build().Count(&total)
	order := "updated_at DESC"
	if c.Query("sort") == "popular" {
		order = "views DESC, thumbs_up DESC"
	}
	var items []KBArticle
	if err := build().Order(order).Offset(pg.Offset()).Limit(pg.PerPage).Find(&items).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, ListResponse{Items: c.articleDTOs(items), Total: total, Page: pg.Page, PerPage: pg.PerPage})
}

func (a *App) getArticle(c *Ctx) error {
	id := c.Param("id")
	if !c.canSeeArticle(id) {
		return errNotFound("article")
	}
	c.T(&KBArticle{}).Where("id = ?", id).UpdateColumn("views", gorm.Expr("views + 1"))
	var art KBArticle
	c.T(&KBArticle{}).Where("id = ?", id).Take(&art)
	var atts []Attachment
	c.T(&Attachment{}).Select("id, org_id, entity_type, entity_id, name, content_type, size, uploaded_by, created_at, updated_at").
		Where("entity_type = 'kb_article' AND entity_id = ?", id).Find(&atts)
	// Related: same folder, most viewed.
	var related []KBArticle
	rq := c.T(&KBArticle{}).Where("folder_id = ? AND id <> ?", art.FolderID, art.ID)
	if !c.P.IsAgent {
		rq = rq.Where("status = 'published'")
	}
	rq.Order("views DESC").Limit(5).Find(&related)
	return c.JSON(http.StatusOK, map[string]interface{}{"article": c.articleDTOs([]KBArticle{art})[0], "attachments": atts, "related": c.articleDTOs(related)})
}

func (a *App) saveArticle(create bool) handlerFunc {
	return func(c *Ctx) error {
		art := KBArticle{Base: Base{OrgID: c.P.OrgID}, Status: "draft", ArticleType: "permanent", AuthorID: c.P.UserID, Tags: jsonOf([]string{})}
		if !create {
			if err := c.T(&KBArticle{}).Where("id = ?", c.Param("id")).Take(&art).Error; err != nil {
				return errNotFound("article")
			}
		}
		var in struct {
			FolderID      *string   `json:"folder_id"`
			Title         *string   `json:"title"`
			Body          *string   `json:"body"`
			Status        *string   `json:"status"`
			ArticleType   *string   `json:"article_type"`
			Tags          *[]string `json:"tags"`
			Keywords      *string   `json:"keywords"`
			ReviewDate    *string   `json:"review_date"`
			AttachmentIDs []string  `json:"attachment_ids"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.FolderID != nil {
			art.FolderID = *in.FolderID
		}
		if !c.existsInOrg(&KBFolder{}, art.FolderID) {
			errs["folder_id"] = "is required"
		}
		if in.Title != nil {
			art.Title = strings.TrimSpace(*in.Title)
		}
		if art.Title == "" {
			errs["title"] = "is required"
		}
		setText(&art.Body, in.Body)
		if in.Status != nil {
			if !oneOf(*in.Status, "draft", "published") {
				errs["status"] = "must be draft or published"
			} else {
				if *in.Status == "published" && art.PublishedAt == nil {
					n := now()
					art.PublishedAt = &n
				}
				art.Status = *in.Status
			}
		}
		if in.ArticleType != nil {
			if !oneOf(*in.ArticleType, "permanent", "workaround") {
				errs["article_type"] = "must be permanent or workaround"
			} else {
				art.ArticleType = *in.ArticleType
			}
		}
		if in.Tags != nil {
			art.Tags = jsonOf(normalizeTags(*in.Tags))
		}
		setText(&art.Keywords, in.Keywords)
		setTime(errs, "review_date", &art.ReviewDate, in.ReviewDate)
		if art.Status == "published" && strings.TrimSpace(art.Body) == "" {
			errs["body"] = "is required to publish"
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		err := c.DB().Transaction(func(tx *gorm.DB) error {
			var err error
			if create {
				err = tx.Create(&art).Error
			} else {
				err = tx.Save(&art).Error
			}
			if err != nil {
				return err
			}
			c.attachFiles(tx, "kb_article", art.ID, in.AttachmentIDs)
			return nil
		})
		if err != nil {
			return err
		}
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], c.articleDTOs([]KBArticle{art})[0])
	}
}

func (a *App) deleteArticle(c *Ctx) error {
	var art KBArticle
	if err := c.T(&KBArticle{}).Where("id = ?", c.Param("id")).Take(&art).Error; err != nil {
		return errNotFound("article")
	}
	c.DB().Transaction(func(tx *gorm.DB) error {
		tx.Where("org_id = ? AND entity_type = 'kb_article' AND entity_id = ?", c.P.OrgID, art.ID).Delete(&Attachment{})
		return tx.Delete(&art).Error
	})
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

func (a *App) voteArticle(c *Ctx) error {
	id := c.Param("id")
	if !c.canSeeArticle(id) {
		return errNotFound("article")
	}
	var in struct {
		Helpful bool `json:"helpful"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	col := "thumbs_down"
	if in.Helpful {
		col = "thumbs_up"
	}
	c.T(&KBArticle{}).Where("id = ?", id).UpdateColumn(col, gorm.Expr(col+" + 1"))
	return c.JSON(http.StatusOK, map[string]string{"message": "thanks for your feedback"})
}

func (a *App) saveKBCategory(create bool) handlerFunc {
	return func(c *Ctx) error {
		cat := KBCategory{Base: Base{OrgID: c.P.OrgID}}
		if !create {
			if err := c.T(&KBCategory{}).Where("id = ?", c.Param("id")).Take(&cat).Error; err != nil {
				return errNotFound("category")
			}
		}
		base := cat.Base
		if err := c.Bind(&cat); err != nil {
			return err
		}
		cat.Base = base
		if cat.Name = strings.TrimSpace(cat.Name); cat.Name == "" {
			return errValidation(map[string]string{"name": "is required"})
		}
		return saveAndRespond(c, &cat, create)
	}
}

func (a *App) deleteKBCategory(c *Ctx) error {
	var cat KBCategory
	if err := c.T(&KBCategory{}).Where("id = ?", c.Param("id")).Take(&cat).Error; err != nil {
		return errNotFound("category")
	}
	var n int64
	c.T(&KBFolder{}).Where("category_id = ?", cat.ID).Count(&n)
	if n > 0 {
		return errConflict("delete the folders in this category first")
	}
	c.DB().Delete(&cat)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

func (a *App) saveKBFolder(create bool) handlerFunc {
	return func(c *Ctx) error {
		f := KBFolder{Base: Base{OrgID: c.P.OrgID}, Visibility: "all", DepartmentIDs: jsonOf([]string{})}
		if !create {
			if err := c.T(&KBFolder{}).Where("id = ?", c.Param("id")).Take(&f).Error; err != nil {
				return errNotFound("folder")
			}
		}
		var in struct {
			CategoryID    *string   `json:"category_id"`
			Name          *string   `json:"name"`
			Description   *string   `json:"description"`
			Visibility    *string   `json:"visibility"`
			DepartmentIDs *[]string `json:"department_ids"`
			Position      *int      `json:"position"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.CategoryID != nil {
			f.CategoryID = *in.CategoryID
		}
		if !c.existsInOrg(&KBCategory{}, f.CategoryID) {
			errs["category_id"] = "is required"
		}
		if in.Name != nil {
			f.Name = strings.TrimSpace(*in.Name)
		}
		if f.Name == "" {
			errs["name"] = "is required"
		}
		setText(&f.Description, in.Description)
		if in.Visibility != nil {
			if !oneOf(*in.Visibility, "all", "logged_in", "agents", "departments") {
				errs["visibility"] = "is invalid"
			} else {
				f.Visibility = *in.Visibility
			}
		}
		if in.DepartmentIDs != nil {
			f.DepartmentIDs = jsonOf(uniq(*in.DepartmentIDs))
		}
		if in.Position != nil {
			f.Position = *in.Position
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		return saveAndRespond(c, &f, create)
	}
}

func (a *App) deleteKBFolder(c *Ctx) error {
	var f KBFolder
	if err := c.T(&KBFolder{}).Where("id = ?", c.Param("id")).Take(&f).Error; err != nil {
		return errNotFound("folder")
	}
	var n int64
	c.T(&KBArticle{}).Where("folder_id = ?", f.ID).Count(&n)
	if n > 0 {
		return errConflict(fmt.Sprintf("move or delete the %d article(s) in this folder first", n))
	}
	c.DB().Delete(&f)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// suggestArticles returns published articles matching a ticket subject;
// used for deflection on the portal and by agents when replying.
func (a *App) suggestArticles(c *Ctx) error {
	q := c.Query("q")
	if len(q) < 3 {
		return c.JSON(http.StatusOK, map[string]interface{}{"items": []interface{}{}})
	}
	tsq := prefixQuery(q, "|")
	if tsq == "" {
		return c.JSON(http.StatusOK, map[string]interface{}{"items": []interface{}{}})
	}
	folders := c.visibleFolderIDs()
	var items []KBArticle
	// Any matching word counts; the best-ranked articles win.
	c.T(&KBArticle{}).Where("status = 'published' AND folder_id IN ?", append(folders, "00000000-0000-0000-0000-000000000000")).
		Where(kbVector+" @@ to_tsquery('simple', ?)", tsq).
		Order(clause.Expr{SQL: "ts_rank(" + kbVector + ", to_tsquery('simple', ?)) DESC, views DESC", Vars: []interface{}{tsq}}).
		Limit(5).Find(&items)
	return c.JSON(http.StatusOK, map[string]interface{}{"items": c.articleDTOs(items)})
}

const kbVector = "to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || coalesce(keywords,''))"

var wordRe = regexp.MustCompile(`[\p{L}\p{N}]{2,}`)

// stopWords are too common to help find an article.
var stopWords = map[string]bool{"the": true, "and": true, "for": true, "not": true, "with": true, "my": true, "is": true, "it": true, "to": true, "on": true, "in": true, "of": true, "can": true, "cannot": true, "keeps": true, "how": true, "do": true, "i": true, "a": true}

// prefixQuery turns free text into a safe tsquery of prefix terms joined by op.
func prefixQuery(text, op string) string {
	terms := []string{}
	seen := map[string]bool{}
	for _, w := range wordRe.FindAllString(strings.ToLower(text), 12) {
		if stopWords[w] || seen[w] {
			continue
		}
		seen[w] = true
		// Light stemming so "disconnecting" also matches "disconnects".
		if len(w) > 6 {
			for _, suf := range []string{"ing", "ed", "es", "s"} {
				if strings.HasSuffix(w, suf) {
					w = strings.TrimSuffix(w, suf)
					break
				}
			}
		}
		terms = append(terms, w+":*")
	}
	return strings.Join(terms, " "+op+" ")
}
