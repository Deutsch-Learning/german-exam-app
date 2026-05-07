import { Link } from "react-router-dom";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";

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
    title: "Privacy policy",
    subtitle: "Find out how we handle your personal information.",
    sections: [
      {
        title: "Information we collect",
        text: "We collect account details, learning activity, and contact information needed to provide the platform.",
      },
      {
        title: "How we use it",
        text: "We use information to save progress, improve preparation recommendations, and support your account.",
      },
      {
        title: "Your control",
        text: "You can contact support to request updates, corrections, or deletion of personal data linked to your account.",
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
            Deutsch Learning
          </Link>
          <Link className="simple-home-link" to="/">
            Home
          </Link>
        </div>

        <header className="simple-hero">
          <p className="simple-eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
          <p>{page.subtitle}</p>
        </header>

        <section className="simple-grid three">
          {page.sections.map((section) => (
            <article className="simple-card" key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.text}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
