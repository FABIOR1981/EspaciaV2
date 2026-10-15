# Reglas de negocio de Espacia (base para EspaciaV2)

**Origen:** código de Espacia v4.9.17 (`netlify/functions/*`, `js/config*.js`, `js/agenda*`, `js/bloqueos.js`) y el `usuarios.json` de producción.
**Estado:** borrador con las decisiones de Fabio (sección 12) y la primera implementación del backend (sección 13).
Lo marcado con ❓ necesita confirmación: ¿es intencional o es un error heredado?
**Pendiente de contrastar:** `documentacion/manual_*.md`, `informe_*.js`, `reservas_futuras.js`, `agenda_detalle.js` y `abm_usuario.js` (no leídos a fondo todavía).

Cada regla indica **dónde se aplica en Espacia hoy**: `[Front]` = solo en el navegador (se puede saltear), `[Servidor]` = en la función de Netlify.

---

## 1. Roles y permisos

| Acción | usuario | gestor | admin | Dónde (Espacia hoy) |
|---|---|---|---|---|
| Iniciar sesión | sí | sí | sí | Servidor |
| Reservar a su nombre | sí | sí | sí | Servidor |
| Reservar a nombre de otro usuario | no | sí | sí | **Front** ❓ |
| Reservar en el pasado | no | solo "ayer" hasta las 02:00 | sí | Servidor |
| Ver reservas propias | sí | sí | sí | Servidor ❓ |
| Ver reservas de todos | no | sí | sí | **Front** ❓ |
| Cancelar reserva propia | sí (con antelación) | sí (sin límite de antelación) | sí (sin límite) | Servidor |
| Cancelar reserva ajena | no | sí | sí | Servidor |
| Bloquear horarios | no | sí | sí | **Front** ❓ |
| Ver / editar usuarios (ABM) | no | sí | sí | Servidor |
| Informes y PDF | no | sí | sí | por verificar |

Notas:
- `gestor` y `admin` se tratan igual en casi todo el código (`esAdmin = admin || gestor`). La única diferencia real encontrada: **solo `admin` puede crear reservas en el pasado**; `gestor` solo puede "cerrar ayer" antes de las 02:00.
- Duración de la sesión: **12 h** para admin y gestor, **4 h** para usuario.

## 2. Espacios y horarios

- **5 consultorios** (`ESPACIOS_CANTIDAD = 5`), llamados "Consultorio 1" a "Consultorio 5". Prefijo en Calendar: `C1` … `C5`.
- **`C0` = todos los consultorios** (usado por los bloqueos totales).
- Días laborales: **lunes a sábado** (domingo cerrado).
- Horario general: **08:00 a 22:00**. Los **sábados: 08:00 a 16:00**.
- Duraciones permitidas: **60 y 90 minutos**.
- La grilla se dibuja en tramos de **30 minutos**.
- Una opción de duración solo se ofrece si **termina antes del cierre**. Excepción: admin/gestor pueden pasarse del cierre (`restriccionCierreSoloUsuarios`).
- Los usuarios con preferencia de consultorios (`consPref`) ven primero sus consultorios preferidos.
- Zona horaria: **America/Montevideo** (Espacia fija `-03:00` a mano al armar las fechas).

En Espacia, días laborales, horario de cierre, duraciones y rango de consultorios se validan **solo en el Front**. ❓ El servidor acepta cualquier hora, duración o consultorio.

## 3. Crear una reserva

1. Se elige consultorio, día y hora de inicio en la grilla; luego la duración.
2. Un usuario común reserva siempre **a su nombre**. Admin/gestor eligen un usuario en "Agendando para:" y deben elegirlo antes de reservar.
3. **Campos obligatorios** (Servidor): `email`, `consultorio`, `fecha`, `hora`, `colorId`.
4. **Antelación máxima** (Servidor): usuario y gestor hasta **12 semanas** hacia adelante; admin sin límite. Si se pasa, el mensaje remite a la secretaría por WhatsApp.
5. **Pasado** (Servidor):
   - Fecha anterior a hoy: solo admin; el gestor únicamente puede agendar "ayer" mientras sean menos de las 02:00 (para cerrar el día antes del backup).
   - Hoy, hora ya pasada: se bloquea **solo para rol `usuario`**.
6. **Disponibilidad** (Servidor): se rechaza con "El horario ya está ocupado" si hay un evento no cancelado del mismo consultorio que se superponga. Si dos personas reservan a la vez, la segunda recibe 409.
7. Al crear, se dispara un **comprobante (ticket)** en el Front.

## 4. Cancelación

- Una reserva cancelada **no se borra**: el evento se renombra `Cancelada - <título original>`, pasa a color gris (`colorId 8`) y se agrega a la descripción `Reserva Cancelada por: <nombre> el <fecha y hora>`. Se conserva para los informes.
- **Antelación mínima** para usuarios comunes: **24 horas** (no se puede cancelar si faltan 24 h o menos). Admin y gestor pueden cancelar siempre.
- Existe una opción `reglaFinDeSemana` (hoy **apagada**): si se activa, las reservas del **lunes** exigen 48 h más de antelación (24 + 48 = 72 h).
- No se puede cancelar una reserva que **ya pasó**, ni siquiera siendo admin.
- Un usuario común solo cancela reservas **propias** (se compara su email con el del evento).
- Cancelar un evento ya cancelado no duplica el prefijo.

## 5. Bloqueos de horarios (solo admin/gestor)

- Se elige día, rango horario o "día completo", y uno o varios consultorios (o "Todos").
- En Espacia, "día completo" bloquea de **08:00 a 21:00** fijo. ❓ No respeta el horario especial del sábado (16:00) ni el cierre de las 22:00.
- Un bloqueo es una reserva común con nombre `Bloqueada`, color rojo para el total (`11`) y observación opcional: título `C<n>: Bloqueada-<observación>`.
- Si se marcan **todos** los consultorios se crea **un solo evento `C0`**; si no, **un evento por consultorio**, con una llamada separada para cada uno (si una falla, los demás quedan creados).
- ❓ Como la verificación de disponibilidad compara por prefijo (`C1:`, `C2:`…), un bloqueo `C0` **no impide en el servidor** reservar en C1–C5; solo lo evitaría la grilla del Front (por verificar).

## 6. Cómo se guarda una reserva en Google Calendar

- **Título:** `C<n>: <nombre>` (con prefijo y etiqueta configurables para la marca blanca).
- **Descripción:** `Reserva para: <nombre>`, `Email`, `Consultorio`, `Fecha`, `Hora … Intervalo … min`, y `Reserva realizada por: <quien la creó>`.
- **Propiedad privada:** `userEmail` guarda el email del titular. Es la fuente preferida; el código sigue leyendo la descripción para eventos antiguos (formatos heredados).
- **Color** según el consultorio (paleta de colores de Google, tabla `colorGoogle`).
- Los eventos cancelados se **filtran** de la disponibilidad pero se mantienen para informes y backup.

## 7. Informes y respaldo

- Informe de reservas e informe de canceladas (PDF), con la columna **"Cancelado por"**: si cancela el titular, su nombre; si cancela otra persona, "Administración".
- **Respaldo diario** programado a las **03:00** (función `backup-reservas`): guarda en GitHub un archivo `reservas-AAAA-MM-DD.json` con las reservas de **ayer** (00:00 a 23:59 hora Montevideo).
- ❓ Netlify interpreta los horarios `cron` en **UTC**. 03:00 UTC son las **00:00 en Montevideo**, no las 03:00. Eso rompe la razón de la regla del gestor (cerrar "ayer" hasta las 02:00 para llegar antes del backup), porque el backup correría antes de ese plazo. Verificar el horario real de ejecución.

## 8. Usuarios y sesión

- Campos en el `usuarios.json` de producción (58 usuarios: 54 `usuario`, 2 `gestor`, 2 `admin`): `nombre`, `nomUsu`, `email`, `tipdocu`, `documento`, `rol`, `consPref`, `activo`, `requiereCambioPass`, `contrasena`.
- El `email` es siempre `nomUsu` en minúsculas + `@espacia.com.uy` (57 de 58; solo `Admin` lo tiene con mayúscula inicial). `documento` y `tipdocu` son números consecutivos sin significado, usados solo como clave del registro (`PROF-38`).
- Solo pueden iniciar sesión usuarios con `activo = true`.
- Login: el **navegador calcula SHA-256** de la clave y el servidor compara ese hash con el guardado. ❓ El hash se comporta como la contraseña misma y no tiene sal.
- Un usuario nuevo recibe la clave inicial `nomUsu` + `1234567` y `requiereCambioPass = true`. En el archivo analizado, **44 de los 56 usuarios activos siguen con la clave inicial**, incluida una cuenta admin.
- Sesión por JWT con `tipdocu, documento, email, rol, nombre, nomUsu`.
- Cada usuario puede cambiar su clave. Admin y gestor administran usuarios (alta, edición, baja lógica con `activo`).
- Al guardar usuarios: `nomUsu` y `nombre` son obligatorios y el `nomUsu` no puede repetirse (sin distinguir mayúsculas).

## 9. PWA y versiones

- La app es una PWA: `sw.js` con `CACHE_NAME = 'espacia-cache-vX.X.X'`.
- En Espacia se debe mantener la **misma versión en tres lugares**: `package.json`, `js/config_particular.js` (`APP_VERSION`) y `sw.js`. ❓ Conviene que en V2 salga de **un solo lugar**.

---

## 10. Hallazgos para decidir (por prioridad)

**Seguridad**

1. ❓ **Reglas solo en el navegador.** Días laborales, horario, duraciones, rango de consultorios y permiso de bloquear no se validan en el servidor. Quien llame a la función directamente puede saltearlas.
2. ❓ **Un usuario puede reservar a nombre de otro**: el servidor toma el `email` del cuerpo de la petición y no lo compara con el de la sesión.
3. ❓ **`GET reservar?all=1` devuelve todas las reservas (nombres y emails) a cualquier usuario con sesión.** Existe `ADMIN_EMAIL` pero no se usa para controlarlo.
4. ❓ **`GET reservar?email=…`** permite consultar las reservas de cualquier otra persona.
5. ❓ **Permiso de cancelación flojo:** compara con `includes(email)` sobre toda la descripción, no igualdad exacta.
6. ❓ **`update-usuarios` reemplaza todo el archivo de usuarios** y no vi validación de que un gestor no pueda ponerse o poner a otro como `admin`. Además acepta un token de GitHub enviado desde el navegador como alternativa (`|| token`).
7. ❓ `JWT_SECRET` tiene un valor por defecto en el código, y el CORS está fijo a `espacia.netlify.app`.

**Reglas que no se aplican como parece**

8. ❓ **El servidor ignora `config_particular.js`.** Lee `config.js` desde GitHub con expresiones regulares que buscan números (`horasAntelacion: 24`), pero `config.js` tiene variables (`horasAntelacion: REGLA_HORAS_CANCELACION`). No encuentra coincidencia y usa siempre sus valores por defecto: 12 semanas, 24 h, fin de semana apagado. Hoy coinciden con tu configuración, pero cambiar `REGLA_*` solo afecta al Front. Además `node-fetch` no figura como dependencia declarada.
9. ❓ La disponibilidad se verifica y luego se inserta, en **dos pasos separados**. Dos reservas simultáneas pueden pasar la verificación a la vez. Hoy se rescata con el aviso 409, pero no es atómico.
10. ❓ El horario del backup (punto 7) y el bloqueo de día completo (punto 5).

**Mantenimiento**

11. La autenticación de Google está copiada **7 veces** y una copia reemplaza saltos de línea distinto que las demás.
12. Regla del "lunes +48 h": calcula el día con la zona del servidor (UTC), no la de Montevideo. Cerca de la medianoche puede equivocarse.
13. La lista de horas libres considera solo la **hora de inicio** de cada reserva, no su duración completa (por verificar si la grilla compensa esto).

---

## 11. Propuesta para EspaciaV2

- Todas las reglas de este documento se validan **en el servidor**; el Front solo las usa para mostrar mejor (ocultar opciones).
- Una sola fuente de configuración, leída por Front y servidor (`compartido/reglas.json`).
- Un módulo único de Google Calendar y un único módulo de permisos.
- Pruebas automáticas de cada regla de este documento, con un Google Calendar simulado.

---

## 12. Decisiones tomadas (Fabio, 14/10/2026)

1. **Validar todo en el servidor.** Días laborales, horarios, duraciones, consultorio válido, a nombre de quién se puede reservar, quién puede bloquear y quién puede consultar reservas ajenas se hacen cumplir en el servidor. El navegador solo las usa para mostrar mejor (ocultar opciones). Resuelve los hallazgos 1 a 5 de la sección 10.
2. **Modelo de usuario V2 sin `email`, `tipdocu` ni `documento`:**

```json
{
  "id": "AdrianaPR",
  "nombre": "Adriana Perla R",
  "rol": "usuario",
  "consPref": [2, 3, 4, 5],
  "activo": true,
  "requiereCambioPass": true,
  "contrasena": "<hash con sal>"
}
```

   - La clave del registro y de las reservas pasa a ser el `id` (el `nomUsu` actual).
   - Para leer reservas antiguas de Google Calendar, el `id` se reconstruye desde el email guardado en el evento: `id = parte antes de la @`, comparando sin distinguir mayúsculas.
   - Que dos usuarios elijan la misma contraseña es aceptable. El hash con sal protege ante una filtración del archivo, no obliga a que las contraseñas sean distintas.
3. **Migración:** un script de una sola vez convierte el `usuarios.json` actual. El login de V2 acepta el hash viejo una sola vez y lo reemplaza por el nuevo con sal.
4. **Clave inicial:** en V2 es aleatoria, con cambio obligatorio en el primer ingreso (`requiereCambioPass`).
5. **Convención de nombres:** los archivos que hablan con Google llevan `google_` delante y los que hablan con GitHub llevan `github_`. Solo esos pueden usar la red; el resto es lógica pura. Las variables de Netlify siguen `ESPACIAV2_<SERVICIO>_<DATO>` (por ejemplo `ESPACIAV2_GOOGLE_CALENDARIO_ID`, `ESPACIAV2_GITHUB_TOKEN`).
6. **Mismo repo `bd` y mismo Google Calendar que producción**, pero durante el desarrollo `ESPACIAV2_MODO=pruebas` usa un calendario de pruebas aparte.

---

## 13. Implementación del backend (v0.2.0)

**Archivos y qué cubren** (90 pruebas automáticas; corren solas en GitHub Actions en cada subida):

| Archivo | Contenido |
|---|---|
| `compartido/reglas.json` | Fuente única de reglas: horarios, días, duraciones, antelaciones, sesión. La leen servidor y (más adelante) navegador. |
| `netlify/functions/nucleo/reglas_de_negocio.js` | Validación de reservas, cancelaciones, bloqueos y superposición. Lógica pura, sin red ni reloj. |
| `netlify/functions/nucleo/permisos.js` | Qué puede hacer cada rol. |
| `netlify/functions/nucleo/configuracion.js` | Lee las variables `ESPACIAV2_*`; si falta alguna, nombra cuál (nunca el valor) y responde 500. |
| `netlify/functions/nucleo/google_calendario.js` | Único módulo que habla con Google Calendar. Traduce eventos ↔ reservas y **lee también los eventos antiguos de Espacia** (titular guardado como email). |
| `netlify/functions/nucleo/github_usuarios.js` | Único módulo que habla con GitHub. Lee y guarda los usuarios; si otra persona guardó en el medio, **reintenta sin perder su cambio**. Los errores nunca incluyen el token. |
| `netlify/functions/nucleo/reservas_servicio.js` | Casos de uso: crear reserva, cancelar, crear bloqueos. No habla con Google ni GitHub: recibe el repositorio por parámetro. |
| `pruebas/*.prueba.js` y `pruebas/ayudas/*` | Una prueba por cada regla de este documento, con Google Calendar y GitHub simulados (nunca tocan datos reales). |

**Hallazgos de la sección 10 ya cubiertos por el diseño:** 1 a 5 (validación en servidor y permisos), 8 (configuración única en `reglas.json`), 12 (los días de la semana se calculan sobre el texto de la fecha, no con la zona del servidor).
**También cubiertos ahora:** 9 (después de crear se vuelve a verificar el día; si dos personas reservan a la vez, se queda la que llegó primero y la otra se deshace), 11 (un solo módulo de Google), y el bloqueo múltiple es "todo o nada" (si una creación falla o choca, no queda ninguno).
**Pendientes de implementar:** 6 y 7 (login, sesión, contraseñas con sal, gestión de usuarios, sin token enviado por el navegador) y las funciones HTTP que exponen todo esto.

### Supuestos que adopté y que debés confirmar o cambiar

Cada uno vive en un solo lugar del código; cambiarlo es una edición pequeña.

1. **Bloqueo de "día completo"** usa el horario real de ese día (sábados hasta las 16:00, resto hasta las 22:00), no el 08:00–21:00 fijo de Espacia. → `validarBloqueo`
2. **Bloqueo `C0` ("todos")** choca con cualquier consultorio, y pedir "todos" choca con cualquier evento del día. → `haySuperposicion`
3. **Admin y gestor** pueden pasarse del cierre, pero nunca más allá de la medianoche. La hora de inicio dentro del horario, los tramos de 30 minutos y las duraciones de 60/90 minutos se exigen a **todos** los roles.
4. **El gestor** solo puede crear o editar usuarios con rol `usuario`; no toca gestores ni administradores. → `puedeAsignarRol`
5. **Cancelar:** primero se comprueba que sea el titular (403) y después el plazo, para no revelar la política a quien no es dueño.
6. **Los bloqueos** siguen las mismas reglas de fecha que las reservas: el gestor no bloquea el pasado, salvo "ayer" antes de las 02:00.
7. **`ESPACIAV2_MODO`** es obligatorio, sin valor por defecto (`pruebas` o `produccion`). En `pruebas` se usa el calendario de pruebas.
8. **Secreto de sesión:** sin valor por defecto, mínimo 32 caracteres.
9. **Zona horaria:** se calcula con `America/Montevideo`; ya no se usa `-03:00` fijo.

10. **Formato del archivo de usuarios de V2:** `{ "version": 1, "usuarios": [ ... ] }`, guardado en el repo `bd` en una ruta propia (por ejemplo `espaciaV2/usuarios.json`), separada del archivo de Espacia.
11. **Reservas antiguas:** V2 interpreta como reserva todo evento del calendario cuyo título empiece con `C<n>:`. Los colores por consultorio todavía no se asignan; falta definir la tabla.

**Pendiente de decidir:** qué ve un usuario común en la grilla sobre las reservas de otros: solo "ocupado", o también el nombre del titular (hoy en Espacia ve los nombres).

**Pendiente de verificar en Netlify:** a qué hora corre realmente el backup (sección 7), porque de eso depende la regla de que el gestor cierre "ayer" hasta las 02:00.
