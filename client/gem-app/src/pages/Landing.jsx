import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import "./LandingPage.css";
import logo from "../assets/images/logo.png";
import iconProfile from "../assets/images/icon-profile.png";
import iconAudio from "../assets/images/icon-audio.png";
import iconWrite from "../assets/images/icon-write.png";
import iconSpeak from "../assets/images/icon-speak.png";
import avatar1 from "../assets/images/avatar-1.png";
import avatar2 from "../assets/images/avatar-2.png";
import contactWoman from "../assets/images/contact-woman.jpg";
import duolingoLogo from "../assets/images/Duolingo-logo.png";
import goetheInstitutLogo from "../assets/images/goethe_institut.png";
import tuBerlinLogo from "../assets/images/TU-Berlin.png";
import bmflLogo from "../assets/images/BMFL.png";
import Navbar from "../components/landing/Navbar";
import Footer from "../components/landing/Footer";
import StatCard from "../components/landing/StatCard";
import ServiceCard from "../components/landing/ServiceCard";
import PricingCard from "../components/landing/PricingCard";
import TestimonialCard from "../components/landing/TestimonialCard";
import API from "../services/api";
import { useLanguage } from "../context/LanguageContext";

export default function LandingPage() {
  const { hash } = useLocation();
  const { language, setLanguage, t } = useLanguage();
  const copy = t.landing;
  const [contactLoading, setContactLoading] = useState(false);
  const [contactMessage, setContactMessage] = useState("");
  const [contactForm, setContactForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    message: "",
  });

  useEffect(() => {
    if (hash === "#contact") {
      setTimeout(() => {
        document.getElementById("contact")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  }, [hash]);

  const handleContactChange = (event) => {
    const { name, value } = event.target;
    setContactForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleContactSubmit = async (event) => {
    event.preventDefault();
    setContactMessage("");
    setContactLoading(true);
    try {
      const res = await API.post("/contact", contactForm);
      if (res.data?.ok) {
        setContactMessage(copy.sent);
        setContactForm({ firstName: "", lastName: "", email: "", phone: "", message: "" });
      } else {
        setContactMessage(res.data?.error ?? "Erreur d'envoi.");
      }
    } catch {
      setContactMessage("Impossible d'envoyer le message.");
    } finally {
      setContactLoading(false);
    }
  };

  const onLeaveComment = () => {
    const message = window.prompt(copy.commentPrompt);
    if (message && message.trim()) {
      window.alert("Merci pour votre commentaire.");
    }
  };

  return (
    <div className="landing-page">
      <Navbar
        logo={logo}
        language={language}
        onChangeLanguage={setLanguage}
        labels={{ ...copy.nav, lessons: t.common.lessons }}
      />

      <section className="hero-section">
        <div className="container hero-container">
          <div className="hero-content">
            <h1 className="hero-title">
              {copy.heroTitleA}
              <br />
              {copy.heroTitleB}
            </h1>
            <p className="hero-subtitle">{copy.heroSubtitle}</p>
            <Link className="btn btn-primary btn-large" to="/login">
              {copy.launch} <span className="arrow">→</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="stats-section">
        <div className="container stats-container">
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" strokeWidth="2" fill="none">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
            value="1000+"
            label={copy.stats[0]}
          />
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" strokeWidth="2" fill="none">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
            }
            value="99%"
            label={copy.stats[1]}
          />
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" strokeWidth="2" fill="none">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            }
            value="4.9/5"
            label={copy.stats[2]}
          />
        </div>
      </section>

      <section className="services-section" id="services">
        <div className="container">
          <h2 className="section-title">{copy.servicesTitle}</h2>
          <div className="services-grid">
            <ServiceCard iconPath={iconProfile} title={copy.services[0]} />
            <ServiceCard iconPath={iconAudio} title={copy.services[1]} />
            <ServiceCard iconPath={iconWrite} title={copy.services[2]} />
            <ServiceCard iconPath={iconSpeak} title={copy.services[3]} />
          </div>
        </div>
      </section>

      <section className="pricing-section" id="forfaits">
        <div className="container">
          <h2 className="section-title">{copy.pricingTitle}</h2>
          <div className="pricing-grid">
            <PricingCard
              theme="bronze"
              title="Bronze"
              price="$30.99"
              subtitle={copy.pricing.bronze.subtitle}
              features={copy.pricing.bronze.features}
            />
            <PricingCard
              theme="silver"
              title="Silver"
              price="$45.99"
              subtitle={copy.pricing.silver.subtitle}
              isHighlighted={true}
              features={copy.pricing.silver.features}
            />
            <PricingCard
              theme="gold"
              title="Gold"
              price="$99.99"
              subtitle={copy.pricing.gold.subtitle}
              features={copy.pricing.gold.features}
            />
          </div>
        </div>
      </section>

      <section className="testimonials-section">
        <div className="container">
          <h2 className="section-title">{copy.testimonials}</h2>
          <div className="testimonials-slider">
            <button className="slider-arrow" type="button">&lt;</button>
            <div className="testimonials-track">
              <TestimonialCard avatar={avatar1} text={copy.testimonialsText[0]} />
              <TestimonialCard avatar={avatar2} text={copy.testimonialsText[1]} />
            </div>
            <button className="slider-arrow" type="button">&gt;</button>
          </div>
          <div className="text-center">
            <button className="btn btn-primary mt-4" type="button" onClick={onLeaveComment}>
              {copy.leaveComment}
            </button>
          </div>
        </div>
      </section>

      <section className="partners-section">
        <div className="container">
          <h2 className="section-title">{copy.partners}</h2>
          <div className="partners-grid">
            <img src={duolingoLogo} alt="Duolingo" />
            <img src={goetheInstitutLogo} alt="Goethe Institut" />
            <img src={tuBerlinLogo} alt="TU Berlin" />
            <img src={bmflLogo} alt="BMFL" />
          </div>
        </div>
      </section>

      <section className="contact-section" id="contact">
        <div className="container">
          <h2 className="section-title">{copy.contact}</h2>
          <div className="contact-container">
            <div className="contact-image">
              <img src={contactWoman} alt={copy.contact} />
            </div>
            <form className="contact-form" onSubmit={handleContactSubmit}>
              <div className="form-row">
                <input type="text" name="lastName" value={contactForm.lastName} onChange={handleContactChange} placeholder={copy.lastName} required />
                <input type="text" name="firstName" value={contactForm.firstName} onChange={handleContactChange} placeholder={copy.firstName} required />
              </div>
              <input type="email" name="email" value={contactForm.email} onChange={handleContactChange} placeholder={copy.email} required />
              <input type="tel" name="phone" value={contactForm.phone} onChange={handleContactChange} placeholder={copy.phone} />
              <textarea
                name="message"
                value={contactForm.message}
                onChange={handleContactChange}
                placeholder={copy.question}
                rows="4"
                required
              />
              {contactMessage ? <p className="contact-feedback">{contactMessage}</p> : null}
              <button type="submit" className="btn btn-primary btn-full">
                {contactLoading ? "..." : copy.send}
              </button>
            </form>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
