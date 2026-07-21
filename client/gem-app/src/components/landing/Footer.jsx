import { Link } from "react-router-dom";
import { SUPPORT_WHATSAPP_URL } from "../../config/support";

const socialLinks = [
  {
    id: "facebook",
    label: "Facebook",
    href: "https://www.facebook.com/share/1aep7PYUru",
    path: "M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06C2 17.08 5.66 21.24 10.44 22v-7.03H7.9v-2.91h2.54V9.84c0-2.52 1.5-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.9h2.78l-.44 2.91h-2.34V22C18.34 21.24 22 17.08 22 12.06Z",
  },
  {
    id: "tiktok",
    label: "TikTok",
    href: "https://www.tiktok.com/@.golden_boyss?_r=1&_t=ZS-98CGRBlgMJZ",
    path: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.25 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.27-1.1-.62-1.62-.98-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.72-.03-.5-.04-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.45 3.99-2.14 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.08-.14 1.62.24 1.64 1.82 3.02 3.5 2.87 1.11-.01 2.17-.66 2.75-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    href: SUPPORT_WHATSAPP_URL,
    path: "M20.52 3.47A11.85 11.85 0 0 0 12.1 0C5.55 0 .22 5.33.22 11.88c0 2.1.55 4.14 1.6 5.94L0 24l6.32-1.66a11.9 11.9 0 0 0 5.78 1.47h.01c6.55 0 11.88-5.33 11.88-11.88 0-3.18-1.23-6.16-3.47-8.46Zm-8.41 18.33h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.75.98 1-3.65-.24-.38a9.84 9.84 0 0 1-1.51-5.27c0-5.45 4.44-9.88 9.9-9.88a9.82 9.82 0 0 1 6.99 2.9 9.84 9.84 0 0 1 2.9 7c0 5.45-4.44 9.89-9.89 9.89Zm5.42-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.65-2.04-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.11 3.22 5.1 4.51.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35Z",
  },
];

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-container">
        <div className="footer-brand">
          <span>Deutsch</span> Prüfung
        </div>
        <div className="footer-bottom">
          <p>Copyright &copy; 2026- Deutsch Prüfungen. All rights reserved.</p>
          <nav className="footer-legal-links" aria-label="Legal links">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/refund-condition">Refunds</Link>
          </nav>
          <div className="footer-socials" aria-label="Social media">
            {socialLinks.map((item) => (
              <a key={item.id} href={item.href} aria-label={item.label} target="_blank" rel="noreferrer">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={item.path} />
                </svg>
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
