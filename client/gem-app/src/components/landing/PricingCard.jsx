import { Link } from "react-router-dom";
import { Check } from "lucide-react";

export default function PricingCard({
  theme,
  title,
  price,
  subtitle,
  features,
  isHighlighted,
}) {
  return (
    <div className={`pricing-card ${isHighlighted ? "highlighted" : ""} theme-${theme}`}>
      <div className="pricing-header">
        <h3>{title}</h3>
      </div>
      <div className="pricing-body">
        <h2 className="price">{price}</h2>
        <p className="pricing-subtitle">{subtitle}</p>
        <Link className="btn btn-full" to="/offers">View offers</Link>
        <ul className="pricing-features">
          {features.map((feature, idx) => (
            <li key={idx}>
              <span className="check-icon">
                <Check size={16} />
              </span>
              {feature}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
