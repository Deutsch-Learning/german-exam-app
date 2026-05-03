import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import NotFoundPage from "./NotFoundPage";

const questions = [
  {
    id: "q1",
    prompt: "Which German article is used with 'Universitaet'?",
    options: ["der", "die", "das"],
    correct: "die",
  },
  {
    id: "q2",
    prompt: "Choose the best meaning of 'Bewerbung'.",
    options: ["application", "library", "timetable"],
    correct: "application",
  },
  {
    id: "q3",
    prompt: "Which phrase is a formal greeting?",
    options: ["Hallo Tom", "Sehr geehrte Damen und Herren", "Bis spaeter"],
    correct: "Sehr geehrte Damen und Herren",
  },
];

export default function FreeTestPage() {
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
        title="404 error"
        message="This free visitor test is not safeguarded. Return to Home and open the free series again."
      />
    );
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
          <p className="simple-eyebrow">Visitor free test</p>
          <h1>{seriesId} practice</h1>
          <p>
            You can take this free test without creating an account. Your answers are not
            saved, and a page reload will return a 404 error because visitor progress is
            not safeguarded.
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
                Score: {score}/{questions.length}. Create an account to save future
                preparation results.
              </p>
            ) : null}

            <div className="simple-actions">
              <button className="simple-button" type="submit">
                Submit free test
              </button>
              <Link className="simple-secondary-button" to="/register">
                Create an account
              </Link>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
