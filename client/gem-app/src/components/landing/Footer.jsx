const socialLinks = [
  {
    id: "facebook",
    label: "Facebook",
    href: "https://www.facebook.com/deutschlearning",
    path: "M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06C2 17.08 5.66 21.24 10.44 22v-7.03H7.9v-2.91h2.54V9.84c0-2.52 1.5-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.9h2.78l-.44 2.91h-2.34V22C18.34 21.24 22 17.08 22 12.06Z",
  },
  {
    id: "twitter",
    label: "Twitter",
    href: "https://twitter.com/deutschlearning",
    path: "M18.24 3H21.4l-6.91 7.9L22.62 21h-6.37l-4.99-6.52L5.55 21H2.38l7.39-8.45L1.97 3h6.53l4.51 5.96L18.24 3Zm-1.11 16.22h1.75L7.55 4.69H5.67l11.46 14.53Z",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/deutschlearning",
    path: "M4.98 3.5C4.98 4.88 3.87 6 2.5 6S.02 4.88.02 3.5 1.13 1 2.5 1s2.48 1.12 2.48 2.5ZM.36 8h4.28v13H.36V8Zm7.09 0h4.1v1.78h.06c.57-1.08 1.96-2.22 4.04-2.22 4.32 0 5.12 2.84 5.12 6.54V21h-4.28v-6.12c0-1.46-.03-3.34-2.04-3.34-2.04 0-2.35 1.59-2.35 3.23V21H7.45V8Z",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    href: "https://wa.me/237000000000",
    path: "M20.52 3.47A11.85 11.85 0 0 0 12.1 0C5.55 0 .22 5.33.22 11.88c0 2.1.55 4.14 1.6 5.94L0 24l6.32-1.66a11.9 11.9 0 0 0 5.78 1.47h.01c6.55 0 11.88-5.33 11.88-11.88 0-3.18-1.23-6.16-3.47-8.46Zm-8.41 18.33h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.75.98 1-3.65-.24-.38a9.84 9.84 0 0 1-1.51-5.27c0-5.45 4.44-9.88 9.9-9.88a9.82 9.82 0 0 1 6.99 2.9 9.84 9.84 0 0 1 2.9 7c0 5.45-4.44 9.89-9.89 9.89Zm5.42-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.65-2.04-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.11 3.22 5.1 4.51.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35Z",
  },
  {
    id: "telegram",
    label: "Telegram",
    href: "https://t.me/deutschlearning",
    path: "M23.91 3.79 20.29 20.9c-.27 1.21-.98 1.51-1.98.94l-5.49-4.05-2.65 2.55c-.29.29-.54.54-1.11.54l.4-5.59L19.62 6.1c.44-.4-.1-.62-.69-.22L6.37 13.78.96 12.09c-1.18-.37-1.2-1.18.25-1.74L22.37 2.2c.98-.37 1.84.22 1.54 1.59Z",
  },
];

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-container">
        <div className="footer-brand">
          <span>Deutsch</span> Learning
        </div>
        <div className="footer-bottom">
          <p>Copyright &copy; 2024 Deutsch Learning. All rights reserved.</p>
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
