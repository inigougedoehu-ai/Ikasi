# Ikasi — plan de estudio

Web estática preparada para **GitHub Pages**.

## Publicarla

1. Crea un repositorio nuevo en GitHub (por ejemplo `ikasi`).
2. Sube **todos los archivos de esta carpeta** a la raíz del repositorio.
3. Ve a **Settings → Pages**.
4. En *Build and deployment*, selecciona **Deploy from a branch**.
5. Elige `main` y `/ (root)`.
6. Guarda. GitHub te mostrará la URL pública cuando termine el despliegue.

No necesita instalar nada, no usa Node, no necesita base de datos ni backend.

## Cómo funciona

- **Hoy**: bloques del día y próximo examen.
- **Calendario**: vista semanal.
- **Progreso**: horas completadas frente a planificadas.
- **Admin**: añadir, editar, mover, completar o borrar bloques.
- **Exportar copia**: descarga un JSON con tu estado.
- **Importar copia**: restaura ese JSON.
- **Restaurar plan inicial**: vuelve al horario incluido en `data.js`.

Los cambios se guardan en `localStorage`, por lo que permanecen en el mismo navegador/dispositivo.

## Cambiar el plan base

Puedes editar `data.js`. El panel Admin modifica tu copia local, no el repositorio de GitHub.

## PWA

La web incluye `manifest.webmanifest` y `sw.js`, por lo que puede añadirse a la pantalla de inicio y funcionar parcialmente sin conexión una vez cargada.

## Más adelante

La estructura está preparada para añadir una pestaña de asignaturas, banco de tests, preguntas falladas y simulacros.
