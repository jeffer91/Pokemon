# PokéRadar GTL — Fase 1 (v0.2.1)

Aplicación de escritorio Electron para Windows 11. **Play** inicia una sesión de lectura visual del GTL, sin formularios de cuota ni posiciones X/Y, y muestra un pequeño radar flotante. No realiza compras ni controla el cliente del juego.

## Actualizar en D:

```powershell
cd D:\Pokemon
git pull origin main
npm install
npm start
```

Requisitos: Node.js 24+ y npm. Para comprobar cambios:

```powershell
npm run check
npm test
```

## Uso

1. Pulsa **Play**. La ventana principal se minimiza y el indicador compacto aparece. Ya no se exige marcar una casilla ni escribir un importe.
2. Al abrir GTL → Anuncios de Pokémon, la app intenta reconocer las 10 filas visibles. Se alinea automáticamente con los botones Comprar observados; si no hay suficientes referencias, utiliza una posición relativa al juego.
3. Si existen suficientes precios comparables, saldo reciente y margen neto estimado positivo, puede mostrar **COMPRAR** o **NO COMPRAR**. Con datos incompletos, no recomienda.
4. Al salir del GTL se compacta. Para detenerla, restaura PokéRadar desde la barra de tareas y pulsa **Stop**.
5. En **Buscar** verás sugerencias para poblar el historial. En **Historial** puedes consultar registros y confirmar operaciones.

## Cuota estimada automáticamente: advertencia importante

La documentación de soporte confirma que la cuota de publicación depende del precio y tiene un **máximo de 25.000 ¥**, pero no publica una fórmula actual completa:
https://support.pokemmo.com/knowledgebase/article/the-gtl-system

Una guía histórica de la comunidad menciona 5 %, mínimo de 1.000 ¥ para Pokémon y máximo de 25.000 ¥:
https://forums.pokemmo.com/index.php?/topic/135773-money-making-methods-comparison/

Por precaución, la versión 0.2.1 **estima una cuota de 5 % del precio de reventa MÁS 1.000 ¥, limitada a 25.000 ¥**. Esto **no es una tarifa oficial confirmada**, y puede sobrestimar o subestimar el importe real en circunstancias distintas. Se eliminaron los campos manuales, no la incertidumbre del mercado. Hay que contrastar periódicamente la estimación con la cuota que muestra Crear Anuncio antes de invertir dinero. El historial registrado no garantiza ventas rápidas.

## Fiabilidad y límites

La reserva de saldo es del **30 %**. SQLite conserva anuncios e historial con WAL y comprobación de integridad; las capturas no se almacenan. Las recomendaciones anteriores se ocultan al cambiar la pantalla.

**Todavía no se ha probado esta actualización con PokéMMO ejecutándose en tu Windows 11.** El reconocimiento por OCR puede superar el objetivo de un segundo y el impacto sobre FPS requiere medición real. El posicionamiento automático está basado en reconocimiento de botones y un respaldo proporcional, por lo que puede necesitar calibración si cambias la interfaz.

La ventana flotante no recibe clics. La app no hace clic, no automatiza compras, no lee memoria del juego ni intercepta tráfico. El hecho de que PokéMMO no sea oficial de Nintendo no elimina sus reglas de uso; comprueba las condiciones aplicables.

## Organización

- `src/main.js`: sesión Play/Stop, ventana flotante y captura adaptativa.
- `src/recognition.js`: reconocimiento GTL, información de anuncios y posición de botones.
- `src/market.js`: evaluación económica y cuota conservadora automática.
- `src/database.js`: SQLite y respaldos.
- `src/ui/`: interfaz clara, mínima y sin configuraciones manuales.
- `tests/`: pruebas automatizadas.

## Radar compacto — diagnóstico de lectura

- **Radar**: esperando detectar el GTL. Se reintenta el reconocimiento del título cada 6 segundos, aunque la imagen no cambie.
- **GTL 0/10**: se detectó el mercado, pero no hay filas completamente reconocidas; se requiere calibración del OCR.
- **GTL N/10**: se reconocieron N filas; si no aparecen decisiones todavía, faltan datos comparables o saldo confiable. No se inventan recomendaciones.

La pestaña pequeña se sitúa en el espacio libre dentro de la ventana del juego, evitando los controles de Windows.

## v0.3.0: captura comprobada y diagnóstico automático

1. Pulsa **Play**. El estado cambia a **Pantalla captada** solo cuando se recibe una imagen útil de PokéMMO, no por crear una ventana flotante.
2. Abre **GTL → Anuncios de Pokémon**. Un detector de geometría y color, contrastado con capturas de noviembre de 2026, intenta identificar el mercado incluso si el OCR del título falla.
3. La pestaña flotante muestra **GTL N/10** cuando hay N filas completas. Los resultados NO COMPRAR por presupuesto pueden emitirse cuando el precio es legible, incluso si falta algún IV. COMPRAR exige precios comparables.
4. En la pestaña **Diagnóstico** se comprueban Ventana, Captura, GTL, OCR, Base SQLite y Evaluación. **Copiar diagnóstico** genera un informe técnico con códigos y tiempos sin guardar pantallas ni conversaciones.
5. SQLite migra automáticamente del esquema 1 al 2 preservando todo el historial. Conserva cada barrido y las filas parciales en tablas separadas para no contaminar los precios válidos. Las páginas que no puede identificar quedan como desconocidas, no como página 1.

El OCR sigue necesitando calibración y pruebas en tu Windows 11. El objetivo de respuesta inferior a un segundo no está garantizado. La comisión continúa siendo una estimación conservadora, no una tarifa oficial verificada.

## v0.3.1 — Captura de Windows con respaldo

- El radar intenta primero la captura directa de la ventana de **PokéMMO**. Cuando Electron devuelve una miniatura vacía o no enumera la ventana, utiliza la geometría del cliente obtenida mediante Windows y captura únicamente ese rectángulo desde el monitor correspondiente.
- Los errores de diagnóstico distinguen `WIN-NOT-FOUND`, `CAP-NO-GEOMETRY`, `CAP-SCREEN-EMPTY`, `CAP-RECT` y `CAP-SCREEN-BLANK`. El estado indica también `CAP-WINDOW` o `CAP-SCREEN` cuando obtiene una imagen útil.
- El detector GTL ya no depende de siete puntos de referencia estrictos. Comprueba además la proporción del panel azul grisáceo, calibrada con las capturas de la interfaz de noviembre de 2026.
- La localización de la ventana espera una búsqueda ya iniciada en vez de devolver un resultado nulo prematuro. No se automatizan clics ni compras.
- Los dos métodos de captura solo funcionan después de Play y el recorte de pantalla se mantiene en memoria. **Si necesitas comprobar si funciona realmente en tu equipo, abre Diagnóstico y pulsa Copiar diagnóstico.**
- **Limitación:** no se ha ejecutado el cliente real de PokéMMO en el entorno de desarrollo. La compatibilidad y los FPS deben verificarse en tu Windows 11; el motor OCR aún puede requerir ajustes con datos reales.
