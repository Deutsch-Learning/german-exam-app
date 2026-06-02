import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import NotFoundPage from "./NotFoundPage";
import { useTestProtection } from "../utils/testProtection";
import { useSimulationLanguage } from "../utils/simulationLanguage";

const questions = [
  {
    id: "q1",
    prompt: "Welcher deutsche Artikel gehoert zu 'Universitaet'?",
    options: ["der", "die", "das"],
    correct: "die",
  },
  {
    id: "q2",
    prompt: "Waehlen Sie die beste Bedeutung von 'Bewerbung'.",
    options: ["Bewerbung", "Bibliothek", "Stundenplan"],
    correct: "Bewerbung",
  },
  {
    id: "q3",
    prompt: "Welche Formulierung ist eine formelle Begruessung?",
    options: ["Hallo Tom", "Sehr geehrte Damen und Herren", "Bis spaeter"],
    correct: "Sehr geehrte Damen und Herren",
  },
];

export default function FreeTestPage() {
  useTestProtection();
  useSimulationLanguage();
  const { state } = useLocation();
  const { seriesId } = useParams();
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const allowed = Boolean(state?.visitorFreeAccess);

  const score = useMemo(
    () =>
      questions.reduce(
        (total, question) => total + (answers[question.id] === question.correct ? 1 : 0),
        0
      ),
    [answers]
  );

  if (!allowed) {
    return (
      <NotFoundPage
        title="404-Fehler"
        message="Dieser kostenlose Besuchertest ist nicht abgesichert. Kehren Sie zur Startseite zurueck und oeffnen Sie die kostenlose Serie erneut."
      />
    );
  }

  return (
    <div className="simple-page notranslate" translate="no">
      <main className="simple-shell">
        <div className="simple-topbar">
          <Link className="simple-logo" to="/">
            <img src={logo} alt="" />
            Deutsch Learning
          </Link>
          <Link className="simple-home-link" to="/">
            Startseite
          </Link>
        </div>

        <header className="simple-hero">
          <p className="simple-eyebrow">Kostenloser Besuchertest</p>
          <h1>{seriesId} Uebung</h1>
          <p>
            Sie koennen diesen kostenlosen Test ohne Konto bearbeiten. Ihre Antworten werden nicht
            gespeichert. Nach dem Neuladen erscheint ein 404-Fehler, weil Besucherfortschritt
            nicht abgesichert ist.
          </p>
        </header>

        <section className="simple-card">
          <form
            className="free-test-form"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitted(true);
            }}
          >
            {questions.map((question, index) => (
              <div className="free-question" key={question.id}>
                <strong>
                  {index + 1}. {question.prompt}
                </strong>
                {question.options.map((option) => (
                  <label key={option}>
                    <input
                      type="radio"
                      name={question.id}
                      value={option}
                      checked={answers[question.id] === option}
                      onChange={() =>
                        setAnswers((previous) => ({ ...previous, [question.id]: option }))
                      }
                    />
                    {option}
                  </label>
                ))}
              </div>
            ))}

            {submitted ? (
              <p>
                Punktzahl: {score}/{questions.length}. Erstellen Sie ein Konto, um kuenftige
                Vorbereitungsergebnisse zu speichern.
              </p>
            ) : null}

            <div className="simple-actions">
              <button className="simple-button" type="submit">
                Kostenlosen Test abgeben
              </button>
              <Link className="simple-secondary-button" to="/register">
                Konto erstellen
              </Link>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
