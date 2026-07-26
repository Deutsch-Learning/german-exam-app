const banks = [
  [
    "Volkshochschule: Kochen für Einsteiger – Samstag, 9–13 Uhr, nur 25 Euro. Alle Materialien inklusive.",
    "Sprachcafé Englisch: Jeden Dienstag ab 19 Uhr im Café Central. Eintritt frei, Getränke selbst bezahlen.",
    "Erlebnispark Waldwunder: Kletterwald, Minigolf, Tiergehege – ideal für Familien mit Kindern!",
    "Stellenausschreibung: Restaurant La Bella sucht Servicepersonal (m/w/d) für Juli–August, Vollzeit.",
    "Flohmärkte Stadtmitte: Jeden Samstag von 8–14 Uhr. Standgebühr 10 Euro. Anmeldung erforderlich.",
    "Fotokurs – Kreative Bildgestaltung: 6 Abende, Beginn 15. März. VHS-Anmeldung online.",
    "WG-Zimmer frei: 18 qm, zentrale Lage, ruhige Mitbewohner. 480 Euro warm. Ab sofort.",
    "Yoga für Anfänger: Montags 18 Uhr im Gemeinschaftshaus. Matte mitbringen.",
    "Babysitter gesucht: 2 Abende pro Woche, 12 Euro/Stunde. Referenzen erwünscht.",
    "Konzert: Jazzabend mit der Band 'Blue Note' – Freitag 20 Uhr, Eintritt 15 Euro.",
  ],
  [
    "Fahrradwerkstatt Grünrad: Reparaturen aller Art, faire Preise. Mo–Sa 9–18 Uhr.",
    "Klimademo Stadtpark: Samstag 14 Uhr. Alle sind willkommen – bringt Plakate mit!",
    "Naturkost-Markt Sonnenschein: Täglich frische Bio-Produkte aus der Region. Stadtmitte.",
    "Wertstoffhof: Kostenlose Annahme von Elektrogeräten jeden Samstag 8–13 Uhr.",
    "Kinderkleidung kaufen und verkaufen: Secondhand-Laden 'Kleine Helden'. Günstig und nachhaltig.",
    "SolarExperte GmbH: Kostenlose Beratung und professionelle Montage von Solaranlagen.",
    "Freiwilliges Ökologisches Jahr: Bewerbungen für Sommerprojekte jetzt möglich!",
    "Yogaklassen im Park: Jeden Morgen um 7 Uhr – kostenlos und für alle offen.",
    "Sprachkurs Spanisch: Abendkurs für Anfänger, VHS, ab September.",
    "Floristik-Workshop: Selbst Blumensträuße binden – Samstag 15 Uhr, 20 Euro.",
  ],
  [
    "Ernährungsberatung Dr. Bauer: Spezialisiert auf Diabetes, Übergewicht und Nahrungsmittelunverträglichkeiten. Termin online buchen.",
    "VHS-Kurs: Gesund kochen mit Kindern – Spaß in der Küche für die ganze Familie. Ab 6 Jahren. Samstags.",
    "Fitnesskurs 60+: Sanfte Übungen für Kraft und Beweglichkeit. Dienstags und Donnerstags, 10 Uhr.",
    "Vegan Guide Stadt: Alle veganen und vegetarischen Restaurants auf einen Blick – kostenlose App.",
    "Kinderarztpraxis Dr. Sommer: Montag–Samstag geöffnet. Auch samstags Sprechstunde 9–12 Uhr.",
    "Yoga für Einsteiger: Kein Vorwissen nötig. Kleingruppenunterricht, max. 8 Teilnehmer. VHS.",
    "SleepBetter App: Schlafanalyse, Entspannungsübungen und persönliche Tipps für besseren Schlaf.",
    "Stadtlauf-Anmeldung: Lauf mit beim Herbstmarathon! Für alle Leistungsstufen. Jetzt registrieren.",
    "Blutdruckmessen kostenlos: Jeden Mittwoch in der Stadtapotheke. Kein Termin nötig.",
    "Massagestudio Wohlgefühl: Entspannungs- und Sportmassagen. Terminvereinbarung online.",
  ],
  [
    "Sprachschule Integral: Deutschkurse für Migranten – alle Niveaus. Förderung möglich.",
    "Gitarrenreparatur Müller: Professionelle Instandsetzung aller Saiteninstrumente. Terminvereinbarung nötig.",
    "Tagesmutter Maria: Liebevolle Betreuung von Kleinkindern ab 6 Monate. Referenzen vorhanden.",
    "Gesucht: Nachhilfelehrer Mathe (m/w/d) für Gymnasium. Bezahlung: 15 Euro/Stunde.",
    "Notfallklempner 24h: Rohre, Heizung, Abfluss. Auch sonn- und feiertags erreichbar.",
    "Stadtführungen für Gäste: Jeden Samstag 11 Uhr am Marktplatz. Kostenlos!",
    "Hostel Altstadt: Günstige Übernachtung ab 18 Euro/Nacht. Zentrale Lage.",
    "Kochkurs asiatische Küche: Freitags 18 Uhr. Anmeldung erforderlich, 30 Euro.",
    "Auto kaufen/verkaufen: Gebrauchtwagen Markt jeden Sonntag ab 8 Uhr.",
    "Töpferkurs für Anfänger: Samstagnachmittag. VHS. Materialkosten inklusive.",
  ],
  [
    "Hundebetreuung Waldläufer: Liebevolle Betreuung für Ihren Hund während Ihrer Abwesenheit.",
    "Möbel kostenlos abzugeben: Sofa, Schränke, Tisch. Selbstabholung. Anruf genügt.",
    "Hochzeitsfotografie Lena Fischer: Besondere Momente, zeitlos festgehalten. Portfolio online.",
    "Stellenangebot: Köchin/Koch gesucht für Restaurant Zur Mühle. Vollzeit, faire Bezahlung.",
    "Computerkurs für Senioren: Einstieg in PC und Internet. Volkshochschule, dienstags 14 Uhr.",
    "Nichtraucherprogramm: Gruppentherapie und Einzelberatung. Erste Sitzung kostenlos.",
    "Werbeagentur MediaBlue sucht Praktikanten (m/w/d) für 3 Monate. Bezahlt.",
    "Sprachreisen England: Englisch lernen direkt vor Ort. Sommer- und Herbstprogramm.",
    "Fahrschule Schmidt: Alle Führerscheinklassen. Flexible Zeiten. Jetzt anmelden.",
    "Weinverkostung: Samstag 18 Uhr im Weinkeller. Anmeldung erforderlich. 25 Euro.",
  ],
  [
    "Dr. Hausmann – Allgemeinmedizin: Auch Hausbesuche für immobile Patienten möglich.",
    "Musikschule Melodie: Gitarrenunterricht für Fortgeschrittene. Einzelstunden und Gruppen.",
    "Ferienwohnung Strandkorb: Direkt am Meer, 4-Personen-Apartment. Juli/August frei.",
    "Grundschule Sonnenschein sucht Lehrkraft (m/w/d). Bewerbung bis 30. April.",
    "Gartengestaltung Gründesign: Planung und Umsetzung für private Gärten aller Größen.",
    "Buchclub Literaturfreunde: Monatliches Treffen, offene Mitgliedschaft. Nächstes Treffen Donnerstag.",
    "Stadtordnungsamt: Hundeummeldung nach Umzug – Formular online oder persönlich.",
    "Pilates-Kurs: Für alle Niveaus, dreimal wöchentlich. Probestunde kostenlos.",
    "Geigenstunden: Klassische Ausbildung für Kinder und Erwachsene. VHS.",
    "Stadtbibliothek: Kostenlose E-Books für alle Ausweisinhaber ab sofort verfügbar.",
  ],
];

const getGoetheB1AdvertisementBank = (seriesNumber) => {
  const bankIndex = seriesNumber <= 3 ? seriesNumber - 1 : 3 + ((seriesNumber - 4) % 3);
  return banks[bankIndex].map((label, index) => ({
    value: String.fromCharCode(97 + index),
    label,
  }));
};

module.exports = { getGoetheB1AdvertisementBank };
