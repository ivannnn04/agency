import type { Metadata } from 'next'
import LegalPage, { LEGAL_CONTACT, LegalSection } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy — Gudrix',
  description: 'How Gudrix collects, uses and protects personal data in the Gudrix client workspace.',
}

const mail = <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>

const sections: LegalSection[] = [
  {
    title: 'Who we are',
    body: <>
      <p>Gudrix is a design agency. This policy covers the Gudrix client workspace (the “workspace”) — the online area where our clients follow their projects, talk to the team, and view tasks, timelines, notes and invoices.</p>
      <p>Gudrix is the controller of the personal data described here. For any privacy question, write to {mail}.</p>
    </>,
  },
  {
    title: 'What we collect',
    body: <>
      <ul>
        <li><strong>Account details</strong> — your name, email address and a password. Passwords are stored only in hashed form by our authentication provider; we never see them.</li>
        <li><strong>Google sign-in</strong> — if you choose “Sign in with Google”, we receive your name, email address and profile picture from Google. We do not get access to your Gmail, Drive, contacts or any other Google data.</li>
        <li><strong>Project content</strong> — messages, notes, tasks, change requests and files you or our team add to a project.</li>
        <li><strong>Commercial records</strong> — invoices, their amounts and payment status for your projects. We do not collect or store card or bank details in the workspace.</li>
        <li><strong>Communication records</strong> — emails exchanged with us about a project and, where a call is recorded with the participants’ knowledge, its notes and transcript.</li>
        <li><strong>Technical data</strong> — basic logs such as IP address, browser type and time of access, kept for security and troubleshooting.</li>
      </ul>
    </>,
  },
  {
    title: 'How we use it',
    body: <>
      <ul>
        <li>to sign you in and show you only the projects you were invited to;</li>
        <li>to deliver the project: plan work, exchange feedback and files, and keep a shared history;</li>
        <li>to issue invoices and keep accounting records;</li>
        <li>to send service messages such as invitations, replies and notifications about your project;</li>
        <li>to keep the workspace secure and working.</li>
      </ul>
      <p>We rely on our contract with you, our legitimate interest in running projects well, and legal obligations (for example, keeping accounting records). We do not sell personal data and do not use it for advertising.</p>
    </>,
  },
  {
    title: 'AI-assisted features',
    body: <>
      <p>Our team uses AI tools to summarise calls and correspondence and to prepare project overviews. For this, relevant project content may be processed by our AI providers on our behalf. They process it only to return the result to us and, under their terms for business customers, do not use it to train their models.</p>
    </>,
  },
  {
    title: 'Who we share it with',
    body: <>
      <p>Only with service providers that help us run the workspace, each bound by a data-processing agreement:</p>
      <ul>
        <li>Supabase — database, authentication and file storage;</li>
        <li>Vercel — hosting;</li>
        <li>Google — sign-in, if you choose it;</li>
        <li>Anthropic and OpenAI — AI processing of text and transcription;</li>
        <li>Fellow — meeting notes and call recordings;</li>
        <li>our email provider — sending and receiving project emails.</li>
      </ul>
      <p>We may also disclose data when the law requires it. Some providers are located outside your country; where required, transfers are covered by standard contractual clauses or an equivalent safeguard.</p>
    </>,
  },
  {
    title: 'Cookies and local storage',
    body: <>
      <p>The workspace uses only what is necessary to work: a sign-in session and your interface preferences such as theme and language. We do not use advertising or third-party analytics cookies.</p>
    </>,
  },
  {
    title: 'How long we keep it',
    body: <>
      <p>We keep project content for the duration of our work together and for a reasonable period afterwards so the history stays available to you. Accounting records are kept for as long as the law requires. You can ask us to delete your account and project content at any time; we will do so unless we are legally required to keep specific records.</p>
    </>,
  },
  {
    title: 'Security',
    body: <>
      <p>Data is encrypted in transit, access to each project is limited to invited people and our team, and passwords are stored hashed. No system is perfectly secure, so if you suspect unauthorised access to your account, tell us right away at {mail}.</p>
    </>,
  },
  {
    title: 'Your rights',
    body: <>
      <p>Depending on where you live, you may have the right to access, correct, delete or export your personal data, to object to or restrict its processing, and to complain to your data-protection authority. To use any of these rights, write to {mail} — we answer within 30 days.</p>
    </>,
  },
  {
    title: 'Children',
    body: <p>The workspace is intended for business clients and is not directed at children under 16.</p>,
  },
  {
    title: 'Changes to this policy',
    body: <p>If we change this policy in a meaningful way, we will update the date above and let active clients know by email or in the workspace.</p>,
  },
]

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={<p>This policy explains what personal data Gudrix collects when you use the client workspace, why, and what choices you have.</p>}
      sections={sections}
    />
  )
}
