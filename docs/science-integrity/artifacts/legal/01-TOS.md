# Términos de Servicio de Librerías Isabella

> **Estado:** Plantilla — **Propietario:** Legal — **Revisión:** 2026-10-07 — **Uso:** revisión por asesoría jurídica local y adaptación por jurisdicción (UE, México, EE.UU.).

## 1. Encabezado y definiciones

**Título:** Términos de Servicio de Librerías Isabella
**Vigencia:** [FECHA]

**Partes**
- **Proveedor:** Librerías Isabella, entidad operadora con domicilio en [DIRECCIÓN], representada por [REPRESENTANTE].
- **Usuario:** persona física o jurídica que utiliza la plataforma para subir, revisar, consultar o auditar contenidos.

**Definiciones clave**
- **Plataforma:** sistema técnico descrito en el blueprint que incluye APIs, servicios de ingestión, pipelines de verificación, ledger y portal público.
- **Contenido:** artículos, datasets, código, imágenes y cualquier artefacto subido por el Usuario.
- **Paquete de evidencia:** conjunto de metadatos, informes de verificación, logs y firmas digitales asociados a un documento.
- **VC:** Verifiable Credential emitida por la Plataforma como sello de certificación.
- **DPA:** Data Processing Agreement aplicable a procesamiento de datos personales.

## 2. Objeto y alcance

**Objeto:** regular el uso de la Plataforma, los derechos y obligaciones de las partes, las condiciones de ingestión, verificación, certificación, publicación y revocación de contenidos.

**Alcance:** aplica a todos los Usuarios que suban, revisen o consulten contenidos en la Plataforma, así como a terceros que interactúen con APIs públicas o privadas.

## 3. Condiciones de uso y licencias

- **Licencia de procesamiento:** al subir Contenido, el Usuario concede a la Plataforma una licencia no exclusiva, mundial y por el tiempo necesario para almacenar, procesar, ejecutar, reproducir, distribuir metadatos y publicar el Paquete de evidencia con fines de verificación y certificación.
- **Licencia de publicación:** el Usuario seleccionará una licencia pública para el Contenido entre las opciones soportadas por la Plataforma. Se recomienda CC BY 4.0 para artículos, CC0 u ODC-BY para datasets no sensibles y Apache 2.0 o MIT para código. Si el Usuario no selecciona licencia, se aplicará la licencia por defecto definida en el Anexo Licencias.
- **Ejecución de código:** el Usuario autoriza la ejecución de código y scripts proporcionados en entornos aislados para fines de reproducibilidad. La Plataforma ejecutará dichos artefactos en contenedores con límites de recursos y sandboxing.

## 4. Derechos y obligaciones del Usuario

**Obligaciones**
- Garantizar titularidad y derechos sobre el Contenido.
- Declarar conflictos de interés y financiación.
- Proveer metadatos completos y veraces.
- Cumplir con licencias de terceros y obtener permisos necesarios.
- Responder a solicitudes razonables de información para verificación.

**Prohibiciones:** subir contenido que infrinja derechos de terceros, que sea ilegal, que contenga datos personales sensibles sin las autorizaciones necesarias, o que intente manipular los procesos de verificación.

## 5. Obligaciones y facultades de la Plataforma

**Obligaciones**
- Ejecutar procesos de verificación conforme a criterios publicados.
- Mantener registros de auditoría y ledger para eventos críticos.
- Proteger datos personales conforme a la Política de Privacidad y al DPA.
- Notificar incidentes de seguridad conforme a la normativa aplicable.

**Facultades**
- Rechazar, encolar, suspender o marcar Contenidos para revisión humana.
- Emitir, revocar o suspender VC y sellos.
- Publicar notas de retractación y actualizar registros públicos.

## 6. Certificación, sellos y revocación

- **Emisión de VC:** la Plataforma emitirá VC firmadas digitalmente cuando se cumplan los criterios técnicos y humanos definidos en la política de certificación.
- **Revocación:** la Plataforma podrá revocar VC por fraude comprobado, error crítico o incumplimiento de políticas. La revocación se registrará en ledger y se publicará la nota de revocación.
- **Verificación pública:** cualquier tercero podrá verificar la validez de una VC mediante el endpoint público `GET /api/v2/cert/{cert_id}/verify`.

## 7. Privacidad y protección de datos

- **Base legal:** el tratamiento de datos personales se realizará sobre la base de consentimiento del Usuario o interés legítimo cuando proceda. La Plataforma actuará como Data Processor o Data Controller según el contexto y firmará DPA con las partes correspondientes.
- **Derechos de los interesados:** el Usuario podrá ejercer derechos de acceso, rectificación, supresión, portabilidad y oposición conforme a la Política de Privacidad y la normativa aplicable.
- **Transferencias internacionales:** se aplicarán SCC o mecanismos equivalentes para transferencias fuera del EEE.

## 8. Responsabilidad y limitaciones

- **Responsabilidad del Usuario:** el Usuario indemniza a la Plataforma por reclamaciones derivadas de infracciones de derechos de terceros o falsedad en metadatos.
- **Limitación de responsabilidad de la Plataforma:** la Plataforma no será responsable por daños indirectos, lucro cesante o pérdida de reputación derivados del uso del Contenido, salvo en casos de dolo o negligencia grave.

## 9. Resolución de disputas y ley aplicable

- **Ley aplicable:** [ELEGIR JURISDICCIÓN] salvo acuerdo en contrario. Se recomienda arbitraje institucional para disputas técnicas y mediación previa a litigio.
- **Cláusula de ejecución:** si una disposición es inválida, las demás permanecerán vigentes.

## 10. Anexos

- **Anexo A:** Licencias recomendadas y plantillas.
- **Anexo B:** Política de certificación y criterios por nivel.
- **Anexo C:** Política de privacidad resumida y contactos DPO.