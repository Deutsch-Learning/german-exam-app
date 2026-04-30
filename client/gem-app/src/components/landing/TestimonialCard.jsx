import React from "react";

export default function TestimonialCard({ avatar, text }) {
  return (
    <div className="testimonial-card">
      <img src={avatar} alt="User Avatar" className="testimonial-avatar" />
      <p className="testimonial-text">"{text}"</p>
    </div>
  );
}
