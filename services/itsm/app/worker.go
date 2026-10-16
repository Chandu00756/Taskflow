package app

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/mailer"
	"gorm.io/gorm"
)

// workerLockID is the Postgres advisory lock that elects one worker replica.
const workerLockID = 734251908

// RunWorkers executes periodic background jobs until ctx is cancelled.
func (a *App) RunWorkers(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	a.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.tick(ctx)
		}
	}
}

func (a *App) tick(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("itsm worker panic: %v", r)
		}
	}()
	sqlDB, err := a.DB.DB()
	if err != nil {
		return
	}
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return
	}
	defer conn.Close()
	var locked bool
	if err := conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock($1)", workerLockID).Scan(&locked); err != nil || !locked {
		return
	}
	defer conn.ExecContext(context.Background(), "SELECT pg_advisory_unlock($1)", workerLockID) //nolint:errcheck

	db := a.DB.WithContext(ctx)
	a.escalateSLAs(ctx, db)
	a.escalateUnassigned(ctx, db)
	a.autoCloseResolved(db)
	a.processContracts(ctx, db)
	a.deliverEmail(db)
	a.cleanup(db)
}

func (a *App) escalationTargets(db *gorm.DB, t *Ticket) []string {
	targets := []string{}
	if t.GroupID != nil {
		var g AgentGroup
		if db.Where("id = ?", *t.GroupID).Take(&g).Error == nil && g.EscalateToID != nil {
			targets = append(targets, *g.EscalateToID)
		}
	}
	if t.ResponderID != nil {
		targets = append(targets, *t.ResponderID)
	}
	if len(targets) == 0 {
		db.Table("users").Where("org_id = ? AND role IN ('org_admin','admin') AND is_active", t.OrgID).Limit(3).Pluck("id", &targets)
	}
	return uniq(targets)
}

func (a *App) settingsFor(db *gorm.DB, orgID string) *Settings {
	var s Settings
	if db.Where("org_id = ?", orgID).Take(&s).Error != nil {
		return &Settings{OrgID: orgID, PrefixIncident: "INC", PrefixServiceRequest: "SR", HelpdeskName: "Service Desk"}
	}
	return &s
}

func (a *App) escalateSLAs(ctx context.Context, db *gorm.DB) {
	n := now()
	process := func(kind string, where string, flag string) {
		var tickets []Ticket
		db.Where(where, n).Where("status NOT IN ('resolved','closed') AND pending_since IS NULL AND NOT is_deleted AND NOT is_spam").
			Limit(500).Find(&tickets)
		for i := range tickets {
			t := &tickets[i]
			res := db.Model(&Ticket{}).Where("id = ? AND NOT "+flag, t.ID).Update(flag, true)
			if res.RowsAffected == 0 {
				continue
			}
			s := a.settingsFor(db, t.OrgID)
			disp := ticketDisplayID(s, t)
			due := t.DueBy
			if kind == "first response" {
				due = t.FrDueBy
			}
			vars := a.ticketVars(db, t, s)
			vars["sla.kind"] = kind
			if due != nil {
				vars["sla.due"] = due.Format(time.RFC1123)
			}
			for _, id := range a.escalationTargets(db, t) {
				notify(db, id, "sla_violation", fmt.Sprintf("SLA %s target missed on %s", kind, disp), t.Subject, map[string]string{"ticket_id": t.ID})
				if email, _ := a.userEmail(db, id); email != "" {
					a.queueEmail(ctx, db, t.OrgID, "sla_violation", email, vars, "ticket", t.ID)
				}
			}
			recordActivity(db, t.OrgID, "ticket", t.ID, nil, "sla", "SLA "+kind+" target was missed; escalated", nil)
		}
	}
	process("first response", "fr_due_by < ? AND first_responded_at IS NULL", "fr_escalated")
	process("resolution", "due_by < ?", "is_escalated")
}

func (a *App) escalateUnassigned(ctx context.Context, db *gorm.DB) {
	var groups []AgentGroup
	db.Where("unassigned_for_minutes > 0 AND escalate_to_id IS NOT NULL").Find(&groups)
	for _, g := range groups {
		var tickets []Ticket
		db.Where("org_id = ? AND group_id = ? AND responder_id IS NULL AND NOT unassigned_esc AND status NOT IN ('resolved','closed') AND NOT is_deleted AND created_at < ?",
			g.OrgID, g.ID, now().Add(-time.Duration(g.UnassignedForMinutes)*time.Minute)).Limit(200).Find(&tickets)
		for i := range tickets {
			t := &tickets[i]
			db.Model(&Ticket{}).Where("id = ?", t.ID).Update("unassigned_esc", true)
			s := a.settingsFor(db, t.OrgID)
			notify(db, *g.EscalateToID, "unassigned_escalation",
				fmt.Sprintf("%s has been unassigned in %s for over %d minutes", ticketDisplayID(s, t), g.Name, g.UnassignedForMinutes),
				t.Subject, map[string]string{"ticket_id": t.ID})
			recordActivity(db, t.OrgID, "ticket", t.ID, nil, "escalation", "escalated: unassigned for too long", nil)
		}
	}
}

func (a *App) autoCloseResolved(db *gorm.DB) {
	var settings []Settings
	db.Where("auto_close_resolved_hours > 0").Find(&settings)
	for _, s := range settings {
		var ids []string
		db.Model(&Ticket{}).Where("org_id = ? AND status = 'resolved' AND resolved_at < ? AND NOT is_deleted", s.OrgID,
			now().Add(-time.Duration(s.AutoCloseResolvedHours)*time.Hour)).Limit(500).Pluck("id", &ids)
		for _, id := range ids {
			db.Model(&Ticket{}).Where("id = ?", id).Updates(map[string]interface{}{"status": "closed", "closed_at": now()})
			recordActivity(db, s.OrgID, "ticket", id, nil, "status", "automatically closed after being resolved", []FieldChange{{Field: "status", From: "resolved", To: "closed"}})
		}
	}
}

func (a *App) processContracts(ctx context.Context, db *gorm.DB) {
	var contracts []Contract
	db.Where("status = 'active' AND end_date IS NOT NULL AND expiry_notified_at IS NULL AND end_date <= now() + (renewal_notice_days || ' days')::interval").
		Limit(200).Find(&contracts)
	for _, ct := range contracts {
		recipients := stringsFrom(ct.NotifyToIDs)
		if ct.ApproverID != nil {
			recipients = append(recipients, *ct.ApproverID)
		}
		vendor := ""
		if ct.VendorID != nil {
			db.Model(&Vendor{}).Select("name").Where("id = ?", *ct.VendorID).Scan(&vendor)
		}
		vars := map[string]string{"contract.name": ct.Name, "contract.vendor": vendor, "contract.end_date": ct.EndDate.Format("Jan 2, 2006")}
		for _, id := range uniq(recipients) {
			notify(db, id, "contract_expiring", "Contract "+ct.Name+" expires on "+vars["contract.end_date"], vendor, map[string]string{"contract_id": ct.ID})
			if email, _ := a.userEmail(db, id); email != "" {
				a.queueEmail(ctx, db, ct.OrgID, "contract_expiring", email, vars, "contract", ct.ID)
			}
		}
		db.Model(&Contract{}).Where("id = ?", ct.ID).Update("expiry_notified_at", now())
	}
	// Expire or auto-renew contracts past their end date.
	var ended []Contract
	db.Where("status = 'active' AND end_date < ?", now()).Limit(200).Find(&ended)
	for _, ct := range ended {
		if ct.AutoRenew && ct.StartDate != nil && ct.EndDate.After(*ct.StartDate) {
			term := ct.EndDate.Sub(*ct.StartDate)
			start := *ct.EndDate
			end := start.Add(term)
			db.Model(&Contract{}).Where("id = ?", ct.ID).Updates(map[string]interface{}{"start_date": start, "end_date": end, "expiry_notified_at": nil})
			db.Create(&AuditLog{Base: Base{OrgID: ct.OrgID}, Action: "contract.renewed", EntityType: "contract", EntityID: ct.ID,
				Summary: "Auto-renewed contract " + ct.Name, Details: jsonOf(map[string]time.Time{"new_end_date": end})})
		} else {
			db.Model(&Contract{}).Where("id = ?", ct.ID).Update("status", "expired")
		}
	}
}

// deliverEmail sends queued mail. Rows are claimed with SKIP LOCKED so the
// periodic worker and an immediate kick (or another replica) never send the
// same message twice; failures back off and give up after five attempts.
func (a *App) deliverEmail(db *gorm.DB) {
	mc := a.mailConfig()
	if !mc.Enabled() {
		var batch []EmailOutbox
		db.Where("status = 'queued'").Order("created_at").Limit(200).Find(&batch)
		if len(batch) == 0 {
			return
		}
		ids := make([]string, len(batch))
		for i, e := range batch {
			ids[i] = e.ID
			log.Printf("itsm email (SMTP not configured) to=%s subject=%q", e.ToAddr, e.Subject)
		}
		db.Model(&EmailOutbox{}).Where("id IN ?", ids).Updates(map[string]interface{}{"status": "skipped", "last_error": "SMTP not configured"})
		return
	}
	for round := 0; round < 10; round++ {
		var batch []EmailOutbox
		err := db.Raw(`UPDATE itsm_email_outbox SET status = 'sending', updated_at = now()
			WHERE id IN (SELECT id FROM itsm_email_outbox
				WHERE status = 'queued' AND attempts < 5 AND (attempts = 0 OR updated_at < now() - attempts * interval '2 minutes')
				ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
			RETURNING *`).Scan(&batch).Error
		if err != nil || len(batch) == 0 {
			return
		}
		for _, e := range batch {
			res, err := mc.SendWithResult(mailer.Message{To: e.ToAddr, Subject: e.Subject, Text: e.Body, HTML: e.HTMLBody})
			if err == nil && res.Fallback {
				a.noteSenderFallback(mc, res.From)
			}
			if err != nil {
				status := "queued"
				if e.Attempts+1 >= 5 {
					status = "failed"
				}
				log.Printf("itsm email to=%s failed (attempt %d): %v", e.ToAddr, e.Attempts+1, err)
				db.Model(&EmailOutbox{}).Where("id = ?", e.ID).Updates(map[string]interface{}{"attempts": e.Attempts + 1, "last_error": truncate(err.Error(), 500), "status": status, "updated_at": now()})
				continue
			}
			db.Model(&EmailOutbox{}).Where("id = ?", e.ID).Updates(map[string]interface{}{"status": "sent", "sent_at": now(), "attempts": e.Attempts + 1, "last_error": "", "updated_at": now()})
		}
		if len(batch) < 20 {
			return
		}
	}
}

// kickMail starts delivering queued mail now instead of at the next worker
// tick, so sign-up and reset links arrive within seconds.
func (a *App) kickMail() {
	a.mailAgain.Store(true)
	if !a.mailMu.TryLock() {
		return
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("itsm mail delivery panic: %v", r)
			}
			a.mailMu.Unlock()
			if a.mailAgain.Load() {
				a.kickMail()
			}
		}()
		for a.mailAgain.Swap(false) {
			a.deliverEmail(a.DB)
		}
	}()
}

func (a *App) cleanup(db *gorm.DB) {
	db.Where("entity_type = 'pending' AND created_at < ?", now().Add(-24*time.Hour)).Delete(&Attachment{})
	db.Where("expires_at < ?", now()).Delete(&RefreshSession{})
	db.Where("status IN ('sent','skipped') AND created_at < ?", now().AddDate(0, 0, -90)).Delete(&EmailOutbox{})
	// A delivery interrupted by a restart is retried.
	db.Model(&EmailOutbox{}).Where("status = 'sending' AND updated_at < ?", now().Add(-10*time.Minute)).Update("status", "queued")
	db.Where("created_at < ?", now().AddDate(0, 0, -7)).Delete(&AuthToken{})
}

// noteSenderFallback records (once) that the mail server refused SMTP_FROM and
// mail went out from the signed-in mailbox instead.
func (a *App) noteSenderFallback(mc mailer.Config, used string) {
	from, _ := mc.Sender()
	note := fmt.Sprintf("The mail server does not let %s send as %s, so emails are sent from %s (replies still go to %s). Add %s as an alias of that mailbox, or set SMTP_FROM to it.",
		mc.User, from.Address, used, from.Address, from.Address)
	if prev, _ := a.mailNote.Load().(string); prev != note {
		log.Printf("itsm email: %s", note)
		a.mailNote.Store(note)
	}
}
