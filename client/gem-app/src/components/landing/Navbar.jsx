import React from "react";

export default function Navbar({ logo, frenchFlag }) {
  return (
    <header className="top-nav">
      <div className="container nav-container">
        <div className="logo">
          <img src={logo} alt="Logo" />
        </div>
        <nav className="desktop-nav">
          <a href="#services">Accueil</a>
          <a href="#forfaits">Nos forfaits</a>
          <a href="#contact">Contact</a>
          <div className="language-selector">
            <img src={frenchFlag} alt="FR" />
          </div>
          <button className="btn-login">Connexion</button>
        </nav>
      </div>
    </header>
  );
}
