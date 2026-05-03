import { Link, useParams } from "react-router-dom";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import NotFoundPage from "./NotFoundPage";

const topics = {
  testdaf: {
    title: "TestDaF (Test Deutsch als Fremdsprache)",
    subtitle: "A standardized German exam for international students applying to German-speaking universities.",
    highlights: [
      "Assesses reading, listening, writing, and speaking.",
      "Results are reported by skill area.",
      "Useful for university admission and academic preparation.",
    ],
  },
  dsh: {
    title: "DSH (Deutsche Sprachpr\u00fcfung f\u00fcr den Hochschulzugang)",
    subtitle: "A university-based German language exam used for admission to German higher education.",
    highlights: [
      "Organized by individual universities or approved centers.",
      "Usually focused on academic German.",
      "Accepted requirements vary by university and program.",
    ],
  },
  "goethe-certificate": {
    title: "Goethe Certificate",
    subtitle: "Internationally recognized Goethe-Institut certificates for German language levels.",
    highlights: [
      "Available from beginner to advanced levels.",
      "Widely recognized by schools, employers, and institutions.",
      "Covers practical communication and formal language skills.",
    ],
  },
  "telc-deutsch": {
    title: "telc Deutsch",
    subtitle: "A recognized German certificate series for study, work, and migration goals.",
    highlights: [
      "Covers several CEFR levels and exam formats.",
      "Often used for professional and academic pathways.",
      "Includes realistic language tasks for everyday and formal contexts.",
    ],
  },
};

export default function TopicPage() {
  const { topicId } = useParams();
  const topic = topics[topicId];

  if (!topic) {
    return <NotFoundPage message="The topic you opened is not available." />;
  }

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
          <p className="simple-eyebrow">Current topic</p>
          <h1>{topic.title}</h1>
          <p>{topic.subtitle}</p>
        </header>

        <section className="simple-grid two">
          <article className="simple-card">
            <h2>What to know</h2>
            <ul>
              {topic.highlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <article className="simple-card">
            <h2>Start practicing</h2>
            <p>
              Choose the simulation path for this exam and train with realistic tasks before
              moving into full test conditions.
            </p>
            <div className="simple-actions">
              <Link className="simple-button" to="/start-preparation">
                Start preparation
              </Link>
              <Link className="simple-secondary-button" to="/offers">
                View offers
              </Link>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
