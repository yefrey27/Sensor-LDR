Monitor LDR IoT — Universidad Simón Bolívar

Proyecto: Sistema de monitoreo de luminosidad con ESP32  
Integrantes: Yefrey Navarro - Roberto De La Hoz - Carlos Ovalle  
Institución: Universidad Simón Bolívar — Barranquilla, Colombia

1. Descripción General
Sistema IoT que permite monitorear en tiempo real la intensidad lumínica medida por un sensor LDR conectado a un microcontrolador ESP32. Los datos se almacenan en una base de datos en la nube (Supabase / PostgreSQL) y se visualizan a través de un dashboard web con gráficas interactivas Plotly.js. El sistema también permite controlar un LED integrado del ESP32 de forma remota desde el navegador.

![Circuito Fisico](<Screenshots/01_circuito fisico.png>)

Arquitectura general
┌─────────────┐        Wi-Fi / HTTP        ┌──────────────────┐
│   ESP32     │ ─────────────────────────► │  Supabase REST   │
│  + LDR      │                            │  (PostgreSQL)    │
│  + LEDs     │ ◄──────────────────────── │  + Realtime WS   │
└─────────────┘    polling led_control     └────────┬─────────┘
                                                    │ REST API
                                                    ▼
                                         ┌──────────────────────┐
                                         │  Node.js + Express   │
                                         │  (Render.com)        │
                                         │  • Sirve el frontend │
                                         │  • API REST /sensor  │
                                         │  • Auth con bcrypt   │
                                         │  • Control LED       │
                                         └──────────┬───────────┘
                                                    │ HTTP
                                                    ▼
                                         ┌──────────────────────┐
                                         │  Dashboard Web       │
                                         │  (Browser)           │
                                         │  HTML + CSS + JS     │
                                         │  Plotly.js + EmailJS │
                                         └──────────────────────┘

2. Requisitos del Proyecto (Sitemap)
| # | Requisito | Estado |
|---|-----------|--------|
| 1 | Dashboard con Plotly.js o Chart.js | ✅ Implementado con Plotly.js |
| 2 | Base de datos SQL o NoSQL (sensor + usuario/contraseña hasheada) | ✅ Supabase (PostgreSQL) + bcrypt |
| 3 | Login, Logout y página "Acerca de" | ✅ Implementado |
| 4 | Leer y enviar datos entre sensor y LED | ✅ GET/POST sensor + control LED GPIO 2 |
| 5 | API REST con GET y PUSH/PULL | ✅ Express REST API |

3. Hardware
 Componentes
| Componente | Pin GPIO |
|------------|----------|
| Sensor LDR | GPIO 34 (ADC) |
| LED Rojo (nivel bajo) | GPIO 13 |
| LED Amarillo (nivel medio) | GPIO 12 |
| LED Verde (nivel alto) | GPIO 14 |
| LED Integrado (controlable remotamente) | GPIO 2 |

Niveles de luz (rango ADC 0–4095)
| Nivel | Rango | Indicador |
|-------|-------|-----------|
| Bajo 🔴 | 0 – 999 | LED Rojo activo |
| Medio 🟡 | 1000 – 2499 | LED Amarillo activo |
| Alto 🟢 | 2500 – 4095 | LED Verde activo |

4. Tecnologías Utilizadas
| Capa | Tecnología |
|------|------------|
| Microcontrolador | ESP32 DevKit |
| Base de datos | Supabase (PostgreSQL + Realtime) |
| Backend | Node.js + Express |
| Frontend | HTML5 / CSS3 / JavaScript |
| Gráficas | Plotly.js v2.27 |
| Envío de informes | EmailJS |
| Seguridad (hash) | bcrypt (SALT_ROUNDS = 12) |

5. Instalación y Ejecución
Prerrequisitos
- Node.js v18 o superior
- Cuenta en Supabase con tablas `sensores`, `usuarios` y `led_control`

Pasos
bash
1. Clonar el repositorio
git clone https://github.com/tu-usuario/monitor-ldr.git
cd monitor-ldr

2. Instalar dependencias
npm install

3. Iniciar el servidor
node server.js

4. Abrir en el navegador
http://localhost:3000

**Terminal ejecutando el servidor: Captura de la consola mostrando el mensaje de inicio con todos los endpoints listados**
![Terminal Servidor Corriendo](<Screenshots/02_terminal servidor.png>)

Estructura de archivos
monitor-ldr/
├── server.js        # Servidor Express + endpoints REST
├── index.html       # Interfaz web (login + dashboard)
├── styles.css       # Estilos del dashboard
├── app.js           # Lógica frontend (Plotly, fetch, auth)
└── package.json     # Dependencias del proyecto

6. Autenticación
El sistema cuenta con pantallas de login y registro protegidas. Las contraseñas se hashean con bcrypt antes de guardarse en la base de datos.

**Pantalla de Login: Captura del formulario de inicio de sesión con las pestañas "Iniciar Sesión" / "Registrarse" visibles.**
![Pantalla de Login](Screenshots/03_login.png)

**Pantalla de Registro: Captura con los tres campos (correo, contraseña, confirmar contraseña).**
![Pantalla de Registro](Screenshots/04_registro.png)

7. API REST
Base URL: `http://localhost:3000`

Autenticación
| Método | Endpoint | Descripción | Body |
|--------|----------|-------------|------|
| POST | `/auth/register` | Registrar nuevo usuario (contraseña hasheada con bcrypt) | `{ "email": "...", "password": "..." }` |
| POST | `/auth/login` | Iniciar sesión, verifica hash bcrypt | `{ "email": "...", "password": "..." }` |

 Sensor LDR
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/sensor` | Últimas 100 lecturas del sensor |
| GET | `/sensor/:valor` | Lecturas filtradas por valor exacto (ej: `/sensor/0`) |
| POST | `/sensor` | Insertar lectura manual |

**GET /sensor respuesta JSON: Abrir http://localhost:3000/sensor directamente en el navegador. Captura del JSON de respuesta con datos reales del sensor.**
![GET /sensor respuesta JSON](<Screenshots/05_API get sensor.png>)

**POST /sensor Postman o Hoppscotch: Configurar un POST a http://localhost:3000/sensor con body { "valor_ldr": 1500 }. Captura de la respuesta `Lectura insertada correctamente`. Esto demuestra el PUSH de datos.**
![POST /sensor Postman](<Screenshots/06_API post sensor.png>)

Control LED Integrado (GPIO 2)
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/led` | Consulta estado actual del LED |
| GET | `/led/1/on` | Enciende el LED integrado (GPIO 2 HIGH) |
| GET | `/led/0/off` | Apaga el LED integrado (GPIO 2 LOW) |

Ejemplo de respuesta — GET /led/1/on:
{
  "ok": true,
  "estado": true,
  "descripcion": "💡 LED integrado ENCENDIDO — ESP32 GPIO 2 HIGH"
}

**GET /led/1/on respuesta + LED encendido: Abrir http://localhost:3000/led/1/on en el navegador. Captura del JSON de respuesta.**
![GET /led/1/on respuesta + LED encendido](<Screenshots/07_API led on.png>)

Documentación de la API
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api` | Lista todos los endpoints disponibles |

**GET /api documentación: Abrir http://localhost:3000/api. Captura mostrando el JSON con todos los endpoints documentados.**
![GET /api documentación](<Screenshots/08_API docs.png>)

8. Base de Datos (Supabase)
Tabla sensores:
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | integer (PK) | ID autoincremental |
| `valor_ldr` | integer | Valor ADC del sensor (0–4095) |
| `created_at` | timestamp | Fecha y hora de la lectura |

Tabla usuarios:
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | integer (PK) | ID autoincremental |
| `email` | text (unique) | Correo del usuario |
| `password` | text | Contraseña hasheada con bcrypt |

Tabla led_control:
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | integer (PK) | Siempre = 1 (registro único) |
| `estado` | boolean | `true` = encendido, `false` = apagado |

**Tabla Usuarios: Captura de la tabla usuarios mostrando que el campo password contiene el hash bcrypt (empieza con `$2b$12$...`), no la contraseña en texto plano.**
![Tabla Usuarios](<Screenshots/09_Supabase Usuarios.png>)

**Tabla sensores en Supabase: Captura mostrando filas con datos reales (id, valor_ldr, created_at).**
![Tabla Sensores](<Screenshots/10_Supabase Sensores.png>)

9. Dashboard Web

Monitor — Vista principal
**Dashboard Monitor: Captura de la sección Monitor con las 4 tarjetas de estado visibles (último valor LDR, nivel de luz, hora y total de lecturas) y los indicadores de LED activos.**
![Dashboard Monitor](Screenshots/11_Dashboard.png)

**Gráfica Línea: Con el selector en "Línea (tiempo real)" y varias lecturas visibles en la gráfica Plotly.**
![Gráfica línea](<Screenshots/12_Grafica Linea.png>)

**Grafica alternativa: Cambiar el selector a "Niveles" o "Histograma de distribución". Captura de esa vista.**
![Grafica Alternativa](<Screenshots/13_Grafica Alternativa.png>)

**Control LED: Captura del panel con el botón mostrando estado "Encendido" y el indicador visual cambiado.**
![Control LED](<Screenshots/14_Control Led.png>)

**Filtro fecha: Seleccionar una fecha y rango de horas, hacer clic en "🔍 Filtrar". Captura mostrando el mensaje de resultados filtrados y la gráfica actualizada.**
![Filtro fecha](<Screenshots/15_Filtro Fecha.png>)


Informes
**Informes: Captura del formulario con el campo de correo destino, mensaje, y la vista previa de la gráfica visible a la derecha.**
![Informes](Screenshots/16_Informes.png)

API REST (sección del dashboard)
**API REST - Dashboard: Hacer clic en "▶ Probar" del endpoint GET /sensor. Captura mostrando la respuesta JSON en el panel inferior del dashboard.**
![alt text](<Screenshots/17_API Dashboard.png>)
![alt text](<Screenshots/17_API Dashboard 2.0.png>)

About
**Sección Acerca de: Captura de la sección completa con las tarjetas de descripción, hardware, tecnologías e integrantes.**   
![Sección Acerca de](Screenshots/18_About.png)

10. Seguridad
- Las contraseñas se almacenan *nicamente como hash bcrypt (SALT_ROUNDS = 12). Nunca se guarda ni se devuelve la contraseña en texto plano.
- El servidor verifica el hash en cada inicio de sesión con bcrypt.compare().
- Los correos se verifican como únicos antes de registrar un nuevo usuario.

11. Dependencias (package.json)

{
  "bcrypt": "^5.1.1",
  "cors": "^2.8.5",
  "express": "^4.18.2",
  "node-fetch": "^3.3.2"
}

Documentación generada para el proyecto Monitor LDR IoT — Universidad Simón Bolívar.*