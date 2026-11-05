# «vale» counter 🎤

Contador colaborativo, en tiempo real, de las veces que un ponente dice **«vale»**.
Pensado para equipos de unas 10 personas: cada uno con su móvil, una pantalla proyectando.

## Cómo se juega

1. **Quien proyecta** abre la web y pulsa *Crear sala en esta pantalla*. Aparece un QR y un código de sala.
2. **Cada asistente** escanea el QR, pone su nombre y **apuesta** cuántos «vales» dirá el ponente.
3. Se escribe el nombre del ponente y se pulsa **¡Empezar!**
4. Cada vez que oyes un «vale», pulsas el botón gigante (o la barra espaciadora).
   **Solo cuenta si al menos 2 personas pulsan en menos de 2 segundos.** Así se evitan los graciosos.
5. Al terminar se genera un **informe final** que se puede copiar en Markdown y pegar en Slack, Teams o el README.

## Qué tiene

- **Consenso**: un «vale» necesita 2 pulsaciones de personas distintas en 2 s. Aviso en vivo de «Fulano ha oído un vale, ¿lo confirmas?».
- **Apuestas previas**: gana quien más se acerque. Si alguien la clava, desbloquea *Oráculo*.
- **Rachas y logros**: Primera sangre, Metralleta (3 en 10 s), Minuto de oro (5 en un minuto), Decena, Medio centenar, Centenar, Silencio sepulcral (2 min sin «vales»), Reflejos felinos (primero en pulsar 5 veces).
- **Gráfica en vivo** de «vales» por minuto.
- **Podio de reflejos**: quién pulsa primero más veces.
- **Informe final** con total, duración, ritmo, minuto más intenso, apuestas, podio y logros.

## Cómo funciona por dentro

Web 100 % estática en JavaScript puro, sin backend ni base de datos.

- La pantalla del anfitrión (`?host&room=XXXX`) ejecuta el juego ([`public/game.js`](public/game.js)) y hace de servidor.
- Los móviles se conectan a ella por WebRTC con [PeerJS](https://peerjs.com/), usando su servidor público de señalización.
- El estado de la sala se guarda en el `localStorage` del anfitrión: si recarga la página, la partida sigue.

> ⚠️ La pestaña del anfitrión tiene que quedarse abierta durante la charla.
> Si alguna red corporativa bloquea WebRTC, conectad los móviles a la misma wifi.

## Desarrollo

```bash
npm start   # sirve public/ en http://localhost:3000
npm test    # pruebas de la lógica del juego
```

Despliegue: cualquier hosting estático. En Vercel basta con `vercel deploy --prod` (usa `vercel.json`).

Parámetros del juego en `public/game.js` (`DEFAULTS`): personas para consenso, ventana, cooldown y tiempo de silencio.

## Ideas para contribuir

Cada persona del equipo puede llevarse una:

- 🔊 Sonidos personalizados por logro.
- 🃏 Bingo de muletillas («o sea», «¿no?», «básicamente»).
- 🏛️ Hall of fame histórico por ponente.
- 📈 Comparativa entre charlas de la misma persona para ver si mejora.
- 🌗 Modo claro.
- 📤 Exportar el informe como imagen para compartir.

## Licencia

MIT
