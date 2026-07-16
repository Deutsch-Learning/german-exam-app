import { Link } from "react-router-dom";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import { SUPPORT_EMAIL } from "../config/support";

const updatedAt = "16 July 2026";

const content = {
  faq: {
    eyebrow: "FAQ",
    title: "FAQ",
    subtitle: "We answer all your questions.",
    sections: [
      {
        title: "Can I start without an account?",
        text: "Yes. Free visitor tests are available, but progress is not saved unless you create an account.",
      },
      {
        title: "Which exams can I practice?",
        text: "You can prepare for TestDaF, DSH, Goethe Certificate, and telc Deutsch simulations.",
      },
      {
        title: "Do paid offers unlock all modules?",
        text: "Paid plans unlock more complete series, correction features, and tracking depending on the selected offer.",
      },
    ],
  },
  privacy: {
    eyebrow: "Privacy",
    title: "Privacy Policy",
    subtitle:
      "This page explains what Deutsch Pruefungen collects, why it is needed, and how users can control their information.",
    sections: [
      {
        title: "1. Scope of this policy",
        text:
          "Deutsch Pruefungen is an online German exam preparation platform. The service offers account creation, Google sign-in, practice simulations, progress tracking, writing and speaking correction, audio tools, subscriptions, support, and learning recommendations.",
      },
      {
        title: "2. Information we collect",
        bullets: [
          "Account information: name, username, email address, country, phone number, password hash for email-password accounts, profile settings, language preferences, and marketing email preference.",
          "Google sign-in information: verified email address, Google account identifier, name, and profile image when you choose Continue with Google.",
          "Learning data: selected exams, answers, scores, progress, completed and unfinished simulations, correction history, and activity timestamps.",
          "Speaking and writing submissions: typed responses, audio recordings, transcripts, AI correction records, and diagnostic feedback when you use those features.",
          "Payment and access data: purchased offers, subscription/access status, payment references, invoices or checkout status returned by payment providers.",
          "Technical data: IP address, device/browser details, cookies or session tokens, security logs, error logs, and approximate usage events needed to operate and protect the service.",
        ],
      },
      {
        title: "3. Why we use the data",
        bullets: [
          "To create and secure your account, keep you logged in, verify email addresses, recover accounts, and prevent duplicate or abusive accounts.",
          "To save your answers, exam progress, scores, corrections, and learning history.",
          "To provide AI-assisted writing and speaking feedback, including transcription and structured evaluation where enabled.",
          "To manage purchases, subscriptions, access rights, customer support, refunds, and service communications.",
          "To improve the reliability, security, accessibility, and quality of the exam preparation experience.",
          "To send optional learning tips, product updates, or offers only when you opt in; security and account emails may still be sent when necessary.",
        ],
      },
      {
        title: "4. Google authentication",
        text:
          "If you sign in with Google, we request only the basic identity permissions needed for authentication: openid, email, and profile. We do not request Gmail, Drive, Calendar, contacts, or advertising permissions. Google data is used to create or recover your Deutsch Pruefungen account and to prevent duplicate accounts with the same verified email.",
      },
      {
        title: "5. AI correction and exam content",
        text:
          "Speaking recordings, transcripts, written responses, and correction data may be processed by secure AI service providers only to provide the correction feature you requested. AI feedback is a learning aid and does not replace an official Goethe, telc, OeSD, ECL, TestDaF, or DSH exam result.",
      },
      {
        title: "6. Cookies and session storage",
        text:
          "The app uses authentication cookies, access tokens, local storage, and similar browser storage to keep users signed in, restore sessions after refresh, protect protected pages, and remember learning state. These are necessary for the service to function.",
      },
      {
        title: "7. Sharing and service providers",
        text:
          "We do not sell personal data. Data may be shared with trusted service providers only where needed to run the app, such as hosting, database, email delivery, payment processing, Google authentication, analytics/security tooling, and AI correction providers. Providers must process data for the service purpose, security, legal compliance, or support.",
      },
      {
        title: "8. Retention",
        text:
          "Account data is kept while your account is active. Learning progress and correction history are kept so you can review your preparation. Security logs and payment records may be kept for legal, fraud-prevention, accounting, and platform security reasons. You can request deletion where applicable, subject to legal or payment-record obligations.",
      },
      {
        title: "9. Your rights and choices",
        bullets: [
          "You can review and update your profile from the Profile page.",
          "You can unsubscribe from marketing emails or disable marketing emails in your profile.",
          "You can request access, correction, deletion, restriction, or portability of your personal data where applicable.",
          "You can ask questions about how your data is processed or object to certain processing where applicable.",
        ],
      },
      {
        title: "10. Contact",
        text: `For privacy questions or data requests, contact ${SUPPORT_EMAIL}. Please use the email address linked to your account so we can verify the request safely.`,
      },
    ],
  },
  terms: {
    eyebrow: "Terms",
    title: "Terms of Service",
    subtitle:
      "These terms explain how Deutsch Pruefungen may be used, what the platform provides, and the responsibilities of each user.",
    sections: [
      {
        title: "1. Service scope",
        text:
          "Deutsch Pruefungen provides online preparation tools for German language exams, including practice simulations, reading, listening, writing, speaking, progress tracking, AI-assisted corrections, audio tools, and learning resources. The platform is a preparation service, not an official exam provider.",
      },
      {
        title: "2. No official certification",
        text:
          "Scores, feedback, AI evaluations, recommendations, and practice results are educational estimates. They do not guarantee admission, visa approval, official certification, or a passing score in any Goethe, telc, OeSD, ECL, TestDaF, DSH, university, embassy, or government process.",
      },
      {
        title: "3. Account responsibilities",
        bullets: [
          "You must provide accurate registration information and keep your account secure.",
          "You are responsible for activity under your account unless unauthorized access is reported promptly.",
          "You must not share paid access, resell accounts, bypass access controls, or create duplicate abusive accounts.",
          "You must not upload unlawful, harmful, abusive, or privacy-infringing content.",
        ],
      },
      {
        title: "4. Acceptable use",
        text:
          "You may use the platform for personal exam preparation and learning. You may not scrape, copy, redistribute, reverse engineer, attack, overload, or interfere with the platform, its exam banks, audio, corrections, or security systems.",
      },
      {
        title: "5. AI feedback and recordings",
        text:
          "When you submit speaking recordings or written answers, you authorize the platform to process them to provide transcription, correction, scoring estimates, diagnostics, and learning recommendations. You should not submit sensitive personal information in practice answers unless it is necessary for the exercise.",
      },
      {
        title: "6. Paid access and refunds",
        text:
          "Some features may require paid access. Prices, included modules, access duration, and correction availability are shown during purchase. Refunds are reviewed according to the refund conditions, payment status, duplicate payment evidence, access history, and whether paid correction or premium content has already been used.",
      },
      {
        title: "7. Intellectual property",
        text:
          "The platform interface, learning structure, explanations, correction format, audio, generated training material, and proprietary exam preparation content belong to Deutsch Pruefungen or its licensors. Official exam names are used descriptively to identify preparation targets and do not imply endorsement.",
      },
      {
        title: "8. Availability and changes",
        text:
          "The service may change as new exam series, corrections, models, providers, payment rules, or technical improvements are added. We aim to keep the platform available, but maintenance, outages, provider limits, payment issues, or network problems may temporarily affect access.",
      },
      {
        title: "9. Suspension or termination",
        text:
          "Accounts may be limited, suspended, or terminated if they are used for abuse, fraud, unauthorized sharing, security attacks, payment misuse, repeated policy violations, or unlawful activity.",
      },
      {
        title: "10. Contact",
        text: `For support, account questions, or terms questions, contact ${SUPPORT_EMAIL}.`,
      },
    ],
  },
  refund: {
    eyebrow: "Refund",
    title: "Refund condition",
    subtitle: "Find out how and to what extent you can be reimbursed.",
    sections: [
      {
        title: "Eligibility",
        text: "Refunds can be reviewed when a paid service cannot be accessed or a duplicate payment was made.",
      },
      {
        title: "Limits",
        text: "Completed simulations, correction usage, and long account activity may reduce the reimbursable amount.",
      },
      {
        title: "Request process",
        text: "Contact support with your account email, payment reference, and the offer you purchased.",
      },
    ],
  },
};

export default function InfoPage({ type }) {
  const page = content[type] ?? content.faq;

  return (
    <div className="simple-page">
      <main className="simple-shell">
        <div className="simple-topbar">
          <Link className="simple-logo" to="/">
            <img src={logo} alt="" />
            Deutsch Prüfungen
          </Link>
          <Link className="simple-home-link" to="/">
            Home
          </Link>
        </div>

        <header className="simple-hero">
          <p className="simple-eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
          <p>{page.subtitle}</p>
          {type === "privacy" || type === "terms" ? (
            <p className="legal-updated">Last updated: {updatedAt}</p>
          ) : null}
        </header>

        <section className={type === "privacy" || type === "terms" ? "legal-stack" : "simple-grid three"}>
          {page.sections.map((section) => (
            <article className={type === "privacy" || type === "terms" ? "simple-card legal-card" : "simple-card"} key={section.title}>
              <h2>{section.title}</h2>
              {section.text ? <p>{section.text}</p> : null}
              {section.bullets ? (
                <ul>
                  {section.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </section>
        {type === "privacy" || type === "terms" ? (
          <div className="simple-actions legal-actions">
            <Link className="simple-button" to="/register">
              Create an account
            </Link>
            <Link className="simple-secondary-button" to="/contact">
              Contact support
            </Link>
          </div>
        ) : null}
      </main>
    </div>
  );
}
