import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { LEGAL_CONTACT, LegalSection } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service — Gudrix',
  description: 'Terms for using the Gudrix client workspace.',
}

const mail = <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>

const sections: LegalSection[] = [
  {
    title: 'What these terms cover',
    body: <>
      <p>These terms apply to the Gudrix client workspace (the “workspace”) — the online area where clients of Gudrix follow their projects, talk to the team, and view tasks, timelines, notes and invoices.</p>
      <p>The work itself — scope, price, deadlines, ownership of deliverables — is governed by your agreement or accepted proposal with Gudrix (the “service agreement”). If these terms and the service agreement conflict, the service agreement prevails.</p>
    </>,
  },
  {
    title: 'Your account',
    body: <>
      <ul>
        <li>Access is by invitation. You sign in with the email address we invited, using a password or Google sign-in.</li>
        <li>Keep your sign-in details private and tell us if you think someone else has used your account.</li>
        <li>If several people from your company need access, ask us to invite each of them rather than sharing one account.</li>
      </ul>
    </>,
  },
  {
    title: 'Acceptable use',
    body: <>
      <p>Use the workspace for your projects with Gudrix. Please do not:</p>
      <ul>
        <li>upload anything unlawful, malicious, or that you have no right to share;</li>
        <li>try to access projects or data that are not yours;</li>
        <li>disrupt, probe or reverse-engineer the workspace, or access it with automated tools.</li>
      </ul>
    </>,
  },
  {
    title: 'Your content',
    body: <>
      <p>Files, messages and other materials you add remain yours. You give Gudrix permission to store and use them to deliver your project. Rights to the work we produce for you are set out in the service agreement.</p>
    </>,
  },
  {
    title: 'Tasks, timelines and change requests',
    body: <>
      <p>Progress figures, deadlines and roadmaps in the workspace reflect our current plan and may change as the project moves. Tasks and change requests you submit are requests: we review them and confirm what is included in the agreed scope, and anything outside it is agreed separately.</p>
    </>,
  },
  {
    title: 'Invoices',
    body: <>
      <p>Invoices are shown in the workspace for your convenience. Payment terms, amounts and due dates are those in the invoice itself and the service agreement. The workspace does not process payments.</p>
    </>,
  },
  {
    title: 'AI-assisted features',
    body: <>
      <p>Some summaries and overviews are prepared with AI tools and reviewed by our team. They are working aids and can contain mistakes; decisions and commitments are those we confirm to you directly.</p>
    </>,
  },
  {
    title: 'Confidentiality',
    body: <>
      <p>We treat everything in your projects as confidential and show it only to the people working on them. Likewise, please keep our working materials, pricing and internal discussions confidential. Any confidentiality terms in the service agreement apply in addition.</p>
    </>,
  },
  {
    title: 'Availability',
    body: <>
      <p>We work to keep the workspace available but do not guarantee uninterrupted access. We may update, change or temporarily suspend it for maintenance or security. Keep your own copies of files that matter to you.</p>
    </>,
  },
  {
    title: 'Ending access',
    body: <>
      <p>You can stop using the workspace at any time and ask us to close your account. We may suspend or close access when a project ends, or if these terms are seriously breached. On request, we will provide a copy of your project files before closing.</p>
    </>,
  },
  {
    title: 'Liability',
    body: <>
      <p>The workspace is provided “as is”. To the extent the law allows, Gudrix is not liable for indirect or consequential losses arising from use of the workspace, such as loss of profit or data. Nothing here limits liability that cannot be limited by law, or the liability terms of the service agreement for the work itself.</p>
    </>,
  },
  {
    title: 'Privacy',
    body: <p>How we handle personal data is described in our <Link href="/privacy">Privacy Policy</Link>.</p>,
  },
  {
    title: 'Changes and contact',
    body: <>
      <p>We may update these terms; the date above shows the latest version, and we will let active clients know about meaningful changes. Continuing to use the workspace after a change means you accept the updated terms.</p>
      <p>Questions: {mail}.</p>
    </>,
  },
]

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={<p>The rules for using the Gudrix client workspace. They are short on purpose: the details of our work together live in your service agreement.</p>}
      sections={sections}
    />
  )
}
