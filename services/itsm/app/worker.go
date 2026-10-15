package app

import (
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"

	"github.com/google/uuid"
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

// sanitizeHeader strips characters that could inject extra headers.
func sanitizeHeader(s string) string {
	return strings.NewReplacer("\r", " ", "\n", " ").Replace(s)
}

func (a *App) deliverEmail(db *gorm.DB) {
	var batch []EmailOutbox
	db.Where("status = 'queued' AND attempts < 5").Order("created_at").Limit(50).Find(&batch)
	if len(batch) == 0 {
		return
	}
	if a.Cfg.SMTPHost == "" {
		ids := make([]string, len(batch))
		for i, e := range batch {
			ids[i] = e.ID
			log.Printf("itsm email (SMTP not configured) to=%s subject=%q", e.ToAddr, e.Subject)
		}
		db.Model(&EmailOutbox{}).Where("id IN ?", ids).Updates(map[string]interface{}{"status": "skipped", "last_error": "SMTP not configured"})
		return
	}
	for _, e := range batch {
		err := a.sendSMTP(e.ToAddr, e.Subject, e.Body)
		if err != nil {
			status := "queued"
			if e.Attempts+1 >= 5 {
				status = "failed"
			}
			db.Model(&EmailOutbox{}).Where("id = ?", e.ID).Updates(map[string]interface{}{"attempts": e.Attempts + 1, "last_error": truncate(err.Error(), 500), "status": status})
			continue
		}
		db.Model(&EmailOutbox{}).Where("id = ?", e.ID).Updates(map[string]interface{}{"status": "sent", "sent_at": now(), "attempts": e.Attempts + 1, "last_error": ""})
	}
}

func (a *App) sendSMTP(to, subject, body string) error {
	from := a.Cfg.SMTPFrom
	if from == "" {
		from = a.Cfg.SMTPUser
	}
	host := a.Cfg.SMTPHost
	addr := net.JoinHostPort(host, a.Cfg.SMTPPort)
	msg := strings.Join([]string{
		"From: " + sanitizeHeader(from),
		"To: " + sanitizeHeader(to),
		"Subject: " + mime.QEncoding.Encode("utf-8", sanitizeHeader(subject)),
		"Date: " + time.Now().Format(time.RFC1123Z),
		"Message-ID: <" + uuid.NewString() + "@" + host + ">",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"", strings.ReplaceAll(body, "\n", "\r\n"),
	}, "\r\n")
	var auth smtp.Auth
	if a.Cfg.SMTPUser != "" {
		auth = smtp.PlainAuth("", a.Cfg.SMTPUser, a.Cfg.SMTPPass, host)
	}
	if a.Cfg.SMTPPort == "465" {
		conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 15 * time.Second}, "tcp", addr, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
		if err != nil {
			return err
		}
		c, err := smtp.NewClient(conn, host)
		if err != nil {
			return err
		}
		defer c.Close()
		if auth != nil {
			if err := c.Auth(auth); err != nil {
				return err
			}
		}
		if err := c.Mail(from); err != nil {
			return err
		}
		if err := c.Rcpt(to); err != nil {
			return err
		}
		w, err := c.Data()
		if err != nil {
			return err
		}
		if _, err := w.Write([]byte(msg)); err != nil {
			return err
		}
		if err := w.Close(); err != nil {
			return err
		}
		return c.Quit()
	}
	// smtp.SendMail upgrades to STARTTLS when the server offers it.
	return smtp.SendMail(addr, auth, from, []string{to}, []byte(msg))
}

func (a *App) cleanup(db *gorm.DB) {
	db.Where("entity_type = 'pending' AND created_at < ?", now().Add(-24*time.Hour)).Delete(&Attachment{})
	db.Where("expires_at < ?", now()).Delete(&RefreshSession{})
	db.Where("status IN ('sent','skipped') AND created_at < ?", now().AddDate(0, 0, -90)).Delete(&EmailOutbox{})
}
