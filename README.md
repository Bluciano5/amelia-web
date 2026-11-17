# AmélIA — tutor di francese (web app per iPhone)

Web app installabile sulla schermata Home di iPhone (Safari → Condividi → Aggiungi alla schermata Home).
Conversazione vocale in francese con correzioni grammaticali e di pronuncia, livello adattivo, riepiloghi e storico.

- Nessun build: HTML, CSS e moduli JavaScript statici, pubblicati con GitHub Pages.
- La Gemini API key si inserisce nelle Impostazioni e resta solo nel browser del dispositivo (localStorage). Il repository non contiene chiavi.
- Audio: push-to-talk registrato in WAV 16 kHz e inviato a Gemini, che trascrive, corregge e valuta la pronuncia.
- Voce: Gemini TTS (neurale) con la sintesi vocale di sistema come riserva.

Versione Android (stesso progetto, app SonIA/AmélIA): repository privato `progetto_SonIA`.
