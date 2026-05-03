export default function ServiceCard({ iconPath, icon, title, description }) {
  return (
    <div className="service-card">
      <div className="service-icon-wrapper">
        {icon ? icon : <img src={iconPath} alt="" className="service-icon" />}
      </div>
      <p className="service-title">{title}</p>
      {description ? <p className="service-description">{description}</p> : null}
    </div>
  );
}
