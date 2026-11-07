# PokéRadar GTL — Fase 1

Aplicación de escritorio para Windows 11, desarrollada con **Electron 45 + SQLite local (node:sqlite)** y reconocimiento visual mediante **Tesseract.js**. Su propósito es guardar observaciones del GTL y evaluar anuncios con criterios de margen neto, comparabilidad y reserva de liquidez.

> **Importante — normas de PokeMMO:** el reglamento prohíbe la automatización y cualquier herramienta que proporcione ventaja injusta. **No se ha confirmado que un radar de lectura visual en vivo esté autorizado.** La captura se entrega **desactivada por defecto**. Consulta con soporte antes de habilitarla. La aplicación no mueve el ratón, no pulsa teclas ni botones del juego, no inyecta código, no inspecciona procesos ni intercepta tráfico. La autorización no está garantizada por estas precauciones.
>
> Normativa: https://support.pokemmo.com/knowledgebase/article/penalty-policy

## Instalación

Necesitas Windows 11, Node.js **24 o posterior**, NPM y una conexión para instalar las dependencias. Abre el repositorio en VS Code y ejecuta:

```powershell
npm install
npm start
```

Para pruebas automáticas:

```powershell
npm run check
npm test
```

La app crea la base `pokeradar.sqlite` y los respaldos diarios en su carpeta de datos de usuario de Electron. La base no se almacena en el repositorio. SQLite usa WAL, transacciones, integridad y claves foráneas; si una base está dañada, la app se detiene sin sustituirla en silencio.

## Primer uso

1. Abre el **panel de PokéRadar** y configura una estimación **conservadora y verificada** de la cuota de publicación del GTL, que puede variar con el precio. Si no hay cuota configurada, no se emitirán compras.
2. Revisa las reglas del juego con su soporte. La aplicación no empieza a observar automáticamente hasta que actives la lectura bajo tu responsabilidad.
3. Abre PokéMMO en ventana normal, GTL → Anuncios de Pokémon. El radar trata de reconocer hasta 10 filas y guardar solo lecturas completas (especie, nivel, naturaleza, seis IV y precio).
4. Usa las **búsquedas guiadas** para construir referencias de mercado. Un anuncio observado no equivale a una venta confirmada, y una desaparición no confirma una venta.
5. El indicador aparece fuera de la tabla y es atravesable por el ratón. En caso de lectura incompleta, **permanece en silencio**, en lugar de recomendar algo sin evidencia.
6. Usa el panel de operaciones para registrar compras y ventas **realmente confirmadas**; no se infieren automáticamente de anuncios desaparecidos.

## Qué está implementado

- Interfaz Electron, panel de control e indicador lateral transparente, alineación inicial según la captura aportada y desplazamientos X/Y configurables.
- Detección de la ventana de PokéMMO, observación visual por `desktopCapturer`, lectura OCR local, detección básica de GTL vs búsqueda avanzada.
- Observaciones persistentes, metadatos de búsqueda, referencias comparables y sugerencias de búsqueda para empezar a poblar SQLite.
- Motor determinista: comisiones configurables, comparables recientes, ganancia neta, descuento, balance visible y **reserva del 30 %**.
- Historial de decisiones, saldo observado y operaciones confirmadas registradas manualmente.
- Pruebas unitarias de SQL, persistencia, reglas económicas y procesamiento del texto OCR.

## Limitaciones honestas de esta primera versión

- **No se ha validado sobre tu máquina ni con la ventana real de PokéMMO.** La cuadrícula OCR parte de las capturas facilitadas (aprox. 1680×900). Escala, fuentes, animaciones, idioma o cambios en interfaz pueden hacer que una fila se omita. Puedes ajustar la posición de la superposición desde el panel.
- El objetivo de respuesta inferior a **1 segundo no está demostrado**: OCR puede tardar varios segundos; el tiempo real se muestra en la interfaz. No hay promesa de detección garantizada de una ganga fugaz.
- El lector de texto requiere todos los IV y datos reconocidos con confianza; si falta cualquier campo, no emite recomendación. Sexo/identidad individual del anuncio no están garantizados.
- **No hay API del GTL**, ni datos históricos reales precargados: al inicio las recomendaciones permanecen en silencio hasta reunir suficientes comparables.
- La velocidad real de venta **no puede demostrarse** solo observando anuncios. La puntuación mide confianza del precio, no probabilidad estadística de vender en 24 horas.
- La cuota exacta puede variar según el precio del anuncio; el parámetro de la app es una **estimación de cuota**, que debes verificar antes de invertir.
- Se utiliza una firma de atributos como **identidad aproximada**, no como ID real de publicación. Dos anuncios iguales pueden agruparse; las desapariciones no prueban ventas.
- `node:sqlite` requiere la versión Node incorporada en Electron 45 (24.x). No usa compilaciones nativas de terceros.
- El seguimiento de evolución del equipo, crianza avanzada y Ligas pertenece a la **fase 2**.

## Organización del código

```
src/main.js           Electron, lectura y superposición
src/database.js       SQLite, migraciones, observaciones y respaldo
src/market.js         Evaluación económica conservadora
src/recognition.js    OCR y extracción de columnas del GTL
src/window-locator.js Ubicación Windows de la ventana PokeMMO
src/preload.js        API segura entre interfaz y proceso principal
src/ui/               Panel de control y superposición

tests/                Pruebas automáticas
```

## Seguridad y privacidad

Toda la información de los anuncios se procesa y guarda en el equipo local. Tesseract utiliza sus datos OCR instalados por NPM; no hace falta cargar imágenes a una API de terceros. No se guardan las capturas de pantalla originales. El programa no efectúa compras.

Este es un **primer prototipo funcional para pruebas y calibración**, no un radar de mercado comprobado ni una garantía de rentabilidad.
