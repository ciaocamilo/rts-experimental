# RTS Camilus (nombre provisional)

> Creado experimentalmente por Ing. Camilo A. Castañeda Galindo.

Prototipo de estrategia en tiempo real (RTS) que se ejecuta en el navegador. Un jugador humano se enfrenta a un rival controlado por una política escrita en **Python**, que corre dentro de un Web Worker mediante **Pyodide**. El proyecto sigue una especificación SDD y se construye por incrementos verificables. El nombre «RTS Camilus» es provisional y se muestra en el título de la pestaña y en la barra inferior del juego.

![Combate contra la IA en la escena de carga](docs/images/combate-ia.png)

## Etapas

Cada etapa tiene su especificación; las anteriores se conservan como historial.

| Etapa | Contenido | Especificación |
|---|---|---|
| 0 a 1 | Base, navegación, IA en worker, economía, combate y rival completo | [RTS_SDD_v0.3.md](RTS_SDD_v0.3.md) |
| 2 | Mejoras visuales: edificios y personajes por rol, agua, llamas por daño | [SDD_Etapa_2_Mejoras_Visuales.md](SDD_Etapa_2_Mejoras_Visuales.md) |
| 3 | Defensa, recursos y legibilidad | [SDD_Etapa_3_Defensa_Recursos.md](SDD_Etapa_3_Defensa_Recursos.md) |
| 4 | Efectos de sonido y música ambiental procedurales | [SDD_Etapa_4_Efectos_Sonido.md](SDD_Etapa_4_Efectos_Sonido.md) |
| 5 | Realismo sonoro y visual (luz, sombras, humo, derrumbes) | [SDD_Etapa_5_Realismo_Audiovisual.md](SDD_Etapa_5_Realismo_Audiovisual.md) |
| 6 | Interfaz, río con puente, aldea inicial y ajustes de sonido | [SDD_Etapa_6_Ajustes_Interfaz_y_Mundo.md](SDD_Etapa_6_Ajustes_Interfaz_y_Mundo.md) |
| 7 | Bosques, aves, retratos de selección, 12 casas por bando, partida de 30 minutos, ventana final y barra de castillo | [SDD_Etapa_7_Bosques_Retratos_y_Castillo.md](SDD_Etapa_7_Bosques_Retratos_y_Castillo.md) |

## Resumen

- **Partida 1 contra 1** sobre un mapa de 128x64 celdas con terreno, rocas, bosques y un río de lado a lado con un puente central (6 celdas) como único cruce. Cada bando parte con doce casas y dos torres ya construidas.
- **Bosques y aves (etapa 7):** 16 bosques de pinos y árboles frondosos (unos 1180 árboles) que actúan como obstáculo en el mapa, la miniatura y el movimiento, y aves de fondo con trinos aleatorios (sonido procedural).
- **Retrato de selección (etapa 7):** al seleccionar una unidad, un edificio o un recurso, la barra inferior muestra un retrato en 3D con luz de estudio, su nombre en español, su bando (JUGADOR, ENEMIGO o NATURALEZA, con símbolo y color) y una barra de vida (verde, amarilla o roja) o de recurso restante; en las obras, también el avance de construcción.
- **Barra de castillo (etapa 7):** fondo de ladrillos del mismo color de la barra, almenas en el borde superior y troneras en los paneles; el pie muestra el nombre del juego y el crédito del autor.
- **Fin de partida (etapa 7):** ventana con escudo de victoria, derrota o empate, motivo, duración, bajas y estado de los centros urbanos, con «Jugar de nuevo» y «Ver el campo»; el botón «Resultado» la vuelve a abrir. Si a los 30 minutos ningún centro urbano cayó, hay empate.
- **Interfaz (etapa 6):** barra inferior con recursos (Comida, Madera, Piedra y Población con nombre), información de la selección, botones con icono y coste, y miniatura del mapa en tiempo real (clic o arrastre para mover la cámara); avisos temporales en pantalla; registros técnicos ocultos por defecto (tecla L o botón «Registros»); fuera del mapa todo es negro y hay más zoom.
- **Aspecto (etapa 2):** edificios medievales (centro urbano, casa, cuartel), personajes humanoides por rol con animaciones de trabajo y combate, flechas cosméticas, vegetación y agua animada. Todo es procedural (sin recursos externos) y no altera las reglas.
- **Barras de vida:** unidades y edificios de ambos bandos (incluidas las obras) muestran barra solo cuando 0 < vida < máxima.
- **Daño visible:** los edificios completos muestran una llama más al bajar al 90 %, 75 %, 50 %, 25 % y 5 % de vida; las unidades caen al morir y su cuerpo desaparece a los 5 s. Es solo aspecto: no cambia las reglas.
- **Economía:** aldeanos que recolectan comida, madera y piedra, construyen casas, cuarteles y torres, y entrenan unidades con cola de producción y límite de población.
- **Combate:** soldados y arqueros con rango, enfriamiento y ataque automático a menos de 6 celdas. Gana quien destruye el centro urbano rival; el límite es de 30 minutos (36 000 ticks).
- **IA en Python:** una política sin estado decide hasta 4 órdenes cada segundo. Se ejecuta en un worker aislado y se comunica con el juego mediante un contrato de mensajes versionado (`contracts/worker-v2`).
- **Núcleo determinista:** la simulación es TypeScript puro, avanza a 20 ticks por segundo y puede reproducirse solo con la semilla y el registro de órdenes.
- **Diagnóstico:** el HUD muestra FPS, tiempo de cuadro y de tick; el botón «Exportar diagnóstico» descarga un JSON con versiones, rendimiento, intercambios con la IA y órdenes aplicadas.

## Capturas

| Cien unidades cruzando el paso central | Escaramuza sin IA |
|---|---|
| ![Multitud de 100 unidades](docs/images/multitud-100.png) | ![Escaramuza](docs/images/escaramuza.png) |

Los bandos se distinguen por color y por una marca de contorno: anillo blanco para el jugador (azul) y rombo oscuro hueco para el rival (rojo).

### Etapa 7: bosques, retratos y barra de castillo

Capturas de la etapa actual, tomadas a 1600x900 con las escenas `?fixture=retratos` y `?fixture=sonidos`. Las capturas anteriores se conservan.

![Bosques de pinos y árboles frondosos en el mapa](docs/images/etapa7-bosques.png)

| Edificio propio seleccionado | Barra de castillo con retrato, panel y miniatura |
|---|---|
| ![Retrato de un centro urbano propio](docs/images/etapa7-retrato-edificio.png) | ![Barra inferior de castillo](docs/images/etapa7-barra-castillo.png) |

| Unidad propia | Recurso (naturaleza) | Edificio enemigo |
|---|---|---|
| ![Retrato de un soldado](docs/images/etapa7-retrato-unidad.png) | ![Retrato de una roca](docs/images/etapa7-retrato-recurso.png) | ![Retrato de una casa enemiga](docs/images/etapa7-retrato-enemigo.png) |

| Victoria | Derrota |
|---|---|
| ![Ventana de victoria](docs/images/etapa7-fin-victoria.png) | ![Ventana de derrota](docs/images/etapa7-fin-derrota.png) |

Indicador de recursos con nombre:

![Indicador de recursos](docs/images/etapa7-recursos.png)

### Etapa 2: mejoras visuales

Capturas posteriores a la etapa visual (especificación en `SDD_Etapa_2_Mejoras_Visuales.md`). Las anteriores se conservan para mostrar la evolución del aspecto.

| Combate contra la IA con agua orgánica y edificios medievales | Edificios con llamas según su vida y unidades caídas |
|---|---|
| ![Combate contra la IA, etapa 2](docs/images/etapa2-combate-ia.png) | ![Edificios con llamas y unidades caídas](docs/images/etapa2-caidos.png) |

| Llamas adicionales al 90 %, 75 %, 50 %, 25 % y 5 % de vida | Personajes suavizados por rol (arquero, soldado, aldeano) |
|---|---|
| ![Edificios con llamas](docs/images/etapa2-edificios-fuego.png) | ![Personajes suavizados](docs/images/etapa2-unidades.png) |

Novedades de la etapa: edificios y personajes procedurales por rol, animaciones de trabajo y combate, agua con orilla suave y textura multiescala, llamas por daño, caída y desaparición de cuerpos a los 5 s, y desplazamiento de cámara por los bordes de la pantalla.

## Controles

| Acción | Entrada |
|---|---|
| Cámara | WASD o flechas, o cursor en el borde de la pantalla (24 px, 1,5 veces más rápido); rueda para acercar o alejar (hasta 5,5 veces); clic o arrastre en la miniatura |
| Registros técnicos | Tecla L o botón «Registros» |
| Seleccionar | Clic o arrastre; Shift suma o quita; Esc limpia (el clic en un edificio, enemigo o recurso solo muestra su retrato e información) |
| Ventana final | Tab recorre los botones, Intro reinicia, Esc cierra la ventana; el botón «Resultado» la reabre |
| Mover, recolectar, atacar, reanudar obra | Clic derecho según el objetivo |
| Construir | Seleccionar aldeanos y usar el panel inferior |
| Entrenar | Clic en un edificio propio |
| Ayuda | Tecla H o botón «Ayuda» |
| Audio | Tecla M silencia o reactiva todo; los botones «Música» y «Efectos» activan cada uno por separado (se recuerdan en el navegador) |

## Puesta en marcha

Requisitos: Node.js 22 y, para las pruebas de la política, Python 3.

```bash
npm install
npm run dev
```

Abre <http://localhost:5173/>. El primer arranque copia Pyodide 0.27.7 a `public/vendor` (no se versiona).

Parámetros de URL útiles:

| Parámetro | Efecto |
|---|---|
| `?ai=0` | Desactiva la IA |
| `?graphics=low` | Modo gráfico reducido (aspecto de P4): sin antialias, sombras, agua animada ni partículas, con menos decoración y flechas simples |
| `?shadows=0` | Desactiva solo las sombras proyectadas del modo gráfico alto |
| `?fixture=realismo&ai=0` | Escena para juzgar el realismo de P5: edificios en llamas, derrumbes de casa, cuartel y torre, unidades y agua al sur |
| `?fixture=rio&ai=0` | Escena de P6: dos grupos de 20 unidades se cruzan por el puente y tres aldeanos intentan construir sobre el puente, junto a él y en la orilla |
| `?fixture=retratos&ai=0` | Escena de P7 para ver retratos: unidades propias y rivales con vidas variadas, casa, cuartel y torre propios y rivales, y una obra de casa al 45 % |
| `?fixture=corridor20`, `crossing`, `crowd100`, `skirmish` | Escenas de prueba de navegación y combate, sin IA |
| `?fixture=objetivo` | Escena de carga con IA: 100 unidades, 20 edificios y combate |
| `?audio=0` | Desactiva todo el audio |
| `?fixture=sonidos&ai=0` | Escena breve para oír todos los efectos (martillo, espada, flecha e impacto de flecha incluidos); añade `&final=victoria` o `&final=derrota` para oír los sonidos de fin de partida |

## Comandos

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Comprobación de tipos y build de producción |
| `npm run typecheck` | TypeScript estricto |
| `npm test` | Pruebas de TypeScript (Vitest) |
| `npm run test:py` | Pruebas de la política Python (`unittest`) |

## Arquitectura

```
src/
  core/         Simulación determinista (estado, órdenes, economía, combate, fixtures)
  navigation/   Rejilla, rutas y movimiento
  content/      Balance y versiones
  ai-client/    Director y proveedor del worker; contrato de mensajes
  ai-worker/    Worker que carga Pyodide y ejecuta la política
  app/          Sesión de juego y bucle de ticks
  rendering/    Escena Three.js; portrait.ts dibuja el retrato de la selección en un segundo renderizador
  input/        Cámara, selección (describeSelection) y control de ratón y teclado
  ui/           Panel de órdenes con tarjeta de selección, avisos temporales, miniatura, ventana final (end-dialog.ts) y barra de castillo (castle-bar.ts)
  audio/        Efectos, aves de fondo (ambient.ts) y música sintetizados con Web Audio (sin archivos de audio); solo lee los eventos de la simulación
  diagnostics/  Métricas de rendimiento e informe exportable
python/policy/  Política de la IA (policy-0.4)
contracts/      Esquemas y fixtures del contrato del worker
tests/          Pruebas unitarias, de integración y de escenarios
```

El núcleo no depende del navegador ni de Three.js; el renderizado solo lee el estado. La IA nunca modifica la simulación directamente: sus decisiones se validan y se agendan como órdenes para el siguiente tick.

## Pila tecnológica

Vite 6, TypeScript 7 (modo estricto), Three.js 0.186, Pyodide 0.27.7 (Python 3.12), Ajv 8 y Vitest 4.

## Estado y mediciones

Incrementos completados: P0-A a P0-C (base, navegación, IA en worker), P1-A a P1-D (economía, combate, rival completo y estabilización) y las etapas 2 a 7 (mejoras visuales, defensa y recursos, sonido, realismo audiovisual, interfaz y mundo, bosques, retratos y castillo).

Medición en un equipo con Ryzen 5 5600H y RTX 3050, Chromium, 1366x768, escena `objetivo` durante unos 6 minutos:

| Métrica | Resultado |
|---|---|
| FPS (mediana) | 60 |
| Cuadro p95 | 16,8 ms |
| Tick p95 | 0,5 ms |
| IA, ida y vuelta p95 | 12 ms (política 11,4 ms) |
| Partida de 24 000 ticks con dos IA | Sin violaciones de reglas y reproducible |
| Diez reinicios seguidos | Un solo worker y memoria estable |

Las mediciones de la tabla son anteriores a la etapa 2 y no se han repetido con el nuevo aspecto. En la etapa 7 solo se midió la fluidez de la partida por defecto en el navegador integrado de VS Code (ventana de unos 870x490 px, con IA, 8 s tras cargar): 300 cuadros con mediana de 16,7 ms, p95 de 16,8 ms y máximo de 17,1 ms (60 FPS). No se ha medido a 1920x1080 ni en una partida larga con 36 000 ticks en el navegador. En simulaci\u00f3n sin navegador (horizonte de 36 000 ticks): la IA gana al jugador pasivo en el tick 6 178 y dos IA enfrentadas terminan en el tick 24 596, sin violaciones de reglas y con el mismo hash al reproducir las \u00f3rdenes.

Pruebas: 415 de TypeScript y 59 de Python.

## Limitaciones conocidas

- Solo se ha probado en Chromium; Firefox queda pendiente.
- El nombre «RTS Camilus» es provisional.
- Los retratos usan un segundo contexto WebGL; si no está disponible o se pierde, se muestra un dibujo 2D sencillo en su lugar.
- El audio es procedural y su mezcla está pendiente de la valoración auditiva del autor; el navegador solo lo activa tras el primer clic o tecla.
- Existe un único nivel de IA; no se ha medido la dificultad ni la diversión.
- La escena `objetivo` pierde unidades durante el combate, así que los p95 cubren toda la medición y no solo el pico de 100 unidades.
- Fuera de alcance por ahora: mantener posición, mover atacando y niebla de guerra. Cada uno requiere su propia especificación.