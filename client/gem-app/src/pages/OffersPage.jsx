import { Link, useNavigate } from "react-router-dom";
import { CreditCard } from "lucide-react";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import { offerPlans } from "../data/siteContent";

const getAuthUser = () => {
  try {
    return JSON.parse(localStorage.getItem("auth") ?? "null");
  } catch {
    return null;
  }
};

export default function OffersPage() {
  const navigate = useNavigate();

  const openOffer = (offerId) => {
    const user = getAuthUser();
    if (!user?.id) {
      navigate("/session-expired", { state: { offerId } });
      return;
    }
    navigate(`/checkout/${offerId}`);
  };

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
          <p className="simple-eyebrow">Offers</p>
          <h1>Choose your preparation offer</h1>
          <p>
            Select an offer to unlock test series, correction, and tracking for your exam
            preparation.
          </p>
        </header>

        <section className="simple-grid three">
          {offerPlans.map((offer) => (
            <article className="simple-card offer-card" key={offer.id}>
              <div>
                <h2>{offer.name}</h2>
                <div className="offer-price">{offer.price}</div>
                <p>{offer.description}</p>
              </div>
              <ul>
                {offer.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <button className="simple-button" type="button" onClick={() => openOffer(offer.id)}>
                <CreditCard size={18} />
                Select offer
              </button>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
