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
