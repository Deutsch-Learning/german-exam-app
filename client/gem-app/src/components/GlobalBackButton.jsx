import { useLocation } from "react-router-dom";
import BackButton from "./BackButton";
import styles from "./GlobalBackButton.module.css";

export default function GlobalBackButton() {
  const location = useLocation();

  if (location.pathname === "/") return null;

  return (
    <div className={styles.wrap}>
      <BackButton fallback="/" className={styles.button} />
    </div>
  );
}
