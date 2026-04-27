export default function Landing() {
  return (
    <div>

      {/* HERO */}
      <section className="bg-gradient-to-r from-yellow-100 to-red-100 p-10 flex items-center justify-between">

        <div className="max-w-xl">
          <h1 className="text-4xl font-bold mb-4">
            Dominez l’examen d’allemand.
          </h1>

          <p className="mb-6 text-gray-600">
            Transformez votre stress en automatisme grâce à nos simulations réalistes.
          </p>

          <button className="bg-yellow-500 text-white px-6 py-3 rounded-full">
            Lancer ma simulation →
          </button>
        </div>

        <img
          src="https://via.placeholder.com/400"
          alt="hero"
          className="rounded-xl"
        />

      </section>

    </div>
  );
}
{/* STATS */}
<section className="grid grid-cols-3 gap-6 p-10 text-center">

  <div className="shadow p-5 rounded">
    <h2 className="text-2xl font-bold">1000+</h2>
    <p>Etudiants</p>
  </div>

  <div className="shadow p-5 rounded">
    <h2 className="text-2xl font-bold">99%</h2>
    <p>Taux de réussite</p>
  </div>

  <div className="shadow p-5 rounded">
    <h2 className="text-2xl font-bold">4.9/5</h2>
    <p>Note moyenne</p>
  </div>

</section>
{/* SERVICES */}
<section className="p-10">

  <h2 className="text-2xl font-bold text-center mb-6">
    Nos services
  </h2>

  <div className="grid grid-cols-2 gap-6">

    <div className="shadow p-5 rounded">
      <p>Simulations complètes d’examen</p>
    </div>

    <div className="shadow p-5 rounded">
      <p>Entraînement audio professionnel</p>
    </div>

    <div className="shadow p-5 rounded">
      <p>Correction écrite IA</p>
    </div>

    <div className="shadow p-5 rounded">
      <p>Analyse vocale avancée</p>
    </div>

  </div>

</section>
{/* PRICING */}
<section className="p-10 text-center">

  <h2 className="text-2xl font-bold mb-6">Nos forfaits</h2>

  <div className="grid grid-cols-3 gap-6">

    <div className="border p-6 rounded">
      <h3 className="text-xl font-bold">Bronze</h3>
      <p className="text-2xl">$30.99</p>
      <button className="bg-yellow-500 text-white px-4 py-2 mt-4 rounded">
        Paiement
      </button>
    </div>

    <div className="border p-6 rounded">
      <h3 className="text-xl font-bold">Silver</h3>
      <p className="text-2xl">$45.99</p>
      <button className="bg-yellow-500 text-white px-4 py-2 mt-4 rounded">
        Paiement
      </button>
    </div>

    <div className="border p-6 rounded">
      <h3 className="text-xl font-bold">Gold</h3>
      <p className="text-2xl">$99.99</p>
      <button className="bg-yellow-500 text-white px-4 py-2 mt-4 rounded">
        Paiement
      </button>
    </div>

  </div>

</section>
{/* TESTIMONIALS */}
<section className="p-10 text-center">

  <h2 className="text-2xl font-bold mb-6">
    Avis de nos candidats
  </h2>

  <div className="flex justify-center gap-6">

    <div className="shadow p-4 rounded">
      <p>Excellent outil !</p>
    </div>

    <div className="shadow p-4 rounded">
      <p>Très réaliste.</p>
    </div>

  </div>

</section>
{/* CONTACT */}
<section className="p-10">

  <h2 className="text-2xl font-bold text-center mb-6">
    Contactez-nous
  </h2>

  <form className="max-w-md mx-auto flex flex-col gap-4">

    <input placeholder="Nom" className="border p-2" />
    <input placeholder="Email" className="border p-2" />
    <textarea placeholder="Message" className="border p-2" />

    <button className="bg-yellow-500 text-white p-3 rounded">
      Envoyer
    </button>

  </form>

</section>
