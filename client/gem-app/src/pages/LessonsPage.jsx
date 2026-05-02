import { useMemo, useState } from "react";
import { BookOpen, Clock3, Layers, Library, ListChecks } from "lucide-react";
import BackButton from "../components/BackButton";
import { useLanguage } from "../context/LanguageContext";
import styles from "./LessonsPage.module.css";

export default function LessonsPage() {
  const { t } = useLanguage();
  const books = t.lessons.books;
  const [selectedId, setSelectedId] = useState(books[0]?.id ?? "grammar");

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedId) ?? books[0],
    [books, selectedId]
  );

  return (
    <div className={styles.page}>
      <main className={styles.shell}>
        <BackButton fallback="/dashboard" />

        <header className={styles.header}>
          <span className={styles.badge}>
            <Library size={18} />
            {t.common.lessons}
          </span>
          <h1>{t.lessons.title}</h1>
          <p>{t.lessons.subtitle}</p>
        </header>

        <div className={styles.layout}>
          <aside className={styles.bookList}>
            <div className={styles.sectionTitle}>
              <BookOpen size={18} />
              {t.lessons.choose}
            </div>
            {books.map((book) => (
              <button
                key={book.id}
                type="button"
                className={`${styles.bookCard} ${book.id === selectedBook.id ? styles.active : ""}`}
                onClick={() => setSelectedId(book.id)}
              >
                <strong>{book.title}</strong>
                <span>{book.topic}</span>
                <small>
                  {t.lessons.level} {book.level} · {book.minutes}
                </small>
              </button>
            ))}
          </aside>

          <article className={styles.reader}>
            <div className={styles.readerMeta}>
              <span><Layers size={16} /> {t.lessons.level} {selectedBook.level}</span>
              <span><Clock3 size={16} /> {t.lessons.readingTime} {selectedBook.minutes}</span>
            </div>
            <h2>{selectedBook.title}</h2>
            <p className={styles.summary}>{selectedBook.summary}</p>

            <div className={styles.topicBox}>
              <span>{t.lessons.topics}</span>
              <strong>{selectedBook.topic}</strong>
            </div>

            <section className={styles.notes}>
              <h3>
                <ListChecks size={20} />
                {t.lessons.notes}
              </h3>
              <ol>
                {selectedBook.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ol>
            </section>
          </article>
        </div>
      </main>
    </div>
  );
}
