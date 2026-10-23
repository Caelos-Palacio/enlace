# Enlace

[![CI](https://github.com/Caelos-Palacio/enlace/actions/workflows/ci.yml/badge.svg)](https://github.com/Caelos-Palacio/enlace/actions/workflows/ci.yml)

Que un agente se conecte a una aplicación solo después de leer su documentación: Enlace separa aprender la interfaz, elegir una ruta, planificar una operación exacta y ejecutarla una sola vez. Independiente de modelos, orquestadores y terminales.

![Demo: capabilities, research, plan y execute en una sesión JSON Lines](docs/media/demo.gif)

<sub>La sesión de la demo es una ejecución real de `enlace session` contra un servidor local de prueba. Para regenerarla: `python3 docs/media/demo.py capture && python3 docs/media/demo.py` (requiere Pillow y ffmpeg; excluido del paquete npm).</sub>

[English](README.md) · **Español** · [Arquitectura](docs/architecture.md) · [Contrato del núcleo](docs/core-contract.md) · [Seguridad](SECURITY.md)

El mismo núcleo sirve como SDK JavaScript, CLI, sesión JSON Lines y servidor MCP, sin LLM, cuenta ni servicio en segundo plano. Primero lee fuentes, después valida y prepara un plan exacto y finalmente lo ejecuta una sola vez. La investigación no concede permisos ni certifica que la documentación sea oficial.

**Estado: 0.1.0, experimental.** Incluye HTTP JSON de lectura, lectura estática HTML/JSON/texto y adaptadores CLI configurados por el anfitrión. La interfaz web, el control nativo de escritorio, OAuth y la generación automática de conectores son puntos de extensión, no funciones incluidas. La instalación local anterior de Pi/Warp es independiente y no se incluye.

## Instalación desde el código fuente

Requiere Node.js 22 o superior. No se descarga ningún navegador ni modelo.

```sh
git clone https://github.com/Caelos-Palacio/enlace.git
cd enlace
npm ci --ignore-scripts
node src/cli.mjs capabilities
npm test
```

Se publica en GitHub; no hay paquete en el registro de npm. Para un comando local usa `npm link` o ejecuta `node src/cli.mjs` directamente.

## Investigar, planificar, ejecutar

```sh
node src/cli.mjs run --adapter http-json --operation request \
  --input '{"url":"https://api.example.com/items"}' \
  --sources '["https://docs.example.com/items"]' \
  --reason 'Referencia de la API para el endpoint solicitado'
```

Los dominios de ejemplo son marcadores, no un servicio real. `run` hace investigación, plan y ejecución en un solo proceso y termina con código 1 si el resultado no es `ok`; en adaptadores que requieren investigación, `--sources` y `--reason` son obligatorios (si faltan, falla con `INVALID_INPUT`). Todas las fuentes deben devolver HTTP 2xx y contenido no vacío; leerlas no demuestra que sean oficiales ni relevantes, y la justificación se registra sin verificarse. La investigación (hasta 5 minutos) y los planes (caducan a los 5 minutos y se consumen una vez) viven en memoria. Sin comando (o con `--help`), `enlace` muestra la ayuda y no se conecta a nada.

Para conservar investigación y planes entre peticiones usa `node src/cli.mjs session` (JSON Lines: `capabilities`, `research`, `plan`, `execute`, una petición por línea terminada en salto de línea) o el servidor MCP (`node src/cli.mjs mcp`, por stdio, con las herramientas `enlace_capabilities`, `enlace_research`, `enlace_plan` y `enlace_execute`). Procesos distintos no comparten investigación ni planes.

## Límites y seguridad

- Por defecto solo red pública: se comprueba cada respuesta DNS y se fija la dirección elegida; se verifican los certificados HTTPS. `--allow-local` permite LAN/loopback expresamente; metadatos y link-local siguen bloqueados. `--origin https://host` (repetible) restringe los orígenes, también para las fuentes de documentación.
- Sin credenciales, cookies, cabeceras de autenticación, redirecciones ni reintentos en los lectores HTTP integrados. HTTP: 10 s, 128 KiB de JSON / 512 KiB de fuente / 12 KiB de texto extraído. CLI: 10 s y 128 KiB de stdout+stderr. Entrada del núcleo: 32 KiB; salida: 128 KiB.
- Los adaptadores de escritura exigen que el anfitrión autorice el plan inmutable y exacto; el agente no puede concederlo con un argumento. Un adaptador CLI usa ejecutables y constructores de argumentos elegidos por el anfitrión, sin shell. `--config ./host-config.mjs` carga código del anfitrión de confianza: nunca desde un argumento de modelo o herramienta.
- El texto externo sigue siendo no confiable: los marcadores y esquemas no resuelven la inyección de prompts semántica. Los subprocesos CLI no son un sandbox del sistema operativo.

CI está configurado para Node.js 22/24 en Linux, macOS y Windows. Desarrollo: `npm run check`, `npm test`, `npm pack --dry-run`.

## Licencia

MIT para el código de este proyecto. Las dependencias conservan sus licencias; consulta los [avisos de terceros](THIRD_PARTY_NOTICES.md).
