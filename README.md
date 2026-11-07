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
