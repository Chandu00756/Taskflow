package mailer

import (
	"os"
	"strings"
)

// disposableDomains are throwaway-inbox providers. Sign-ups from them are
// refused, and existing accounts on them are flagged as suspicious. Extra
// domains can be added with DISPOSABLE_EMAIL_DOMAINS (comma separated).
var disposableDomains = map[string]bool{}

func init() {
	for _, d := range strings.Fields(`
10minutemail.com 10minutemail.net 10minmail.com 20minutemail.com 33mail.com
anonaddy.me anonbox.net armyspy.com burnermail.io byom.de
chacuo.net cuvox.de dayrep.com deadaddress.com discard.email discardmail.com
dispostable.com dropmail.me einrot.com emailondeck.com emailfake.com
emailtemporanea.net fakeinbox.com fakemail.net fakemailgenerator.com
fleckens.hu getairmail.com getnada.com gufum.com guerrillamail.biz
guerrillamail.com guerrillamail.de guerrillamail.info guerrillamail.net
guerrillamail.org guerrillamailblock.com gustr.com harakirimail.com
inboxbear.com incognitomail.org jetable.org jourrapide.com
mail-temp.com mail.tm mailcatch.com maildrop.cc mailinator.com mailinator.net
mailinator2.com mailnesia.com mailpoof.com mailsac.com mailtemp.info
mintemail.com moakt.com mohmal.com mytemp.email mytrashmail.com
nada.email nwytg.net objectmail.com owlymail.com proxymail.eu
rhyta.com rootfest.net sharklasers.com spam4.me spamgourmet.com
spambox.us spamdecoy.net superrito.com teleworm.us temp-mail.io
temp-mail.org tempail.com tempinbox.com tempmail.com tempmail.dev
tempmail.net tempmail.plus tempmailo.com tempr.email throwawaymail.com
tmail.ws tmailor.com tmpmail.net tmpmail.org trash-mail.com trashmail.com
trashmail.de trashmail.io trashmail.me trashmail.net wegwerfmail.de
wegwerfmail.net yopmail.com yopmail.fr yopmail.net zetmail.com
1secmail.com 1secmail.net 1secmail.org emltmp.com dcctb.com laafd.com
txcct.com vjuum.com kzccv.com qiott.com bheps.com cyclelove.cc
`) {
		disposableDomains[d] = true
	}
	for _, d := range strings.Split(os.Getenv("DISPOSABLE_EMAIL_DOMAINS"), ",") {
		if d = strings.ToLower(strings.TrimSpace(d)); d != "" {
			disposableDomains[d] = true
		}
	}
}

// IsDisposableDomain reports whether domain (or a parent of it) is a known
// throwaway-inbox provider.
func IsDisposableDomain(domain string) bool {
	d := strings.ToLower(strings.TrimSpace(domain))
	for d != "" {
		if disposableDomains[d] {
			return true
		}
		i := strings.Index(d, ".")
		if i < 0 {
			return false
		}
		d = d[i+1:]
	}
	return false
}
