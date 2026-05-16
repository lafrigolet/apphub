// View shell for the email-domains feature. The actual logic lives in
// EmailDomainsManager (shared with console). The tenant console
// always operates on the user's own tenant — no `scopeQuery` impersonation
// path here.
import EmailDomainsManager from '../../../components/EmailDomainsManager'

export default function EmailDomainsView() {
  return <EmailDomainsManager scopeQuery="" canSuspend={false} compact={false} />
}
