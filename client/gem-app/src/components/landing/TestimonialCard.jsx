import { Star } from "lucide-react";

export default function TestimonialCard({ avatar, text, rating = 5 }) {
  const safeRating = Math.max(0, Math.min(5, Number(rating) || 0));

  return (
    <div className="testimonial-card">
      <img src={avatar} alt="User Avatar" className="testimonial-avatar" />
      <div className="testimonial-body">
        <div className="testimonial-rating" aria-label={`${safeRating} out of 5 stars`}>
          {Array.from({ length: 5 }).map((_, index) => (
            <Star
              key={index}
              size={18}
              strokeWidth={1.8}
              fill={index < safeRating ? "currentColor" : "none"}
            />
          ))}
        </div>
        <p className="testimonial-text">"{text}"</p>
      </div>
    </div>
  );
}
