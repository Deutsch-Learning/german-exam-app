import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Send, Wallet } from "lucide-react";
import API from "../services/api";
import BackButton from "../components/BackButton";
import { useLanguage } from "../context/LanguageContext";
import styles from "./ProfilePage.module.css";

const formatDate = (value) => {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "-";
  }
};

export default function PartnerPage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [partnerData, setPartnerData] = useState(null);
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    publicName: "",
    payoutMethod: "mtn",
    payoutDestination: "",
    acceptedTerms: false,
    payoutAmount: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [affiliateRes, profileRes] = await Promise.all([
        API.get("/api/affiliate/me"),
        API.get("/api/user/profile").catch(() => null),
      ]);
      setPartnerData(affiliateRes.data);
      const loadedUser = profileRes?.data?.user || null;
      setUser(loadedUser);
      if (!affiliateRes.data?.partner) {
        const publicName = [loadedUser?.first_name, loadedUser?.last_name].filter(Boolean).join(" ").trim()
          || loadedUser?.username
          || "";
        setForm((previous) => ({ ...previous, publicName }));
      }
    } catch (err) {
      setError(err.response?.data?.error || "Impossible de charger l'espace partenaire.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const partnerStatus = partnerData?.partner?.status || "";
  const partnerIsActive = partnerStatus === "active";
  const partnerIsPending = partnerStatus === "pending_review";
  const partnerIsSuspended = partnerStatus === "suspended";
  const currency = partnerData?.settings?.defaultCurrency || "XAF";
  const partnerLink = partnerData?.primaryCode?.code
    ? `${window.location.origin}/register?ref=${encodeURIComponent(partnerData.primaryCode.code)}`
    : "";
  const formatMoney = (value) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value) || 0);
  const displayName = useMemo(() => user?.first_name || user?.username || "partenaire", [user]);

  const submitRequest = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const res = await API.post("/api/affiliate/activate", {
        publicName: form.publicName,
        payoutMethod: form.payoutMethod,
        payoutDestination: form.payoutDestination,
        acceptedTerms: form.acceptedTerms,
      });
      setPartnerData(res.data);
      setNotice(res.data?.message || "Votre demande a ete envoyee. Vous recevrez un retour par mail.");
    } catch (err) {
      setError(err.response?.data?.error || "Impossible d'envoyer la demande partenaire.");
    } finally {
      setBusy(false);
    }
  };

  const requestPayout = async () => {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await API.post("/api/affiliate/payouts", { amount: form.payoutAmount });
      const refreshed = await API.get("/api/affiliate/me");
      setPartnerData(refreshed.data);
      setForm((previous) => ({ ...previous, payoutAmount: "" }));
      setNotice("Demande de retrait envoyee.");
    } catch (err) {
      setError(err.response?.data?.error || "Impossible de demander le retrait.");
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (value) => {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    setNotice("Copie effectuee.");
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>
        <BackButton fallback="/dashboard" label={t.common.back} />
        <section className={styles.heroCard}>
          <div>
            <p className={styles.eyebrow}>Programme partenaire</p>
            <h1>Bonjour {displayName}</h1>
            <p className={styles.heroText}>
              Recommandez la plateforme, suivez vos inscriptions et demandez vos retraits depuis un espace dedie.
            </p>
          </div>
          <div className={styles.levelBadge}>
            <Wallet size={20} />
            <span>Statut</span>
            <strong>{partnerStatus || "Nouveau"}</strong>
          </div>
        </section>

        {error ? <p className={styles.error}>{error}</p> : null}
        {notice ? <p className={styles.success}>{notice}</p> : null}
        {loading ? <div className={styles.skeletonGrid}><span /><span /><span /></div> : null}

        {!loading ? (
          <section className={`${styles.card} ${styles.partnerCard}`}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.eyebrow}>Espace partenaire</p>
                <h2>{partnerIsActive ? "Mon tableau de bord" : partnerData?.partner ? "Demande en cours" : "Devenir partenaire"}</h2>
              </div>
              <Wallet size={22} />
            </div>

            {!partnerData?.partner ? (
              <form className={styles.partnerForm} onSubmit={submitRequest}>
                <p className={styles.legalIntro}>
                  Recommandez la plateforme et gagnez une commission uniquement lorsqu'une recommandation realise un premier paiement verifie.
                </p>
                <label className={styles.label}>
                  Nom public partenaire
                  <input className={styles.input} value={form.publicName} onChange={(event) => setForm((previous) => ({ ...previous, publicName: event.target.value }))} />
                </label>
                <label className={styles.label}>
                  Methode de retrait
                  <select className={styles.input} value={form.payoutMethod} onChange={(event) => setForm((previous) => ({ ...previous, payoutMethod: event.target.value }))}>
                    <option value="mtn">MTN Mobile Money</option>
                    <option value="orange">Orange Money</option>
                  </select>
                </label>
                <label className={styles.label}>
                  Numero de paiement
                  <input className={styles.input} value={form.payoutDestination} onChange={(event) => setForm((previous) => ({ ...previous, payoutDestination: event.target.value }))} placeholder="+237 6..." />
                </label>
                <label className={styles.checkboxRow}>
                  <input type="checkbox" checked={form.acceptedTerms} onChange={(event) => setForm((previous) => ({ ...previous, acceptedTerms: event.target.checked }))} />
                  <span>J'accepte les conditions du programme partenaire.<small>Le numero de paiement ne pourra etre modifie qu'en contactant le service client.</small></span>
                </label>
                <button className={styles.submitBtn} type="submit" disabled={busy}>{busy ? "Envoi..." : "Envoyer ma demande partenaire"}</button>
              </form>
            ) : partnerIsPending || partnerIsSuspended ? (
              <div className={styles.partnerDashboard}>
                <div className={partnerIsSuspended ? styles.partnerStatusDanger : styles.partnerStatusBox}>
                  <strong>{partnerIsSuspended ? "Compte partenaire suspendu" : "Demande envoyee"}</strong>
                  <p>
                    {partnerIsSuspended
                      ? "Votre espace partenaire est temporairement suspendu. Contactez le service client pour plus d'informations."
                      : "Votre demande a ete envoyee. Vous recevrez un retour par mail apres validation par l'administration."}
                  </p>
                </div>
                <div className={styles.partnerPayout}>
                  <p>Retrait: {partnerData.partner.payoutMethod?.toUpperCase()} {partnerData.partner.payoutDestination}</p>
                  <p className={styles.emptyState}>Le code et le lien de recommandation seront generes automatiquement apres approbation.</p>
                </div>
              </div>
            ) : partnerIsActive ? (
              <div className={styles.partnerDashboard}>
                <div className={styles.partnerCodeBox}>
                  <span>Code</span>
                  <strong>{partnerData.primaryCode?.code}</strong>
                  <button type="button" onClick={() => copyText(partnerData.primaryCode?.code)}><Copy size={15} /> Copier</button>
                </div>
                <div className={styles.partnerLinkBox}>
                  <span>Lien de recommandation</span>
                  <code>{partnerLink}</code>
                  <div className={styles.partnerActions}>
                    <button type="button" onClick={() => copyText(partnerLink)}><Copy size={15} /> Lien</button>
                    <a href={`https://wa.me/?text=${encodeURIComponent(partnerLink)}`} target="_blank" rel="noreferrer"><Send size={15} /> WhatsApp</a>
                    {navigator.share ? <button type="button" onClick={() => navigator.share({ title: "Deutsch Pruefungen", url: partnerLink })}>Partager</button> : null}
                  </div>
                </div>
                <div className={styles.partnerMetrics}>
                  <span><strong>{partnerData.metrics?.clicks || 0}</strong> visites</span>
                  <span><strong>{partnerData.metrics?.registered || 0}</strong> inscriptions</span>
                  <span><strong>{partnerData.metrics?.converted || 0}</strong> clients payants</span>
                  <span><strong>{partnerData.metrics?.conversionRate || 0}%</strong> conversion</span>
                  <span><strong>{formatMoney(partnerData.metrics?.pendingCommission)}</strong> attente</span>
                  <span><strong>{formatMoney(partnerData.metrics?.availableBalance)}</strong> disponible</span>
                  <span><strong>{formatMoney(partnerData.metrics?.totalPaid)}</strong> paye</span>
                  <span><strong>{formatMoney(partnerData.metrics?.totalEarned)}</strong> gagne</span>
                </div>
                <div className={styles.partnerPayout}>
                  <p>Retrait: {partnerData.partner.payoutMethod?.toUpperCase()} {partnerData.partner.payoutDestination}</p>
                  <div>
                    <input className={styles.input} value={form.payoutAmount} onChange={(event) => setForm((previous) => ({ ...previous, payoutAmount: event.target.value }))} placeholder={`Minimum ${formatMoney(partnerData.settings?.minimumWithdrawalAmount)}`} inputMode="numeric" />
                    <button className={styles.submitBtn} type="button" onClick={requestPayout} disabled={busy}>Demander un retrait</button>
                  </div>
                </div>
                <div className={styles.partnerTables}>
                  <div>
                    <h3>Mes commissions</h3>
                    {partnerData.commissions?.slice(0, 5).map((item) => <p key={item.id}><strong>{formatMoney(item.commissionAmount)}</strong><span>{item.status} - {formatDate(item.createdAt)}</span></p>)}
                    {!partnerData.commissions?.length ? <p className={styles.emptyState}>Aucune commission pour le moment.</p> : null}
                  </div>
                  <div>
                    <h3>Paiements</h3>
                    {partnerData.payouts?.slice(0, 5).map((item) => <p key={item.id}><strong>{formatMoney(item.amount)}</strong><span>{item.status} - {formatDate(item.requestedAt)}</span></p>)}
                    {!partnerData.payouts?.length ? <p className={styles.emptyState}>Aucun retrait demande.</p> : null}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
