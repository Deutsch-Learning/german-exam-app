import React from "react";

export default function ServiceCard({ iconPath, title }) {
  return (
    <div className="service-card">
      <div className="service-icon-wrapper">
        <img src={iconPath} alt="" className="service-icon" />
      </div>
      <p className="service-title">{title}</p>
    </div>
  );
}
