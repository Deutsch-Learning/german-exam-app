import React from "react";

export default function PricingCard({
  theme,
  title,
  price,
  subtitle,
  features,
  isHighlighted,
}) {
  return (
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
}
