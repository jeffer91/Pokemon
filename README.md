# PokéRadar GTL — v0.12.0

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

## v0.4.0 — Comparación real de cinco motores de captura

En la pestaña **Diagnóstico**, pulsa **Probar 5 motores** con PokéMMO abierto, preferiblemente mostrando el GTL. PokéRadar minimiza su ventana temporalmente para que los motores de pantalla puedan ver el juego, prueba cada uno, restaura el panel y presenta:
- Código de resultado y duración de cada motor.
- Imagen captada o error exacto; resolución de la imagen.
- Señal visual del GTL y porcentaje de coincidencia del panel.
- Motor seleccionado automáticamente entre los que hayan obtenido imagen válida.

Métodos implementados dentro de los archivos existentes:
1. Electron Window: fuente de ventana por nombre.
2. Electron Screen + Win32: monitor recortado con coordenadas de ventana obtenidas de Windows.
3. Electron Screen Visual: búsqueda del panel GTL directamente en monitores, sin depender del nombre de ventana.
4. GDI CopyFromScreen: alternativa nativa de Windows, con proceso PowerShell temporal para captura.
5. Win32 PrintWindow: captura de ventana mediante Win32, que puede fallar con juegos acelerados.

Los motores 4 y 5 son más costosos y solo se utilizan continuamente si una prueba los selecciona. El motor preferido se guarda en SQLite y se reutiliza en sesiones posteriores.

**Windows Graphics Capture y DXGI Desktop Duplication no están implementados como backends nativos** porque requieren adaptadores compilados adicionales: no se presentan como pruebas exitosas ni se sustituyen silenciosamente. La versión 0.4.0 integra cinco estrategias funcionalmente distintas compatibles con los componentes ya existentes, sin añadir archivos al repositorio.

Cuando falla la captura, sigue apareciendo el código exacto. Ningún motor puede garantizar una imagen de un juego tapado por otra aplicación: los resultados se comprueban en tu Windows 11. La aplicación no automatiza clics ni compras. El informe copiado no incluye píxeles ni nombres de otras ventanas.

## v0.4.1 — Estabilización de la captura GTL y calidad de referencias

- El motor visual mantiene la captura de pantalla cuando se cierra o se oculta el GTL. `VIS-IDLE` es un estado normal, no un error de captura. Los motores en espera no registran automáticamente `CAP-NO-ENGINE`.
- El panel del GTL se detecta por su franja de encabezado azul grisáceo en cualquier lugar del monitor; su posición real determina el recorte OCR y las coordenadas del indicador flotante. No se aplica una rejilla de pantalla de juego a imágenes de monitor completo.
- El OCR usa columnas y filas relativas al panel. Los valores con confianza insuficiente, IV fuera de rango o naturalezas desconocidas se guardan exclusivamente como lecturas parciales.
- La lectura de sexo examina solo los colores del pequeño glifo de género, sin considerar los sprites. Si no es confiable, se mantiene como desconocido; no puede emitirse COMPRAR para sexo desconocido.
- SQLite migra de esquema 2 a 3 sin borrar el historial. Las filas históricas quedan inicialmente como no verificadas y **no se usan como comparables**. Una oferta OCR con datos válidos debe confirmarse en dos lecturas separadas por la ventana antiduplicados para utilizar su precio en evaluaciones.
- El Historial muestra Pokémon, precio y razón de la decisión. Las evaluaciones idénticas de una oferta no se insertan repetidamente durante una hora.
- La app continúa sin comprar ni manipular el juego. El tiempo de OCR inferior a un segundo y 10/10 anuncios correctos no pueden garantizarse sin pruebas en Windows 11.

**Prueba recomendada:** abre PokéMMO con el GTL visible, pulsa Play, recorre dos páginas lentamente, vuelve a la primera tras unos segundos, entra a Diagnóstico y pulsa Copiar diagnóstico. Debe señalar captura válida, GTL localizado, cantidad de filas OCR y confirmaciones en SQLite. Cambiar a otra ventana no debe contarse como avería de captura.

## v0.5.0 — Equipo ideal, precios filtrados y calificaciones persistentes

- **Equipo ideal:** seis titulares y seis suplentes editables en los criterios de naturaleza, nivel, IV obligatorios y estado. Gengar está excluido porque requiere intercambio; Scolipede ocupa su lugar como propuesta. Garchomp continúa como objetivo adicional sin alterar automáticamente la alineación.
- **Tipos:** muestra duplicidades y debilidades compartidas en los seis titulares y posibles rotaciones que las reduzcan, sin sustituir a nadie de forma automática.
- **Precios ideales:** consultas de la misma base SQLite para especies objetivo (normalmente preevoluciones). Separa **Compra directa** (naturaleza + IV + nivel configurados) y **Crianza** (IV heredables de la especie objetivo). Incluye mínimo/mediana/número de comparables verificados y la fecha de última observación. Las cotizaciones previas del Sheets tienen una etiqueta propia: NO son ofertas actuales.
- **Calificaciones independientes:** la etiqueta de cada fila informa nota de **IV** o **AJUSTE** al objetivo, más la recomendación de reventa (COMPRAR, NO COMPRAR o PENDIENTE), con motivo legible. El motor continúa sin recomendar compras sin referencias de mercado suficientes y sin respetar la reserva del 30%.
- **Persistencia visual:** no se ocultan las etiquetas al iniciar OCR. Ante una lectura incompleta de la misma página se retienen las evaluaciones anteriores; ante un cambio material de imagen, se actualiza la página. Las etiquetas desaparecen al salir del GTL.
- **Seguridad de los datos:** esquema SQLite v4; en la migración se conservan los registros pero se reclasifican sus precios como pendientes hasta volver a observarlos en al menos dos lecturas separadas 60 segundos. No deduce ventas confirmadas de anuncios desaparecidos. Los cambios de objetivos se guardan localmente en settings.
- **Limitaciones:** el OCR no puede confirmar habilidades, grupos huevo, ventas reales ni disponibilidad de una publicación. El precio calculado para crianza contempla solo ejemplares de la especie objetivo con IV heredables; no calcula todavía un árbol completo entre especies. La nota IV no es una valoración integral del potencial competitivo. La respuesta inferior a 1 segundo sigue requiriendo mejoras y pruebas reales en Windows 11.

Prueba: actualiza con `git pull origin main`, luego `npm install`, `npm run check`, `npm test`, `npm start`. Comprueba Equipo ideal → edita un objetivo → guarda → reinicia. En Precios ideales, revisa los datos confirmados. Abre GTL, pulsa Play y cambia de página para verificar que las etiquetas no parpadeen ni queden sobre anuncios anteriores.

## v0.6.0 — Primer lote Pokédex ideal + sugerencias de mercado

Se incorporan diez perfiles de **Staryu, Riolu, Sandile, Litwick, Shroomish, Magnemite, Swinub, Dratini, Magikarp y Gible**, con naturalezas iniciales, IV prioritarios, objetivo avanzado, habilidades normales y ocultas de la etapa básica/final y restricciones de crianza. Cada lote futuro se añade con versiones de catálogo sin borrar las cotizaciones o las preferencias del usuario.

El nuevo apartado **Pokédex ideal** muestra los diez perfiles y permite filtrar por nombre y ataque físico/especial. Las habilidades ocultas se muestran con el estado **disponibilidad sin verificar**: el OCR de la tabla GTL no reconoce habilidades. No se debe inferir que una oferta tenga la habilidad necesaria ni que la habilidad oculta esté a la venta.

El apartado **Buscar** combina referencias de mercado verificadas (naturaleza, seis IV, grupo de nivel y sexo comparables) con perfiles que necesitan muestras y especies con muchos anuncios observados. La existencia de anuncios, su desaparición o su antigüedad **no equivalen a ventas confirmadas**. Los precios mínimos y las medianas proceden de SQLite, no de supuestas consultas remotas. Un grupo necesita al menos cinco precios verificados antes de considerarse contrastable, y aun así solo sirve para investigar posibles ofertas.

En **Equipo ideal**, cada tarjeta tiene un botón **Lo tengo / Me falta** que guarda el estado directamente en SQLite, sin alterar naturaleza ni IV configurados. Sigue habiendo seis titulares, seis suplentes (Scolipede provisional en lugar de Gengar) y Garchomp como objetivo adicional.

La detección del GTL prioriza la franja superior y extrapola el centro de la primera fila aunque el OCR no reconozca el primer botón Comprar; esto evita un desplazamiento de una fila en las etiquetas flotantes. Las etiquetas muestran puntuación y explicación en una misma fila, con presentación compacta si el espacio es pequeño, y no se ocultan por un ciclo normal de OCR.

SQLite se migra sin destruir registros al esquema **v5** y crea `catalog_profiles`, con datos versionados. La recomendación `COMPRAR` sigue requiriendo muestras suficientes, presupuesto disponible tras reservar el 30 %, márgenes netos estimados y comprobación manual de la habilidad para objetivos competitivos.

**Validación local:** `git pull origin main`, `npm install`, `npm run check`, `npm test`, `npm start`. Para verificar alineación, abre el GTL y cambia entre distintas páginas. Si una etiqueta no coincide con su fila, envía pantalla y diagnóstico; esta versión no ha podido ejecutarse en el PC del usuario.

## v0.6.1 — Correcciones de captura alternativa y diagnóstico OCR

- **Tres familias de captura:** Electron Ventana, Electron Pantalla visual y Windows GDI (captura del escritorio virtual). Win32 Pantalla recorta desde coordenadas de Windows y PrintWindow es respaldo adicional. La captura GDI no necesita localizar la ventana por título; Win32 y PrintWindow admiten tanto `PokéMMO` como `PokeMMO`. Si un backend deja de funcionar, el siguiente puede tomar el relevo automáticamente, con enfriamientos para evitar lanzar PowerShell cada 650 ms.
- **Límite de verificación:** solo se pueden declarar motores **probados en Windows** después de ejecutar “Probar 5 motores” con el GTL visible y comprobar imagen, detección y latencia individuales. Un motor que solo funciona con capturas sintéticas no se debe anunciar como validado en el equipo.
- **Lectura de anuncios:** tolerancia OCR de caracteres con validación de nivel, naturaleza, seis IV (0–31), precio, y soporte para nombres con símbolo de sexo como Nidoran♂. Si no se valida cualquier campo, la fila se guarda como parcial; nunca se utiliza para comparables. La confirmación de precio sigue requiriendo observaciones independientes.
- **Diagnóstico por fila:** muestra cada especie, precio, seis IV, campos inválidos y razón precisa para bloquear la inserción. “Copiar diagnóstico” incluye diez filas de lectura y el estado del saldo sin guardar imágenes.
- **Saldo HUD:** lectura sobre recorte ampliado que acepta algunos símbolos de moneda omitidos por OCR. Cuando falta saldo, la app no da `COMPRAR`; muestra puntuaciones parciales y conserva la reserva de liquidez del 30 %.
- **Persistencia y velocidad:** se eliminó la búsqueda PowerShell redundante al ubicar la ventana flotante y se restringieron los reintentos de OCR de saldo; las etiquetas y la base SQLite no se borran por un fallo transitorio de captura.
- **Pruebas:** `npm run check` y `npm test` incluyen título acentuado, captura GDI independiente, lectura de saldo, Nidoran♂ y diagnósticos por fila. El objetivo sub-segundo y 10/10 anuncios todavía deben medirse contra imágenes y hardware reales; no se garantizan por pruebas sintéticas.

## v0.6.2 — Captura confiable y diagnóstico persistente

- Se corrigió un error por el que el motor **Windows GDI** ejecutaba el segundo selector de **PrintWindow**. GDI usa exclusivamente `CopyFromScreen` y puede tomar el escritorio virtual sin encontrar primero una ventana de PokéMMO. PrintWindow permanece como motor adicional, pero los videojuegos acelerados por GPU pueden no admitirlo.
- Win32 ahora busca `PokéMMO` y `PokeMMO` con normalización de tildes, y utiliza el nombre del proceso cuando el texto de la ventana no coincide. Los fallos de PowerShell se registran como diagnóstico, en lugar de devolverse como un `null` silencioso.
- El monitor visual puede recurrir a OCR de encabezado cuando el detector geométrico no identifica un panel, siempre que la imagen sea plausible. Los motores nativos se prueban automáticamente solo después de un fallo sostenido, para no lanzar PowerShell en cada ciclo del juego.
- El comparador manual **no sustituye el motor seleccionado** cuando no obtiene evidencia real del GTL. Una captura de escritorio no basta para validar un motor.
- **OCR por fila** conserva el último diagnóstico, su fecha y su motor, incluso después de salir del GTL o pulsar Stop. Una lectura vacía o un fallo transitorio no borra la evidencia anterior. El saldo confirmado tampoco se borra si falla una lectura posterior; pasa a estado histórico.
- Las etiquetas no conservan recomendaciones de otro anuncio cuando cambian especie, nivel, precio o IV conocidos en una misma fila.
- Navegación horizontal de una sola línea, manteniendo el estilo claro y minimalista.

Las pruebas unitarias validan el reemplazo de **todos** los selectores GDI/PrintWindow, el respaldo visual, el diagnóstico persistente y la invalidación de calificaciones obsoletas. Sin acceso al PC Windows 11 ni a los píxeles del juego en tiempo real, no puede asegurarse la disponibilidad de cada motor o el reconocimiento completo 10/10; para eso se requieren pruebas en tu equipo.

Actualizar: `git pull origin main`, `npm install`, `npm run check`, `npm test`, `npm start`.

## v0.7.0 — 110 perfiles competitivos, Base de datos y Proyectos

- Se incorporaron **110 perfiles proporcionados por el usuario** (35 prioritarios y 75 alternativos), con naturaleza, IV 31 principales y secundarios, habilidad objetivo, posible habilidad oculta y marca ★ independiente de su condición oculta. Los campos "Variable" de Ditto y Eevee no generan un IV obligatorio falso.
- La habilidad se trata siempre como **objetivo por verificar** en PokéMMO. El radar no lee habilidades en la tabla GTL: no se debe recomendar una compra afirmando que se comprobó la habilidad. Se incluyen los Pokémon de evolución por intercambio como **referencias de mercado**, pero **no se agregan al equipo/proyectos**, especialmente Gengar.
- La página **Pokédex ideal** permite consultar el lote inicial de crianza (10 perfiles) o los nuevos 110 perfiles competitivos. La nueva página **Base de datos** permite buscar naturaleza, IV, habilidad, mínimos anunciados **para naturaleza/IV/etapa compatibles**, mínimos verificados y número de muestras sin confundir objetivos con ofertas.
- La nueva página **Proyectos** registra 13 objetivos iniciales derivados del equipo actual, permite añadir otros del catálogo de 110 sin evoluciones obligatorias por intercambio, y guarda orden editable, tipo de adquisición (compra, crianza, ambos), progreso y presupuesto propio. Se conservan los estados originales del equipo por separado para evitar marcarlos como adquiridos por error.
- Migración de SQLite de versión 5 a 6 **sin borrar anuncios, precios, historiales, ajustes ni datos de crianza**. Los 110 perfiles se insertan en `competitive_profiles`; los proyectos se conservan en `target_projects`. Al reiniciar no se reinicializan proyectos editados.
- La calificación preliminar de un Pokémon evolucionado también puede compararse con el perfil definido por el usuario, **sin afirmar que su habilidad fue comprobada**.
- Las observaciones del GTL y el historial de ventas permanecen separados de los 110 perfiles ideales. Un precio anunciado no equivale a una venta realizada.

Actualizar desde Windows: `git pull origin main`, `npm install`, `npm run check`, `npm test`, `npm start`.

Nota: la alineación de las etiquetas flotantes depende de la geometría detectada en el juego real y requiere otra ronda de captura/validación en Windows para confirmar la coincidencia fila por fila; esta versión no afirma haber resuelto ese problema pendiente.

## v0.8.0 — Alineación DPI, lectura ampliada y anuncios propios

- Coordenadas físicas de Win32/GDI/PrintWindow convertidas a DIP antes de colocar el overlay. El motor visual conserva sus coordenadas DIP.
- Alerta «COMPRA ESTE AHORA» para decisiones COMPRAR, al costado del panel y alineada con la fila. Las filas ilegibles no muestran tarjetas de decisión.
- OCR con ampliación 2× y segunda segmentación cuando faltan filas; conserva una lectura completa, sin mezclar campos entre pasadas. Esto puede aumentar la latencia.
- Comparables más estrictos: diferencia máxima de cinco puntos por IV y distinción de IV cero. Puntuación de ajuste con los perfiles competitivos disponibles. No implica una probabilidad de venta.
- Tus Anuncios se registra aparte en Historial: especie, nivel, precio, estado y duración observada. Especies iguales con mismo nivel y precio se agrupan porque la pantalla no expone un ID único. Una ausencia no se interpreta como venta.
- Ventas confirmadas introducidas en el formulario muestran cantidad y neto medio por especie; no son comparables individuales sin IV/naturaleza. Las fichas emergentes de detalle todavía no se incorporan automáticamente.
- Validación: comprobación sintáctica y 96 pruebas locales. Pruebas de escalado y OCR utilizan adaptadores/fixtures; falta validar el comportamiento completo en Windows con PokéMMO real.

## v0.9.0 — Buscador de gangas: lectura inteligente y puntaje 0–10

**Objetivo:** encontrar Pokémon para comprar barato y revender con ganancia, más rápido que otros jugadores.

**Captura a resolución real.** Con Windows escalado (125 %), los motores Win32/PrintWindow recibían el juego reducido (1536×816) y el OCR leía dígitos borrosos. Ahora los scripts de Windows son *DPI-aware* y la Pantalla visual pide la resolución física del monitor. Los motores de PowerShell quedan solo como respaldo, aunque una sesión anterior los hubiera guardado como preferidos.

**Lectura inteligente de IV (una sola pasada de OCR):**
- Un IV pintado de **verde es 31**. Si el OCR leyó «31» en una celda blanca (en realidad 34, 37…), se vuelve a leer.
- La app **aprende la forma de cada dígito** a partir de las lecturas seguras (`digit-templates.json` en la carpeta de datos) y reconoce las celdas dudosas sin Tesseract.
- Lo que siga sin leerse se pasa por un OCR solo de dígitos, celda por celda.
- Se eliminó la segunda pasada completa, que duplicaba el tiempo de lectura.
- Las naturalezas toleran un error de OCR («rnansa» → mansa) solo si hay una única candidata.
- En Diagnóstico se ve cuántas celdas se resolvieron por color, por plantilla y por OCR de celda.

**Cerebro (`src/brain.js`): puntaje = calidad (0–4) + ganga (0–6).**
- **Calidad:** cercanía al perfil competitivo de su línea evolutiva (Gible → Garchomp, Litwick → Chandelure: `src/lines.js`), es decir, naturaleza ideal y 31 requeridos, más la cantidad total de 31.
- **Ganga:** ganancia neta = reventa estimada − precio − **cuota de 1.000 ¥**.
  - La reventa es el percentil 25 de los precios anunciados de la **misma clase** (especie + naturaleza ideal + 31 requeridos + número de 31), no de anuncios idénticos.
  - Ganancia ≥ 1.000 es buena, ≥ 5.000 muy buena y ≥ 10.000 excelente.
- **COMPRAR** cuando el puntaje es ≥ 7, la ganancia es ≥ 1.000 y el precio está dentro del presupuesto (se reserva el 30 % del saldo).
  - Una ganancia pequeña solo llega a 7 en Pokémon ideales, que se venden rápido.
  - Una ganancia grande llega casi sola, pero nunca en un Pokémon sin 31 útiles, porque un precio *pedido* alto no prueba que se venda.
- Se necesitan al menos 3 anuncios de la clase. Mientras tanto aparece **APRENDIENDO** con la nota de calidad.

**Avisos:** la etiqueta COMPRA ESTE AHORA parpadea en verde y suena un doble tono una vez por ganga nueva. Las filas fuera de presupuesto salen en rojo y el resto en gris.

**Interfaz:** ocupa todo el ancho de la ventana; las pestañas se reparten sin barra de desplazamiento.

**Límites honestos:** la reventa se estima con precios anunciados, no con ventas confirmadas. El sexo todavía no influye en el puntaje. La habilidad no se lee en la tabla. Cuantas más páginas recorras (por ejemplo, buscando tus Pokémon ideales ordenados por precio), mejores serán las estimaciones.

## v0.10.0 — Dos Play: «Cazar gangas» y «Aprender precios»

- **▶ Cazar gangas:** el radar de siempre. Puntúa cada fila de 0 a 10 y marca COMPRA ESTE AHORA.
- **▶ Aprender precios:** la app te da **misiones de búsqueda** para llenar la base de precios que usa el cerebro.
  - Ejemplo: *Busca Gible · Nivel 1 · Ataque 31 · Velocidad 31 · Naturaleza Alegre*.
  - Las misiones salen de los 110 perfiles competitivos, primero los destacados, y cubren la especie final y su forma base a nivel 1 (Garchomp y Gible, Dragonite y Dratini…): 200 misiones en total.
  - En el juego: abre Búsqueda Avanzada, aplica los filtros, ordena por precio y mira 2–3 páginas.
  - Una tarjeta amarilla sobre el GTL muestra la misión y su progreso. Con **8 anuncios distintos** que cumplen la misión, suena un aviso y pasa sola a la siguiente.
  - Si la búsqueda muestra menos de una página completa, ya no hay más anuncios y también avanza.
  - **Ctrl+Alt+→** salta la misión. También hay un botón en la pestaña Radar, con la lista de las próximas misiones.
  - Las gangas se siguen marcando mientras aprendes. Todo lo que se lee alimenta el precio de reventa del cerebro.
- Puedes cambiar de modo sin detener el radar.

## v0.11.0 — Lectura 10/10, aprender sin comprar y sin etiquetas fantasma

**Lectura.** Probada con capturas reales de 1920×1080: de 1/10 filas completas a **10/10** en todas las páginas probadas.
- «Nv. 100» se leía como «Nv» «.» «100» o «Nv .51» y se perdía la especie. Ahora se aceptan todas esas formas, y la basura del borde de la celda («| Nv. 1 Gligar É») se descarta.
- **Segunda lectura por celda** para especie y nivel, naturaleza o precio que falten. Los recortes se invierten a texto oscuro sobre fondo claro, con lo que Tesseract pasa de leer «El» con 47 % a «alegre» con 96 %. Lo mismo se aplica a los IVs dudosos.
- Una naturaleza con la primera letra cortada («egre») se recupera solo si existe una única candidata.
- El pie **«Mostrando X a Y de Z»** se lee: ya no se toma por una fila, se sabe qué filas existen y cuándo es la última página.

**Etiquetas fantasma.**
- El cambio de página se detecta con una miniatura más fina, calibrada con capturas reales (misma página ≤0,03 % de cambio, página siguiente ≈2,2 %; umbral 0,8 %), y además por el pie de página.
- Una fila que no existe en la página nunca conserva una etiqueta vieja.

**Aprender precios (sin comprar).**
- Cada fila muestra solo **✓ GUARDADO**, **✗ NO CUENTA** (con el motivo: otra especie, naturaleza, le falta un 31, nivel) o **… LEYENDO**. No hay presupuesto ni decisiones de compra, y no se registran recomendaciones.
- Cuentan también las lecturas parciales que ya tienen especie, naturaleza, los 31 requeridos y precio; cada anuncio cuenta una sola vez.
- La misión termina con 8 anuncios o al llegar a la **última página** de la búsqueda.
- Misiones nuevas para **Ditto** (6, 5 y 4 IVs en 31, cualquier naturaleza).
- La tarjeta y las etiquetas se ocultan mientras la ventana de PokéRadar está al frente.

**Cazar gangas.**
- Clases exactas: 6×31 ya no se mezcla con 5×31, ni nivel 1 con nivel entrenado. Ditto se agrupa por número de 31.
- La pestaña Buscar sugiere primero búsquedas **dentro de tu presupuesto** con precios dispersos.

**Mantenimiento.** Lista de naturalezas centralizada en `market.js`; la consulta de Tus Anuncios hace una sola consulta en lugar de una por anuncio.

**Pendiente:** el sexo aún no influye en el puntaje.

## v0.12.0 — Cazar gangas estable, filtros verificados, contador y compras

**Cazar gangas volvía a borrar sus etiquetas.**
- La app alternaba motores de captura (los rápidos fallaban y PrintWindow funcionaba). Dos motores recortan la misma página con distinta alineación, y el detector lo tomaba por un cambio de página: «Nueva página» y sin etiquetas.
- Ahora la app se queda con el motor que funcionó y solo revisa los demás cada 60 s.
- Para detectar el cambio de página solo compara imágenes del mismo motor y tamaño; si no, decide el pie «Mostrando X a Y».

**Lectura.**
- Un IV pintado de **rojo es 0** (medido ≈ rgb(253,101,101)), igual que el verde es 31.
- **Tus Anuncios** se reconoce por la columna Estado (Activo/Expirado/Vendido), también en páginas cortas donde «Cancelar» no se lee. Nunca se trata como mercado.

**Verificación de filtros (Aprender).**
- Al abrir Búsqueda Avanzada, la app lee Naturaleza, Nivel Min/Max, IV Min/Max y Coincidencias de IV, y los compara con la misión.
- Ejemplos: «✓ Filtros correctos», «✗ Nivel Max debe ser 1», «✗ Quita IV Velocidad Min 31».
- El formulario tiene desplazamiento: se combina lo que muestra cada pantalla.

**Contador en vivo** en la tarjeta de misión y en una franja sobre las etiquetas de caza: «Leyendo página… 1,4 s de ~2,8 s» con barra, «Leído hace 3 s · 10/10 filas», «Esperando el GTL», «Revisando tus filtros». El tiempo estimado es el promedio de las últimas lecturas en tu PC.

**Casi gangas** (pestaña Radar): las 5 lecturas más cercanas a COMPRAR de los últimos 30 min, con el motivo por el que no llegan.

**Mis compras** (pestaña Radar), ciclo compra → venta:
1. **Compra:** cuando el saldo baja exactamente el precio de un anuncio visto en los últimos 20 min, se registra la compra con especie, nivel, IVs, precio y puntaje.
2. **En venta:** al abrir Tus Anuncios, el anuncio de esa especie y nivel se enlaza con la compra.
3. **Vendido:** ganancia real = venta − compra − 1.000, y días en venta. **Expirado:** −1.000.
4. Tus **ventas reales** reemplazan a los precios pedidos en la estimación de reventa del cerebro (2 o más ventas de la misma clase = mediana de ventas).
