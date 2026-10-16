# Enlace

Conexiones de aplicaciones para agentes, con investigación previa y sin depender de un modelo, terminal u orquestador concreto.

El mismo núcleo sirve como SDK JavaScript, CLI, sesión JSON Lines y servidor MCP. Primero lee fuentes, después valida y prepara un plan exacto y finalmente lo ejecuta una sola vez. La investigación no concede permisos ni certifica que la documentación sea oficial.

## Estado real

Versión experimental 0.1.0. Incluye HTTP JSON de lectura, lectura estática HTML/JSON/texto y adaptadores CLI configurados por el anfitrión. La interfaz web, GUI nativa, OAuth y generación automática de conectores son extensiones pendientes. La instalación local anterior de Pi/Warp es independiente.

```sh
git clone https://github.com/Caelos-Palacio/enlace.git
cd enlace
npm ci --ignore-scripts
node src/cli.mjs capabilities
npm test
```

Requiere Node.js22 o superior. Se publica en GitHub; no hay paquete publicado en npm. El servidor se inicia con `node src/cli.mjs mcp`. Para conservar investigación y planes desde otra herramienta, usa MCP o `node src/cli.mjs session`.

Por defecto bloquea redes privadas y localhost. `--allow-local` habilita ese acceso expresamente; metadatos y link-local siguen bloqueados. Los lectores no usan sesiones, cookies, credenciales, redirecciones ni reintentos. El núcleo admite plugins de escritura, pero exige autorización del anfitrión para el plan inmutable y exacto; el agente no puede concedérsela mediante un argumento.

[Guía completa y ejemplos](README.md) · [Arquitectura](docs/architecture.md) · [Contrato](docs/core-contract.md) · [Límites de seguridad](SECURITY.md).

Licencia MIT. Las dependencias conservan sus licencias originales.
