# RTS — SDD de la etapa 2: mejoras visuales

**Autor del proyecto:** Camilo Andrés Castañeda Galindo  
**Fecha:** 10 de octubre de 2026 (Colombia)  
**Versión del documento:** 1.0  
**Estado:** especificación preparada; desarrollo no iniciado.  
**Rama de desarrollo requerida:** `mejoras_visuales`  

## 1. Objetivo y alcance de esta entrega

Mejorar la calidad gráfica y la lectura de las acciones conservando su ciclo jugable: economía, construcción, producción, combate y rival Python. Incorporar terreno con materiales más naturales, arquitectura medieval, personajes reconocibles por su rol, animaciones de trabajo y combate, flechas visibles, un mapa ampliado, más árboles y barras de vida condicionales.

Esta entrega es documental. No crea la rama, modifica el juego, descarga modelos, ejecuta pruebas, hace push ni publica una versión. La instrucción futura de desarrollo deberá trabajar en `mejoras_visuales`.

### 1.1 Fuentes y grado de certeza

| Fuente | Uso y limitación |
|---|---|
| Solicitud del autor del 10/10/2026 | Requisitos gráficos, ampliación y nombre obligatorio de rama |
| `RTS_SDD_v0.3.md`, versión documental 2 consultada | Arquitectura, mapa propuesto 64 × 64, reglas de vida, combate, economía y separación de responsabilidades; es un diseño anterior a la implementación |
| README actual de GitHub, consultado para esta entrega | Declara P1 `p1d.4.0`, módulos implementados, modo `?graphics=low` y cierre con limitaciones; no sustituye una inspección del código |
| Listado de GitHub consultado | Solo mostró README en `master`, commit `f38eae81772c616dae625d6dda5044b2dc714d5e`; no permite verificar ni fijar todavía el commit del código completo de P1 |

El README informa 46 pruebas previas y una medición cercana a 60 FPS con 100 unidades y 20 edificios. Son resultados históricos declarados, no pruebas realizadas para este SDD ni garantías de P2. Firefox, memoria total, estabilidad prolongada y congestión permanecen como limitaciones heredadas.

Al iniciar desarrollo se debe identificar el código completo que produjo P1 y registrar su commit. No reconstruir el juego desde el README ni tratar el mapa de la spec antigua como un valor observado en código.

### 1.2 Relación con la especificación anterior

Este documento define el alcance de P2 visual. Sustituye para esta etapa el arte puramente geométrico provisional y el tamaño anterior del mapa. Mantiene Three.js + TypeScript + Vite, simulación autoritativa TypeScript e IA Python/Pyodide en Web Worker.

Las menciones antiguas de P2 como niebla, minimapa o ataque-movimiento eran posibilidades futuras: no quedan incluidas aquí. Si código, decisiones de cierre y SDD antiguo difieren, registrar la discrepancia y conservar el comportamiento aceptado de P1 salvo cambio explícito de este documento.

## 2. Requisitos y decisiones de diseño

| ID | Requisito del autor | Tratamiento en P2 |
|---|---|---|
| P2-R01 | Césped, árboles, arbustos y agua más realistas | Materiales con textura y variación natural coherente |
| P2-R02 | Edificios medievales según tipo | Centro principal, casa y cuartel diferenciables |
| P2-R03 | Humanos según rol | Aldeano, arquero y soldado con silueta y equipamiento propios |
| P2-R04 | Ataques visibles según militar | Animación de arco y de arma cuerpo a cuerpo |
| P2-R05 | Vuelo de flecha si es posible | Incluido como objetivo implementable de efecto cosmético; limitaciones deben declararse |
| P2-R06 | Movimientos de aldeanos al trabajar | Tala, recolección de alimento y construcción |
| P2-R07 | Mapa al doble | Doble superficie lógica, interpretación propuesta explicitada abajo |
| P2-R08 | Muchos más árboles | Meta de cuatro veces los árboles visibles y dos veces los nodos de madera |
| P2-R09 | Vida sobre unidades y edificios cuando no esté al 100% | Barra para toda entidad viva dañada, de ambos bandos |
| P2-R10 | Desarrollo en nueva rama | Nombre exacto `mejoras_visuales` |

Los multiplicadores de árboles, las dimensiones concretas y los presupuestos siguientes son decisiones propuestas por este SDD; no se atribuyen como cifras previamente confirmadas por el autor.

### 2.1 Interpretación de «mapa al doble»

Se adopta **dos veces la superficie**, sin aumentar el tamaño físico de cada celda ni escalar unidades o edificios. Para la referencia documental 64 × 64 = 4.096 celdas, el destino propuesto es **128 × 64 = 8.192 celdas**, extendiendo el eje que une las bases. Duplicar ambos lados produciría cuatro veces la superficie y no es la interpretación usada.

Antes de implementar, comprobar dimensiones reales. Si son distintas, mantener `área_nueva = 2 × área_base`, duplicando el eje de las bases y documentando el resultado. El mapa sigue fijo y reproducible; esto no incorpora un generador procedural ni un editor. El mayor recorrido puede cambiar la duración de las partidas: no compensarlo silenciosamente con más velocidad o mayores alcances.

### 2.2 Dirección artística

Estilo medieval de realismo estilizado: materiales de madera, piedra, estuco, tela y vegetación con detalle perceptible desde la cámara estratégica. No se exige fotorrealismo. Mantener una familia visual coherente, iluminación estable y siluetas claras; evitar mezclar edificios detallados con humanos abstractos sin rasgos.

Usar texturas y modelos propios o redistribuibles, servidos localmente. Registrar autor, origen, licencia, atribución y modificaciones por recurso. No incorporar assets de videojuegos comerciales por semejanza con los referentes. La selección definitiva de archivos se realiza al desarrollar; esta spec no afirma disponer ya de ellos.

## 3. Historias y criterios de aceptación

### P2-H01 — Terreno y vegetación (R01)

Como jugador, quiero reconocer un paisaje natural sin perder visibilidad de mis unidades.

- **CA01:** el césped presenta detalle de textura y variación de tono/escala; no queda una superficie uniforme ni un patrón repetido dominante a zoom habitual.
- **CA02:** árboles muestran tronco, corteza y copa; arbustos muestran follaje. Disponer al menos de tres variantes visuales de árbol y dos de arbusto, mediante geometría, material o escala acotada.
- **CA03:** el agua tiene color, transparencia o reflejo simplificado y movimiento suave perceptible; no requiere reflejos en tiempo real costosos. Sus bordes no parpadean ni muestran huecos.
- **CA04:** follaje y decoración no interceptan indebidamente órdenes al suelo ni impiden seleccionar unidades. Aplicar ocultamiento o atenuación de copas cuando sea necesario para leer la acción.
- **CA05:** distinguir arbustos de alimento seleccionables de arbustos decorativos. El recurso agotado refleja su estado sin conservar un bloqueo inexistente.
- **CA06:** el movimiento ambiental se congela durante pausa y final de partida, junto con animaciones de acciones.

Si P1 no contiene agua, añadir pequeñas zonas periféricas simétricas sin cerrar corredores. Cualquier superficie que represente agua profunda debe ser intransitable y no construible en la cuadrícula lógica. No colocar agua visual sobre suelo por el que caminan unidades. No añadir navegación acuática, pesca ni puentes.

### P2-H02 — Arquitectura medieval (R02)

Como jugador, quiero distinguir los edificios por su forma y función.

| Tipo | Identidad visual propuesta | Reglas preservadas |
|---|---|---|
| Centro principal | Edificio de mayor presencia, base de piedra, entramado de madera, tejado y estandarte | Producción y depósito existentes; huella lógica vigente |
| Casa | Vivienda pequeña, muros de estuco/madera, puerta, ventanas y techo inclinado | Aporte de población existente |
| Cuartel | Construcción robusta, entrada amplia, escudos o soportes de armas | Producción militar existente |

- **CA01:** los tres tipos se distinguen a zoom de juego sin depender del nombre del HUD; materiales visibles en paredes y tejados.
- **CA02:** cada edificio conserva marcas de bando claras; el color de jugador no sustituye toda su textura.
- **CA03:** modelos ajustados a su huella, sin bloquear visualmente calles transitables; pivote, escala y selección alineados.
- **CA04:** una obra se reconoce como incompleta mediante andamio o representación progresiva; el progreso procede del estado lógico. La previsualización válida/inválida permanece legible.
- **CA05:** destruir o cancelar elimina representación, barra y referencias de selección; el nuevo modelo no altera costes, colas, vida máxima ni reglas de colocación.

### P2-H03 — Unidades humanas por rol (R03)

| Rol | Rasgos mínimos | Estados visuales |
|---|---|---|
| Aldeano | Cuerpo humano articulado, ropa civil, herramienta según tarea | Reposo, caminar, trabajar, transportar |
| Arquero | Arco visible, carcaj, ropa o protección ligera | Reposo, caminar, apuntar/tensar/soltar |
| Soldado | Arma cuerpo a cuerpo y protección; escudo si el modelo lo permite | Reposo, caminar, golpe y recuperación |

- **CA01:** cabeza, torso, brazos y piernas reconocibles, con proporciones coherentes y roles distinguibles a zoom habitual.
- **CA02:** ambos bandos usan la misma calidad de arte y una marca de identificación que acompaña al color.
- **CA03:** caminar y orientar el personaje sigue su desplazamiento real; una unidad inmóvil no reproduce marcha perpetua.
- **CA04:** la selección y el radio de colisión siguen las formas lógicas; armas y extremidades animadas no cambian alcance ni detección de clic esencial.
- **CA05:** pérdida de entidad, reinicio y cambio de tarea eliminan estados visuales anteriores; no quedan personajes fantasma.

### P2-H04 — Combate y flechas (R04, R05)

- **CA01:** un ataque válido del soldado reproduce un golpe orientado al objetivo y recuperación; el arquero apunta, tensa y suelta. No basta con mover verticalmente todo el personaje.
- **CA02:** la frecuencia de acciones respeta los ataques lógicos; interpolación o baja tasa de cuadros no duplica daño ni reproduce eventos indefinidamente.
- **CA03:** cada disparo visible del arquero genera una flecha que sale del arco hacia la posición registrada del objetivo. Trayectoria recta o arco leve, punta orientada al desplazamiento y duración visual breve de 0,12–0,35 s según distancia.
- **CA04:** la flecha es exclusivamente cosmética: el daño sigue aplicándose en el tick de ataque válido, como en el SDD previo. No existe segundo daño al llegar ni cálculo nuevo de aciertos, colisiones o fuego aliado.
- **CA05:** si el objetivo se mueve o muere, la flecha termina en el punto capturado y desaparece; no persigue cadáveres ni cambia el resultado del ataque. No necesita incrustarse en superficies.
- **CA06:** pausa congela ataque y flecha; finalización/reinicio limpia efectos. Ataques rechazados no crean flechas.
- **CA07:** el modo ligero conserva una flecha simplificada y gestos reconocibles. Si una limitación impide su vuelo, registrar R05 como parcial o pendiente, explicar la causa y no declarar esta historia completamente satisfecha.

La sincronía visual es aproximada: conservar daño instantáneo implica que la barra puede bajar antes de que llegue la flecha. Priorizar consistencia de reglas; cambiar a daño al impacto requeriría una especificación de combate aparte.

### P2-H05 — Trabajo de aldeanos (R06)

- **CA01:** al talar, el aldeano se orienta al árbol y mueve brazos/hacha; al recoger alimento, se inclina y mueve manos; al construir, realiza golpes con martillo hacia la obra.
- **CA02:** representar transporte con carga visible cuando la carga lógica sea positiva; desplazamiento y entrega conservan el comportamiento económico vigente.
- **CA03:** trabajar solo cuando la simulación confirme trabajo activo y proximidad válida. Estar en ruta hacia un recurso no activa la animación de recolección.
- **CA04:** nueva orden, objetivo agotado/destruido, detención, muerte o pausa interrumpen o congelan el gesto correspondiente sin dejar herramientas flotando.
- **CA05:** el número de gestos no decide la cantidad recolectada ni el avance de construcción; reducir calidad gráfica produce los mismos saldos con los mismos comandos.

### P2-H06 — Mapa y bosques ampliados (R07, R08)

- **CA01:** dimensiones y número total de celdas satisfacen §2.1 y constan en la versión del mapa.
- **CA02:** cámara, zoom, selección, límites, colocación de edificios, navegación y observación de la IA funcionan en toda la extensión, incluidas esquinas y extremo rival.
- **CA03:** registrar `T0` árboles visibles y `N0` nodos de madera del mapa base. Objetivo P2: al menos `4 × T0` árboles visibles y `2 × N0` nodos de madera; conservar cantidad por nodo. Si algún valor base es cero, fijar un conteo absoluto explícito en la preparación, sin usar una multiplicación vacía.
- **CA04:** agrupar árboles en bosques y claros simétricos, con recursos equivalentes por bando. Mantener distancias locales razonables entre centro y recursos iniciales, espacio de construcción y salida de tropas.
- **CA05:** todos los nodos recolectables tienen al menos un punto de trabajo alcanzable. Bases conectadas y corredores principales de al menos tres celdas libres; validar antes de iniciar partida.
- **CA06:** árboles adicionales puramente decorativos se ubican dentro de áreas ya bloqueadas o fuera del terreno jugable; nunca aparentan troncos sólidos en rutas transitables. No se envían como entidades económicas a Python.
- **CA07:** no duplicar automáticamente unidades, edificios iniciales, población, recursos iniciales de cuenta o alimento del mapa. Los cambios económicos se limitan a los nuevos nodos de madera especificados.
- **CA08:** revisar constantes de tamaño en TypeScript y Python; adaptar límites, índices y búsquedas al mapa real sin ampliar las capacidades estratégicas del rival. Conservar límites de mensajes y registrar tamaño de observación; si se exceden, resolverlo antes de cerrar la historia.

### P2-H07 — Barras de vida (R09)

- **CA01:** para unidad o edificio vivo, mostrar barra si y solo si `0 < vida_actual < vida_maxima`; a vida completa ocultarla incluso estando seleccionado. El HUD puede conservar su información numérica.
- **CA02:** incluir ambos bandos y edificios en construcción: si su vida es inferior al máximo definitivo, mostrar barra. No confundirla con el progreso de obra.
- **CA03:** anclar encima de cabeza o techo mediante altura visual por tipo, orientada a cámara, con tamaño de pantalla legible y proporción `clamp(vida_actual / vida_maxima, 0, 1)`.
- **CA04:** usar fondo/borde y longitud de relleno como señal principal; el color puede reforzarla. No depende únicamente de rojo/verde.
- **CA05:** actualizar después del daño lógico, sin esperar la flecha. Al llegar al máximo, ocultar; al morir/desaparecer, retirar.
- **CA06:** no dibujar barras detrás de la cámara, fuera del encuadre ni encima del HUD. La vegetación no oculta una barra necesaria de una entidad visible; la barra no captura clics ni revela información adicional si en el futuro se incorpora niebla.
- **CA07:** si `vida_maxima` no es válida, ocultar barra y registrar diagnóstico, evitando divisiones por cero. No añadir curación para demostrar el estado de vida completa.

## 4. Diseño técnico propuesto

### 4.1 Separación de responsabilidades

El renderer consume snapshots y eventos. Solo TypeScript decide estado, vida, recursos, rutas, trabajo y ataques. Python conserva su función estratégica; no recibe texturas, huesos, meshes ni animaciones.

Según README, los puntos de integración son `src/view.ts`, `src/core.ts`, `src/economy.ts`, `src/combat.ts`, `src/ai.ts` y `public/policy.py`. Confirmar rutas al recuperar el código. Separar visuales en módulos pequeños si facilita el cambio, sin reestructurar toda P1.

| Componente propuesto | Responsabilidad |
|---|---|
| Catálogo visual | Modelos/materiales por tipo, pivote, escala, altura de barra y clips |
| Gestor de recursos | Carga local, reutilización de geometría/texturas y liberación |
| Adaptador de animaciones | Traducir tarea/desplazamiento/eventos a gestos |
| Efectos de combate | Flechas temporales con reutilización de objetos |
| Barras de vida | Proyección/anclaje, proporción, visibilidad y limpieza |
| Configuración del mapa | Dimensiones, obstáculos, nodos y vegetación visual por semilla/versión |

Preferir modelos GLB/glTF con animaciones cuando existan recursos adecuados; aceptar articulación procedural con partes humanas si satisface los criterios. No usar la carga de un modelo como requisito para iniciar el motor lógico antes de que el escenario esté visualmente listo.

### 4.2 Contratos visuales mínimos

Los nombres siguientes son conceptuales y deben adaptarse al código sin duplicar contratos equivalentes:

- Vista de entidad: ID, tipo, propietario, posición, orientación/desplazamiento, vida actual/máxima, tarea, objetivo, carga y progreso de obra cuando aplique.
- Evento de ataque: ID único por sesión, tick, atacante, objetivo, tipo y posiciones capturadas. Consumir una sola vez; admitir varios eventos entre cuadros y acotar su retención.
- La animación usa tiempo de juego y fase normalizada; no gobierna el tick. Para ataques muy breves, mostrar golpe/disparo y recuperación sin retrasar el daño para completar una anticipación artística.
- Aleatoriedad decorativa utiliza semilla separada de la lógica. Cambiar texturas, calidad o distribución cosmética no cambia decisiones ni resultados de combate.
- Reinicio invalida eventos anteriores. Retirar entidades limpia animaciones, barras y vínculos; liberar recursos compartidos solo cuando no haya usuarios restantes.

### 4.3 Materiales, carga y rendimiento

- Reutilizar materiales y geometrías; agrupar vegetación repetida y limitar sombras costosas. Reducir detalle distante y evitar un objeto HTML por cada árbol.
- Propuesta inicial: texturas de hasta 1.024 px normalmente y hasta 2.048 px solo para atlas justificado; assets visuales nuevos hasta 20 MiB transferidos. Registrar excesos y su razón, sin presentarlos como límites ya medidos.
- Conservar el modo ligero existente; simplifica follaje, sombras y agua, pero mantiene roles, barras, ataques y trabajo reconocibles.
- Fallos de assets muestran un sustituto legible y diagnóstico, sin romper selección o simulación. Un sustituto geométrico permite continuar, pero no cuenta como cumplimiento artístico de una historia.
- No actualizar Three.js, Pyodide o el resto del stack por iniciativa de esta etapa. Usar las versiones bloqueadas de P1; cualquier cambio imprescindible se justifica con la incompatibilidad concreta.

## 5. Límites y fuera de alcance

No incluye nuevas unidades o edificios, edades, facciones, tecnologías, armas con estadísticas nuevas, armadura, balística real, curación, terreno con desniveles transitables, clima, ciclo día/noche, barcos, minimapa, niebla, multijugador, controles móviles ni nueva estrategia de IA.

Conservar vida máxima, daño, alcance, tiempos, velocidades, costes, capacidad y reglas de victoria de la implementación P1. El nuevo tamaño y la madera adicional pueden afectar al balance; documentar ese efecto sin prometer igualdad de duración con P1.

## 6. Secuencia de implementación futura y trazabilidad

| Paso | Trabajo | Requisitos | Salida concreta |
|---|---|---|---|
| P2-00 | Recuperar código completo P1, leer instrucciones del repo, identificar commit/dimensiones/conteos y crear rama | R10, base R07–R08 | Rama `mejoras_visuales`, base identificada y discrepancias documentadas |
| P2-01 | Catálogo de assets, materiales y terreno | R01 | Césped, agua y vegetación funcionales con procedencia registrada |
| P2-02 | Modelos medievales y personajes | R02–R03 | Tres edificios y tres roles reconocibles, selección y obras preservadas |
| P2-03 | Gestos de trabajo y combate, flechas | R04–R06 | Acciones vinculadas al estado y eventos, sin alterar reglas |
| P2-04 | Barras de vida | R09 | Visibilidad, anclaje y limpieza correctos para todos los tipos |
| P2-05 | Extensión del mapa y bosques | R07–R08 | Dimensiones, conectividad, recursos e IA adaptados |
| P2-06 | Integración y revisión acotada | R01–R10 | Build, evidencias mínimas y matriz de aceptación |

Al iniciar P2-00, verificar árbol de trabajo y rama. Crear `mejoras_visuales` desde el commit completo aceptado de P1. Si ya existe, inspeccionar su origen y reutilizarla solo si corresponde; no borrarla, forzarla ni sobrescribir trabajo. No desarrollar en `master`/`main`. Commits por incrementos coherentes; merge y publicación solo con instrucción posterior.

Ubicación sugerida al incorporar este archivo: `docs/sdd/etapa-2-mejoras-visuales.md`, enlazado desde el SDD principal. Conservar un solo documento normativo de P2; no duplicar reglas incompatibles.

## 7. Verificación mínima y control del esfuerzo

El autor ha pedido evitar más gasto en pruebas. Esta entrega no ejecuta ninguna. Para la implementación se propone una revisión acotada integrada al desarrollo, sin campañas prolongadas ni repetir la homologación completa de P1.

| Comprobación | Alcance mínimo | Criterios cubiertos |
|---|---|---|
| Compilación | Comandos existentes de typecheck/build una vez sobre la candidata | Integración del código y assets |
| Reglas afectadas | Reutilizar casos existentes de daño/vida y conectividad; añadir solo lo necesario para un riesgo nuevo concreto | H04-CA02/04, H05-CA05, H06-CA05/08, H07-CA01/05 |
| Recorrido visual único | Cámara y esquinas, tres edificios, tres roles, tala/alimento/obra, ataque y flecha, daño, pausa y reinicio | H01–H07; inspección también del modo ligero |
| Rendimiento acotado | Reutilizar escenario de 100 unidades y 20 edificios sobre mapa y vegetación nuevos, hasta 60 s en Chrome; registrar GPU/resolución/calidad | Detección de regresión evidente, no certificación prolongada |

Objetivo orientativo: 60 FPS; umbral mínimo propuesto para esa muestra corta: mediana ≥30 FPS y tiempo de cuadro p95 ≤50 ms, con simulación e IA activas. Si falla, optimizar el cuello observado y repetir solo el caso afectado. No afirmar cumplimiento por correr una simulación sin renderizador.

Esta muestra corta sustituye únicamente la comprobación de regresión propuesta para P2; no satisface los ensayos de cinco o veinte minutos del SDD original. Firefox, estabilidad prolongada, memoria total y límites de congestión quedan declarados como no verificados, sin reapertura automática de esas campañas. Si el autor decide omitir también la medición corta, marcar rendimiento P2 como no verificado.

Usar un fixture determinista para reunir acciones y vida parcial sin añadir trucos a partidas normales. Comparar reglas con los mismos comandos efectivos y mapa; comparar semilla de dos partidas contra IA asíncrona no demuestra equivalencia.

La evidencia mínima es una tabla ligada al commit candidato: historia/criterios, resultado observado, limitaciones y comprobación usada. Solo capturas puntuales o un clip breve si ayudan a revisar la estética; no generar otra batería masiva de evidencias. Una ejecución satisfactoria no se convierte automáticamente en aceptación estética del autor.

## 8. Riesgos y decisiones ante fallos

| Riesgo | Respuesta acotada |
|---|---|
| Bosque más denso bloquea rutas o construcción | Mantener claros/corredores y validar alcanzabilidad; recolocar vegetación antes de cambiar navegación |
| Mapa mayor degrada A* o consultas de IA | Parametrizar límites y medir caso afectado; no sustituir el motor preventivamente |
| Texturas y animaciones reducen FPS | Reutilización, menos sombras/detalle distante y modo ligero; conservar legibilidad |
| Flecha visual parece desfasada respecto al daño | Vuelo breve y daño lógico inalterado; documentar la diferencia |
| Modelos de procedencias distintas resultan incoherentes | Unificar escala, paleta y materiales antes de añadir detalles |
| Código completo P1 no disponible en GitHub | Obtener la copia fuente existente e identificar commit; no inventar archivos ni iniciar sobre README solo |

## 9. Criterio de cierre

P2 queda lista para revisión cuando R01–R10 tienen trazabilidad, el código está en `mejoras_visuales`, las mejoras son visibles, el mapa y recursos cumplen los conteos registrados, las acciones conservan las reglas y no hay errores bloqueantes observados en la revisión acotada.

Cada historia se marca **especificada**, **implementada**, **verificada**, **aceptada**, **parcial** o **pendiente**, distinguiendo implementación de aceptación. Si se omiten flechas u otra mejora, no declarar la etapa completa sin señalarlo. Incluir licencias de assets y limitaciones heredadas. La entrega final del desarrollo debe resumir cambios, commit, verificaciones realmente realizadas y lo que sigue sin verificar.

## 10. Instrucción para el futuro agente de desarrollo

Cuando el autor ordene comenzar, lee este SDD, el SDD vigente de P1 y las instrucciones del repositorio. Recupera e identifica primero el código completo de P1; registra dimensiones, árboles/nodos y versiones reales. Crea o valida la rama `mejoras_visuales` desde esa base. Implementa P2-00 a P2-06 respetando la autoridad TypeScript y la IA Pyodide. Conserva las reglas y ejecuta únicamente las comprobaciones acotadas descritas. No amplíes alcance por menciones históricas de P2. No hagas merge ni publiques sin instrucción. Reporta discrepancias concretas, decisiones propuestas que haya que ajustar y resultados observados; nunca marques pruebas o aceptación que no hayan ocurrido.

**Estado al emitir este documento:** todas las historias están especificadas; ninguna se ha implementado o verificado en esta entrega.
