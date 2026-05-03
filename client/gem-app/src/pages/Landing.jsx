import { Link } from "react-router-dom";
import {
  Activity,
  BookOpenCheck,
  ClipboardCheck,
  FilePenLine,
  Mic2,
  ShieldCheck,
} from "lucide-react";
import "./LandingPage.css";
import logo from "../assets/images/logo.png";
import iconProfile from "../assets/images/icon-profile.png";
import iconAudio from "../assets/images/icon-audio.png";
import iconWrite from "../assets/images/icon-write.png";
import iconSpeak from "../assets/images/icon-speak.png";
import graphIcon from "../assets/images/graph.png";
import calendarIcon from "../assets/images/calendar.png";
import certificateIcon from "../assets/images/certificate.png";
import activePeopleIcon from "../assets/images/active_people.png";
import avatar1 from "../assets/images/avatar-1.png";
import avatar2 from "../assets/images/avatar-2.png";
import algeriaFlag from "../assets/images/algeria.png";
import bangladeshFlag from "../assets/images/bangladesh.png";
import brazilFlag from "../assets/images/brazil.png";
import cameroonFlag from "../assets/images/cameroon.png";
import canadaFlag from "../assets/images/canada.png";
import egyptFlag from "../assets/images/egypt.png";
import franceFlag from "../assets/images/france.png";
import germanyFlag from "../assets/images/germany.png";
import ghanaFlag from "../assets/images/ghana.png";
import indiaFlag from "../assets/images/india.png";
import italyFlag from "../assets/images/italy.png";
import moroccoFlag from "../assets/images/morocco.png";
import nigeriaFlag from "../assets/images/nigeria.png";
import pakistanFlag from "../assets/images/pakistan.png";
import southAfricaFlag from "../assets/images/south-africa.png";
import spainFlag from "../assets/images/spain.png";
import tunisiaFlag from "../assets/images/tunisia.png";
import turkeyFlag from "../assets/images/turkey.png";
import unitedKingdomFlag from "../assets/images/united-kingdom.png";
import unitedStatesFlag from "../assets/images/united-states.png";
import duolingoLogo from "../assets/images/Duolingo-logo.png";
import goetheInstitutLogo from "../assets/images/goethe_institut.png";
import tuBerlinLogo from "../assets/images/TU-Berlin.png";
import bmflLogo from "../assets/images/BMFL.png";
import Navbar from "../components/landing/Navbar";
import Footer from "../components/landing/Footer";
import StatCard from "../components/landing/StatCard";
import ServiceCard from "../components/landing/ServiceCard";
import TestimonialCard from "../components/landing/TestimonialCard";
import { useLanguage } from "../context/LanguageContext";
import { examSimulations } from "../data/siteContent";

const trustedCountries = [
  { code: "DE", name: "Germany", flag: germanyFlag },
  { code: "FR", name: "France", flag: franceFlag },
  { code: "GB", name: "United Kingdom", flag: unitedKingdomFlag },
  { code: "US", name: "United States", flag: unitedStatesFlag },
  { code: "CA", name: "Canada", flag: canadaFlag },
  { code: "CM", name: "Cameroon", flag: cameroonFlag },
  { code: "NG", name: "Nigeria", flag: nigeriaFlag },
  { code: "GH", name: "Ghana", flag: ghanaFlag },
  { code: "IN", name: "India", flag: indiaFlag },
  { code: "PK", name: "Pakistan", flag: pakistanFlag },
  { code: "BD", name: "Bangladesh", flag: bangladeshFlag },
  { code: "MA", name: "Morocco", flag: moroccoFlag },
  { code: "DZ", name: "Algeria", flag: algeriaFlag },
  { code: "TN", name: "Tunisia", flag: tunisiaFlag },
  { code: "EG", name: "Egypt", flag: egyptFlag },
  { code: "ZA", name: "South Africa", flag: southAfricaFlag },
  { code: "TR", name: "Turkey", flag: turkeyFlag },
  { code: "BR", name: "Brazil", flag: brazilFlag },
  { code: "ES", name: "Spain", flag: spainFlag },
  { code: "IT", name: "Italy", flag: italyFlag },
];

export default function LandingPage() {
  const { language, setLanguage, t } = useLanguage();
  const copy = t.landing;

  const services = [
    {
      iconPath: iconProfile,
      title: copy.services[0],
      description: copy.serviceDescriptions?.[0] ?? "Practice complete exam flows with realistic timing and structure.",
    },
    {
      iconPath: iconAudio,
      title: copy.services[1],
      description: copy.serviceDescriptions?.[1] ?? "Build confidence with focused listening exercises and replay practice.",
    },
    {
      iconPath: iconWrite,
      title: copy.services[2],
      description: copy.serviceDescriptions?.[2] ?? "Improve written answers with correction-oriented training.",
    },
    {
      iconPath: iconSpeak,
      title: copy.services[3],
      description: copy.serviceDescriptions?.[3] ?? "Train clear pronunciation and exam-ready speaking responses.",
    },
    {
      iconPath: graphIcon,
      title: copy.extraServiceTitles?.[0] ?? "Progress Tracking",
      description: copy.serviceDescriptions?.[4] ?? "See your growth by skill and know what to revise next.",
    },
    {
      iconPath: calendarIcon,
      title: copy.extraServiceTitles?.[1] ?? "Flexible Schedule",
      description: copy.serviceDescriptions?.[5] ?? "Prepare at your own pace with sessions that fit your week.",
    },
    {
      iconPath: certificateIcon,
      title: copy.extraServiceTitles?.[2] ?? "Certified and Recognized",
      description: copy.serviceDescriptions?.[6] ?? "Work toward exams trusted by universities and institutions.",
    },
    {
      iconPath: activePeopleIcon,
      title: copy.extraServiceTitles?.[3] ?? "Active Community",
      description: copy.serviceDescriptions?.[7] ?? "Learn beside other motivated students preparing for success.",
    },
  ];

  const subscriptionFeatures = [
    {
      icon: <ClipboardCheck size={22} />,
      label: copy.subscriptionFeatures?.[0] ?? "Full tests in real conditions with correction",
    },
    {
      icon: <FilePenLine size={22} />,
      label: copy.subscriptionFeatures?.[1] ?? "Online written expression tests",
    },
    {
      icon: <Activity size={22} />,
      label: copy.subscriptionFeatures?.[2] ?? "Effective tracking throughout preparation",
    },
    {
      icon: <Mic2 size={22} />,
      label: copy.subscriptionFeatures?.[3] ?? "Online oral expression practice",
    },
  ];

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
            <div className="hero-sim-actions" aria-label="Choose a simulation">
              {examSimulations.map((exam) => (
                <Link
                  key={exam.id}
                  className="sim-start-button"
                  style={{ "--sim-accent": exam.accent }}
                  to={exam.path}
                >
                  <BookOpenCheck size={18} />
                  {exam.buttonLabel}
                </Link>
              ))}
            </div>
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
          <div className="services-grid services-grid-expanded">
            {services.map((service) => (
              <ServiceCard
                key={service.title}
                iconPath={service.iconPath}
                title={service.title}
                description={service.description}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="subscription-section">
        <div className="container subscription-container">
          <div className="subscription-copy">
            <p className="section-kicker">{copy.fullAccess}</p>
            <h2>{copy.subscriptionTitle}</h2>
            <p className="subscription-intro">
              {copy.subscriptionIntro}
            </p>
          </div>
          <div className="subscription-panel">
            <div className="subscription-feature-grid">
              {subscriptionFeatures.map((feature) => (
                <div className="subscription-feature" key={feature.label}>
                  <span className="subscription-icon">{feature.icon}</span>
                  <span>{feature.label}</span>
                </div>
              ))}
            </div>
            <Link className="btn btn-primary btn-large" to="/offers">
              {copy.viewOffers}
            </Link>
          </div>
        </div>
      </section>

      <section className="testimonials-section">
        <div className="container">
          <p className="reviews-kicker">{copy.thousandsSatisfied}</p>
          <h2 className="section-title">{copy.testimonials}</h2>
          <div className="testimonials-slider">
            <button className="slider-arrow" type="button">&lt;</button>
            <div className="testimonials-track">
              <TestimonialCard avatar={avatar1} text={copy.testimonialsText[0]} rating={5} />
              <TestimonialCard avatar={avatar2} text={copy.testimonialsText[1]} rating={5} />
            </div>
            <button className="slider-arrow" type="button">&gt;</button>
          </div>
          <p className="reviews-followup">{copy.reviewsFollowup}</p>
          <div className="text-center">
            <button className="btn btn-primary mt-4" type="button" onClick={onLeaveComment}>
              {copy.leaveComment}
            </button>
          </div>
        </div>
      </section>

      <section className="trust-section">
        <div className="container">
          <h2 className="section-title">{copy.trustTitle}</h2>
          <p className="trust-subtitle">{copy.trustSubtitle}</p>
        </div>
        <div className="flag-marquee" aria-label="Countries represented by our learners">
          <div className="flag-track">
            {[0, 1].map((group) => (
              <div className="flag-group" key={group} aria-hidden={group === 1}>
                {trustedCountries.map((country) => (
                  <span className="flag-chip" key={`${country.code}-${group}`} title={country.name}>
                    <img src={country.flag} alt={group === 0 ? `${country.name} flag` : ""} />
                  </span>
                ))}
              </div>
            ))}
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

      <section className="launch-section">
        <div className="container launch-container">
          <div>
            <p className="section-kicker">{copy.specialLaunch}</p>
            <h2>{copy.launchTitle}</h2>
            <p>{copy.launchText}</p>
          </div>
          <div className="launch-actions">
            <Link className="btn btn-primary btn-large" to="/offers">
              {copy.viewOffers}
            </Link>
            <Link className="btn btn-secondary btn-large" to="/start-preparation">
              <ShieldCheck size={18} />
              {copy.tryFree}
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
