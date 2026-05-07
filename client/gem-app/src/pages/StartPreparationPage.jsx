import { Link } from "react-router-dom";
import { CheckCircle2, Lock } from "lucide-react";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";

const series = [
  {
    id: "testdaf-free",
    title: "TestDaF free starter series",
    description: "A short visitor-friendly test with no saved progress.",
    isFree: true,
  },
  {
    id: "dsh-free",
    title: "DSH free starter series",
    description: "Try a compact DSH-style practice set before creating an account.",
    isFree: true,
  },
  {
    id: "goethe-full",
    title: "Goethe full exam series",
    description: "Complete written, oral, listening, and reading test conditions.",
    isFree: false,
  },
  {
    id: "telc-full",
    title: "telc Deutsch full exam series",
    description: "Full telc-style preparation with correction and progress tracking.",
    isFree: false,
  },
];

export default function StartPreparationPage() {
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
          <p className="simple-eyebrow">Start preparation</p>
          <h1>Complete test series</h1>
          <p>
            Free series can be opened as a visitor. Paid series stay locked until an
            offer is selected from the offers page.
          </p>
        </header>

        <section className="simple-grid two">
          {series.map((item) => (
            <article className="simple-card" key={item.id}>
              <div className="series-card-header">
                <h2>{item.title}</h2>
                <span className={`series-badge ${item.isFree ? "" : "locked"}`}>
                  {item.isFree ? <CheckCircle2 size={15} /> : <Lock size={15} />}
                  {item.isFree ? "Free" : "Locked"}
                </span>
              </div>
              <p>{item.description}</p>
              <div className="simple-actions">
                {item.isFree ? (
                  <Link
                    className="simple-button"
                    to={`/free-test/${item.id}`}
                    state={{ visitorFreeAccess: true }}
                  >
                    Open free series
                  </Link>
                ) : (
                  <>
                    <button className="simple-button simple-muted-button" type="button" disabled>
                      <Lock size={16} />
                      Locked
                    </button>
                    <Link className="simple-secondary-button" to="/offers">
                      View offers
                    </Link>
                  </>
                )}
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
