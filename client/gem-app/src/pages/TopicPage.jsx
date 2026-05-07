import { Link, useParams } from "react-router-dom";
import { AlertTriangle, Info } from "lucide-react";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import NotFoundPage from "./NotFoundPage";
import { currentTopics } from "../data/siteContent";

const topicCopy = {
  testdaf: {
    title: "TestDaF (Test Deutsch als Fremdsprache)",
    subtitle: "Sujets actuels pour les candidats visant une admission universitaire.",
  },
  dsh: {
    title: "DSH (Deutsche Sprachprüfung für den Hochschulzugang)",
    subtitle: "Sujets orientés université, synthèse écrite et réponse orale.",
  },
  "goethe-certificate": {
    title: "Goethe Certificate",
    subtitle: "Sujets actuels pour une communication écrite et orale claire.",
  },
  "telc-deutsch": {
    title: "telc Deutsch",
    subtitle: "Sujets pratiques pour le travail, l'intégration et les services publics.",
  },
};

export default function TopicPage() {
  const { topicId } = useParams();
  const topic = currentTopics.find((item) => item.id === topicId);
  const copy = topicCopy[topicId];

  if (!topic || !copy) {
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
          <p className="simple-eyebrow">Sujet actuel</p>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </header>

        <section className="topic-detail-panel">
          <div className="topic-detail-header">
            <div>
              <span className="simple-eyebrow">Series title</span>
              <h2>{topic.seriesTitle}</h2>
            </div>
            <span className="topic-expression-badge">{topic.expressionType}</span>
          </div>

          <div className="topic-notice-grid">
            <div className="topic-notice info">
              <Info size={18} />
              <span>{topic.notice}</span>
            </div>
            <div className="topic-notice warning">
              <AlertTriangle size={18} />
              <span>{topic.warning}</span>
            </div>
          </div>

          <div className="topic-task-panel">
            <h3>Tasks</h3>
            <div className="topic-task-list">
              {topic.tasks.map((task, index) => (
                <article className="topic-task-card" key={task}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{task}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="simple-actions">
            <Link className="simple-button" to="/simulations">
              Choisir un test
            </Link>
            <Link className="simple-secondary-button" to="/offers">
              View offers
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
