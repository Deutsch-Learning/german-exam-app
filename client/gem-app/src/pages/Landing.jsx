import React from "react";
import "./LandingPage.css";

const StatCard = ({ icon, value, label }) => (
  <div className="stat-card">
    <div className="stat-icon">{icon}</div>
    <h3 className="stat-value">{value}</h3>
    <p className="stat-label">{label}</p>
  </div>
);

const ServiceCard = ({ iconPath, title }) => (
  <div className="service-card">
    <div className="service-icon-wrapper">
      <img src={iconPath} alt="" className="service-icon" />
    </div>
    <p className="service-title">{title}</p>
  </div>
);

const PricingCard = ({
  theme,
  title,
  price,
  subtitle,
  features,
  isHighlighted,
}) => (
  <div
    className={`pricing-card ${isHighlighted ? "highlighted" : ""} theme-${theme}`}
  >
    <div className="pricing-header">
      <h3>{title}</h3>
    </div>
    <div className="pricing-body">
      <h2 className="price">{price}</h2>
      <p className="pricing-subtitle">{subtitle}</p>
      <button className="btn btn-full">Choisir ce forfait</button>
      <ul className="pricing-features">
        {features.map((feature, idx) => (
          <li key={idx}>
            <span className="check-icon">✓</span>
            {feature}
          </li>
        ))}
      </ul>
    </div>
  </div>
);

const TestimonialCard = ({ avatar, text }) => (
  <div className="testimonial-card">
    <img src={avatar} alt="User Avatar" className="testimonial-avatar" />
    <p className="testimonial-text">"{text}"</p>
  </div>
);

export default function LandingPage() {
  return (
    <div className="landing-page">
      {/* HEADER / NAV */}
      <header className="top-nav">
        <div className="container nav-container">
          <div className="logo">
            <img src="/assets/images/logo.png" alt="Logo" />
          </div>
          <nav className="desktop-nav">
            <a href="#services">Accueil</a>
            <a href="#forfaits">Nos forfaits</a>
            <a href="#contact">Contact</a>
            <div className="language-selector">
              <img src="/assets/images/flag-fr.png" alt="FR" />
            </div>
            <button className="btn-login">Connexion</button>
          </nav>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="hero-section">
        <div className="container hero-container">
          <div className="hero-content">
            <h1 className="hero-title">
              Dominez l'examen d'allemand.
              <br />
              Assurez votre certificat.
            </h1>
            <p className="hero-subtitle">
              Transformez votre stress en automatisme. Des simulations realistes
              et un encadrement continu des lacunes avant de passer l'examen
              officiel.
            </p>
            <button className="btn btn-primary btn-large">
              Lancer ma simulation <span className="arrow">→</span>
            </button>
          </div>
          <div className="hero-visuals">
            <img
              src="/assets/images/student-hero.png"
              alt="Student studying"
              className="hero-image"
            />
            <img
              src="/assets/images/german-flag-wave.png"
              alt="German Flag"
              className="hero-flag"
            />
          </div>
        </div>
      </section>

      {/* STATS SECTION */}
      <section className="stats-section">
        <div className="container stats-container">
          <StatCard
            icon={
              <svg
                viewBox="0 0 24 24"
                width="32"
                height="32"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
            value="1000+"
            label="Etudiants actifs"
          />
          <StatCard
            icon={
              <svg
                viewBox="0 0 24 24"
                width="32"
                height="32"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
              >
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
            }
            value="99%"
            label="Taux de reussite"
          />
          <StatCard
            icon={
              <svg
                viewBox="0 0 24 24"
                width="32"
                height="32"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            }
            value="4.9/5"
            label="Note moyenne"
          />
        </div>
      </section>

      {/* SERVICES SECTION */}
      <section className="services-section" id="services">
        <div className="container">
          <h2 className="section-title">Nos services</h2>
          <div className="services-grid">
            <ServiceCard
              iconPath="/assets/images/icon-exam.svg"
              title="Simulations d'examens realistes"
            />
            <ServiceCard
              iconPath="/assets/images/icon-audio.svg"
              title="Entrainement audio et comprehension orale"
            />
            <ServiceCard
              iconPath="/assets/images/icon-write.svg"
              title="Correction d'exercices ecrits"
            />
            <ServiceCard
              iconPath="/assets/images/icon-speak.svg"
              title="Pratique de la prononciation"
            />
          </div>
        </div>
      </section>

      {/* PRICING SECTION */}
      <section className="pricing-section" id="forfaits">
        <div className="container">
          <h2 className="section-title">Nos forfaits</h2>
          <div className="pricing-grid">
            <PricingCard
              theme="bronze"
              title="Bronze"
              price="$30.99"
              subtitle="Ideal pour se familiariser avec l'examen"
              features={[
                "Test de niveau complet",
                "Acces a 5 simulations d'examen",
                "Correction automatique",
                "Support par email",
              ]}
            />
            <PricingCard
              theme="silver"
              title="Silver"
              price="$45.99"
              subtitle="Le choix prefere de nos candidats"
              isHighlighted={true}
              features={[
                "Tout le contenu Bronze",
                "Acces illimite aux simulations",
                "Corrections par un tuteur",
                "Session de conversation (1h/mois)",
                "Support prioritaire",
              ]}
            />
            <PricingCard
              theme="gold"
              title="Gold"
              price="$99.99"
              subtitle="L'accompagnement premium pour reussir"
              features={[
                "Tout le contenu Silver",
                "Coaching personnel",
                "Sessions de conversation illimitees",
                "Garantie de reussite ou rembourse",
                "Support 24/7",
              ]}
            />
          </div>
        </div>
      </section>

      {/* TESTIMONIALS SECTION */}
      <section className="testimonials-section">
        <div className="container">
          <h2 className="section-title">Avis de nos candidats</h2>
          <div className="testimonials-slider">
            <button className="slider-arrow">&lt;</button>
            <div className="testimonials-track">
              <TestimonialCard
                avatar="/assets/images/avatar-1.png"
                text="Grace a cette plateforme, j'ai obtenu mon certificat B2 du premier coup. Les simulations sont extremement fideles a la realite."
              />
              <TestimonialCard
                avatar="/assets/images/avatar-2.png"
                text="Un accompagnement exceptionnel. Le suivi personnalise m'a permis de corriger mes erreurs recurrentes a l'ecrit."
              />
            </div>
            <button className="slider-arrow">&gt;</button>
          </div>
          <div className="text-center">
            <button className="btn btn-primary mt-4">Laissez un commentaire</button>
          </div>
        </div>
      </section>

      {/* PARTNERS SECTION */}
      <section className="partners-section">
        <div className="container">
          <h2 className="section-title">Nos partenaires</h2>
          <div className="partners-grid">
            <img src="/assets/images/partner-placeholder.svg" alt="Partner 1" />
            <img src="/assets/images/partner-placeholder.svg" alt="Partner 2" />
            <img src="/assets/images/partner-placeholder.svg" alt="Partner 3" />
            <img src="/assets/images/partner-placeholder.svg" alt="Partner 4" />
          </div>
        </div>
      </section>

      {/* CONTACT SECTION */}
      <section className="contact-section" id="contact">
        <div className="container">
          <h2 className="section-title">Contactez-nous</h2>
          <div className="contact-container">
            <div className="contact-image">
              <img src="/assets/images/contact-woman.jpg" alt="Contact us" />
            </div>
            <form className="contact-form">
              <div className="form-row">
                <input type="text" placeholder="Nom" required />
                <input type="text" placeholder="Prenom" required />
              </div>
              <input type="email" placeholder="Email" required />
              <input type="tel" placeholder="Telephone" />
              <textarea
                placeholder="Comment pouvons-nous vous aider ?"
                rows="4"
                required
              />
              <button type="submit" className="btn btn-primary btn-full">
                Envoyer
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="container">
          <p>Copyright © 2024 Deutsch Learning. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
