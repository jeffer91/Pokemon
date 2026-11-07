# PokéRadar GTL — Fase 1 (v0.2.0)

Aplicación Electron para Windows 11 con **interfaz clara**, botones **Play / Stop**, indicador flotante pasivo y base SQLite local.

## Iniciar

Requiere Node.js 24+ y Git. En PowerShell:

```powershell
cd D:\Pokemon
git pull origin main
npm install
npm start
```

Para verificar el proyecto:

```powershell
npm run check
npm test
```

## Uso

1. En **Ajustes**, confirma que verificaste las condiciones aplicables al juego y configura una cuota conservadora de publicación GTL (en Pokéyenes).
2. Pulsa **Play**. La ventana principal se minimiza y aparece una pestaña pequeña y flotante de **Radar**. Sin Play no se captura ni se analiza el juego.
3. Fuera del GTL, la aplicación revisa únicamente la zona superior del mercado con menor frecuencia. Cuando detecta el GTL, intenta leer sus diez filas.
4. En el GTL, solo aparecen etiquetas **COMPRAR / NO COMPRAR** junto a los anuncios para los que el sistema tenga información suficiente. Si falta evidencia, no muestra recomendación.
5. Al salir del GTL, la pestaña se reduce de nuevo. Para detener todo, restaura PokéRadar desde la barra de tareas y pulsa **Stop**.
6. **Buscar** propone búsquedas para enriquecer los datos; **Historial** muestra evaluaciones y operaciones confirmadas; **Ajustes** concentra las configuraciones.

## Arquitectura

- `src/main.js`: sesión Play / Stop, captura adaptativa y ventanas.
- `src/scan-policy.js`: intervalos y regiones pequeñas de lectura.
- `src/recognition.js`: OCR local con Tesseract.js.
- `src/window-locator.js`: coordenadas del cliente en Windows.
- `src/database.js`: SQLite, WAL, integridad y respaldos.
- `src/market.js`: comparables, margen neto, reserva de liquidez del 30 %.
- `src/ui/`: interfaz clara e indicador flotante transparente.
- `tests/`: pruebas automáticas.

## Limitaciones y seguridad

Esta versión **no se ha probado todavía en tu Windows 11 con PokéMMO abierto**. El tiempo inferior a un segundo y el objetivo de que el juego no pierda fluidez requieren medición y calibración reales. El reconocimiento OCR puede tardar más de un segundo, sobre todo si el equipo es limitado.

La aplicación no pulsa teclas, no hace clic, no compra, no inyecta código ni intercepta tráfico. La ventana flotante es pasiva y deja pasar clics. Verifica las condiciones de PokéMMO: su independencia de la franquicia oficial no significa que carezca de reglas aplicables.

Una publicación observada o desaparecida **no prueba una venta**. La recomendación exige referencias comparables, cuota configurada y saldo visible. No está garantizada la liquidez ni la rentabilidad. Las imágenes se procesan localmente; el historial se guarda en la base SQLite, no en GitHub.
