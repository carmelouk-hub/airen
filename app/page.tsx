export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ fontSize: "3rem", marginBottom: "1rem" }}>
        AIRen – Sistema in Caricamento
      </h1>
      <p style={{ fontSize: "1.2rem", opacity: 0.8 }}>
        Architettura collegata con successo. <br />
        Repository GitHub sincronizzato. <br />
        Vercel attivo. <br />
        Stiamo preparando l’interfaccia del tuo ecosistema.
      </p>
    </main>
  );
}

