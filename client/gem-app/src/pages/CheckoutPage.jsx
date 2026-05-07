import { Link, Navigate, useParams } from "react-router-dom";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import { offerPlans } from "../data/siteContent";
import NotFoundPage from "./NotFoundPage";
import { getAuthUser } from "../utils/access";

export default function CheckoutPage() {
  const { offerId } = useParams();
  const offer = offerPlans.find((item) => item.id === offerId);
  const user = getAuthUser();

  if (!user?.id) {
    return <Navigate to="/session-expired" replace state={{ offerId }} />;
  }

  if (!offer) {
    return <NotFoundPage message="The offer you selected is not available." />;
  }

  return (
    <div className="simple-page">
      <main className="simple-shell">
        <div className="simple-topbar">
          <Link className="simple-logo" to="/">
            <img src={logo} alt="" />
            Deutsch Learning
          </Link>
          <Link className="simple-home-link" to="/dashboard">
            Dashboard
          </Link>
        </div>

        <section className="simple-card">
          <p className="simple-eyebrow">Checkout</p>
          <h1>{offer.name}</h1>
          <p>
            You are logged in and ready to continue with the {offer.name} offer at
            {" "}{offer.price}. Payment integration can be connected here.
          </p>
          <div className="simple-actions">
            <Link className="simple-button" to="/dashboard">
              Continue to dashboard
            </Link>
            <Link className="simple-secondary-button" to="/offers">
              Back to offers
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
