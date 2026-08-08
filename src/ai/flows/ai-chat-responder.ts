'use server';
/**
 * @fileOverview Master Setter V2 - Agente Inmobiliario de Alto Rendimiento (Closerly).
 * Implementa Tool Calling, Gestión de Ubicaciones, Prevención de Choques de Agenda y Detección de Idioma.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { createLocalCall, getLocalCalls } from '@/app/calls/actions';
import { getAdminSDK } from '@/firebase/admin';
import { updateLeadStatusAction } from '@/app/leads/actions';
import { LEAD_STATUS } from '@/lib/constants/leads';
import { listEvents } from '@/lib/google-calendar';

/**
 * HERRAMIENTA: Agendar Cita
 */
const bookAppointmentTool = ai.defineTool(
  {
    name: 'bookAppointment',
    description: 'Registra una cita real en el calendario interno del agente.',
    inputSchema: z.object({
      userId: z.string().describe('ID del usuario/agente (ownerId)'),
      leadId: z.string().describe('ID del lead'),
      leadName: z.string().describe('Nombre del lead'),
      date: z.string().describe('Fecha en formato YYYY-MM-DD'),
      time: z.string().describe('Hora en formato HH:MM (24h)'),
      locationName: z.string().describe('El lugar acordado para la cita'),
      description: z.string().optional().describe('Notas adicionales de la cita'),
    }),
  },
  async (input) => {
    const res = await createLocalCall(input.userId, {
      title: `Cita IA: ${input.leadName}`,
      date: input.date,
      time: input.time,
      description: input.description || `Cita en ${input.locationName} generada por el Asistente Virtual.`,
      leadId: input.leadId,
      locationType: 'custom',
      locationDetails: input.locationName
    });
    return res.success ? "ÉXITO: La cita ha sido guardada en el calendario." : "ERROR: No se pudo guardar la cita.";
  }
);

/**
 * HERRAMIENTA: Consultar Disponibilidad de Calendario (Google Calendar)
 */
const checkCalendarAvailabilityTool = ai.defineTool(
  {
    name: 'checkCalendarAvailability',
    description: 'Consulta los eventos en el Google Calendar del agente para una fecha específica, permitiendo saber si hay disponibilidad para agendar una cita.',
    inputSchema: z.object({
      userId: z.string().describe('ID del usuario/agente (ownerId)'),
      date: z.string().describe('Fecha a consultar en formato YYYY-MM-DD')
    }),
  },
  async (input) => {
    try {
      const timeMin = new Date(`${input.date}T00:00:00Z`).toISOString();
      const timeMax = new Date(`${input.date}T23:59:59Z`).toISOString();
      const events = await listEvents(input.userId, timeMin, timeMax);
      
      if (!events || events.length === 0) {
        return `El día ${input.date} está completamente libre. No hay eventos programados.`;
      }
      
      const busySlots = events.map((ev: any) => {
        const start = ev.start?.dateTime ? new Date(ev.start.dateTime).toLocaleTimeString() : 'Todo el día';
        const end = ev.end?.dateTime ? new Date(ev.end.dateTime).toLocaleTimeString() : '';
        return `- Ocupado: ${start} a ${end} (${ev.summary || 'Evento reservado'})`;
      }).join('\n');
      
      return `Agenda para el día ${input.date}:\n${busySlots}\nPor favor sugiere un horario que NO se superponga con estos eventos.`;
    } catch (e: any) {
      if (e.message.includes('not connected')) {
        return "El agente no tiene su Google Calendar conectado. Puedes asumir que tiene disponibilidad basada en los horarios locales mencionados en el prompt.";
      }
      return `Error al consultar la disponibilidad: ${e.message}`;
    }
  }
);

/**
 * HERRAMIENTA: Actualizar Estatus del Lead
 */
const updateLeadStatusTool = ai.defineTool(
    {
        name: 'updateLeadStatus',
        description: `CRÍTICO PARA SEMINARIOS: Cambia el estatus logístico del lead basado en su intención. 
        Estatus permitidos:
        - '${LEAD_STATUS.CONFIRMED}': ÚNICAMENTE si el lead confirma explícitamente que asistirá.
        - '${LEAD_STATUS.ABSENT}': Si el lead dice que NO asistirá o pide cancelar.
        - '${LEAD_STATUS.CONVERSATION}': Si el lead tiene dudas, hace preguntas o su respuesta es ambigua.
        - '${LEAD_STATUS.ATTENDED}': Solo si el lead confirma que ya está en el evento.
        - '${LEAD_STATUS.RESCHEDULED}': Si pide cambiar de fecha.`,
        inputSchema: z.object({
            userId: z.string(),
            leadId: z.string(),
            newStatus: z.enum([LEAD_STATUS.REGISTERED, LEAD_STATUS.CONFIRMED, LEAD_STATUS.ATTENDED, LEAD_STATUS.ABSENT, LEAD_STATUS.RESCHEDULED, LEAD_STATUS.CONVERSATION])
        }),
    },
    async (input) => {
        const res = await updateLeadStatusAction(input.userId, input.leadId, input.newStatus);
        return res.success ? `ÉXITO: El estatus ha sido actualizado a ${input.newStatus}.` : "ERROR: No se pudo actualizar el estatus.";
    }
);

/**
 * HERRAMIENTA: Rechazar Lead (Deal Perdido)
 */
const rejectLeadTool = ai.defineTool(
    {
        name: 'rejectLead',
        description: `CRÍTICO: Utiliza esta herramienta si el lead rechaza explícitamente el contacto o muestra intención de no ser molestado (ej. "no me interesa", "no molestar", "número equivocado", "deja de escribirme", "stop"). Esto marcará al lead como 'Deal Perdido' y desactivará el seguimiento automático.`,
        inputSchema: z.object({
            userId: z.string().describe('ID del usuario/agente'),
            leadId: z.string().describe('ID del lead'),
            reason: z.string().describe('Motivo breve del rechazo detectado (ej. "No interesado", "Equivocado")')
        }),
    },
    async (input) => {
        const { adminDb } = getAdminSDK();
        let leadRef = adminDb.collection('leads').doc(input.leadId);
        let leadDoc = await leadRef.get();
        
        if (!leadDoc.exists) {
            leadRef = adminDb.collection('users').doc(input.userId).collection('seminarLeads').doc(input.leadId);
            leadDoc = await leadRef.get();
        }

        if (leadDoc.exists) {
            await leadRef.update({ 
                status: LEAD_STATUS.LOST, 
                nogoStatus: LEAD_STATUS.LOST,
                botEnabled: false,
                lostReason: input.reason,
                updatedAt: new Date()
            });
            return `ÉXITO: Lead marcado como Deal Perdido y bot desactivado. Razón: ${input.reason}`;
        }
        return "ERROR: No se encontró el lead para rechazar.";
    }
);

/**
 * HERRAMIENTA: Programar Próxima Acción Esperada (Autonomía AI)
 */
const scheduleNextActionTool = ai.defineTool(
  {
    name: 'scheduleNextAction',
    description: 'Programa la próxima acción sugerida o acordada con el lead y pausa secuencias automáticas rígidas.',
    inputSchema: z.object({
      userId: z.string().describe('ID del usuario/agente (ownerId)'),
      leadId: z.string().describe('ID del lead'),
      actionDescription: z.string().describe('Descripción de la acción sugerida (ej. "Llamar al cliente")'),
      scheduledTime: z.string().describe('Fecha/hora sugerida por el cliente o del contacto en formato ISO 8601 (ej. "2026-06-23T15:00:00.000Z")')
    }),
  },
  async (input) => {
    try {
      const { adminDb } = getAdminSDK();
      let leadRef = adminDb.collection('leads').doc(input.leadId);
      let leadDoc = await leadRef.get();
      
      if (!leadDoc.exists) {
        leadRef = adminDb.collection('users').doc(input.userId).collection('seminarLeads').doc(input.leadId);
        leadDoc = await leadRef.get();
      }

      if (leadDoc.exists) {
        await leadRef.update({
          nextAction: {
            description: input.actionDescription,
            scheduledTime: input.scheduledTime
          },
          pauseStaticSequence: true,
          nextWatchdogRun: new Date(input.scheduledTime),
          updatedAt: new Date()
        });
        return `ÉXITO: Se ha programado la próxima acción "${input.actionDescription}" para ${input.scheduledTime} y se han pausado las secuencias automáticas rígidas.`;
      }
      return "ERROR: No se encontró el lead para programar la próxima acción.";
    } catch (e: any) {
      return `ERROR al programar próxima acción: ${e.message}`;
    }
  }
);


export const aiChatResponderFlow = ai.defineFlow(
  {
    name: 'aiChatResponderFlow',
    inputSchema: z.object({
      userId: z.string(),
      leadId: z.string(),
      leadName: z.string(),
      buyerPersona: z.string(),
      chatHistory: z.string(),
      agentName: z.string().default('tu agente'),
      leadContext: z.string().optional(),
      inventory: z.string().optional(),
      systemLanguage: z.string().optional(), // NUEVO: Idioma del sistema
      leadStatus: z.string().optional(), // NUEVO: Estatus del lead
      isWatchdog: z.boolean().optional(), // NUEVO: Indica si es un seguimiento automático
    }),
    outputSchema: z.string(),
  },
  async (input: any) => {
    const { adminDb } = getAdminSDK();
    const userDoc = await adminDb.collection('users').doc(input.userId).get();
    const ownerId = userDoc.data()?.parentId || input.userId;
    
    // Extraer configuración e historial de llamadas en paralelo
    const [configDoc, bizDoc, callsRes, propsSnap, offersSnap] = await Promise.all([
        adminDb.collection('users').doc(ownerId).collection('config').doc('ai_persona').get(),
        adminDb.collection('users').doc(ownerId).collection('config').doc('business_profile').get(),
        getLocalCalls(ownerId),
        adminDb.collection('properties').where('ownerId', '==', ownerId).limit(10).get(),
        adminDb.collection('financing_programs').where('ownerId', '==', ownerId).limit(10).get()
    ]);

    const aiConfig = configDoc.data() || {};
    const biz = bizDoc.data() || {};
    
    // Preparar contexto de inventario (Limpio para tokens)
    const propertiesText = propsSnap.docs.map(doc => {
       const d = doc.data();
       return `- ${d.title}: $${d.price} en ${d.address}. ${d.bedrooms}hab/${d.bathrooms}ba. ${d.description?.substring(0, 100)}...`;
    }).join('\n');

    const offersText = offersSnap.docs.map(doc => {
       const d = doc.data();
       return `- ${d.name} (${d.type}): ${d.description?.substring(0, 150)}`;
    }).join('\n');

    const inventoryContext = `
    ### INVENTARIO DISPONIBLE ###
    PROPIEDADES:
    ${propertiesText || 'No hay propiedades registradas actualmente.'}

    PROGRAMAS Y OFERTAS:
    ${offersText || 'No hay programas de financiamiento registrados actualmente.'}
    `;
    
    const general = aiConfig.general || aiConfig || {};
    const buyer = aiConfig.buyer_profile || {};
    const seller = aiConfig.seller_profile || {};
    const prompts = aiConfig.prompts || {};

    const botName = general.botName || 'Asistente';
    const realtorName = general.realtorName || input.agentName;

    const activeLocations = (biz?.locations || [])
        .filter((loc: any) => loc.isActive)
        .map((loc: any, index: number) => `${index + 1}. ${loc.name} ${loc.addressOrLink ? `(${loc.addressOrLink})` : ''}`)
        .join('\n');
    
    const locationsText = activeLocations || '1. Llamada telefónica o Videollamada';
    const fechaActual = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // NUEVO: Procesar horarios ocupados
    let busySlotsText = 'No hay citas programadas, tienes total disponibilidad.';
    if (callsRes.success && callsRes.calls) {
        const now = new Date();
        const upcoming = callsRes.calls.filter((c: any) => new Date(`${c.date}T${c.time}`) > now);
        if (upcoming.length > 0) {
            busySlotsText = upcoming.map((c: any) => `- ${c.date} a las ${c.time}`).join('\n');
        }
    }

    const currentStatus = input.leadStatus || LEAD_STATUS.TO_CONTACT;
    
    // Decidir qué instrucciones usar según si es Chat o Watchdog
    const instructionType = input.isWatchdog ? 'followUp' : 'chat';
    
    let finalSystemPrompt = '';

    // --- BIFURCACIÓN DE LA INTELIGENCIA: SEMINARIO VS VENTAS ---
    if (input.buyerPersona === 'Seminario' || input.leadContext?.includes('Seminario')) {
        // MODO SEMINARIO: Foco Logístico
        const seminarDoc = await adminDb.collection('users').doc(ownerId).collection('config').doc('seminar_setup').get();
        const sem = seminarDoc.data() || {};
        
        let friendlyDate = sem.date || 'Por definir';
        if (sem.date && sem.date.includes('-')) {
            const parts = sem.date.split('-');
            if (parts.length === 3) {
                const [y, m, d] = parts;
                const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                const monthName = months[parseInt(m) - 1];
                friendlyDate = `${parseInt(d)} de ${monthName}`;
            }
        }
        
        finalSystemPrompt = `
        Eres ${botName}, el asistente virtual de ${realtorName}, encargado de atender a los inscritos del seminario "${sem.eventName || 'Inmobiliario'}".
        
        ${input.leadContext ? `El lead acaba de llenar un formulario con esta información: ${input.leadContext}. Si estás iniciando la conversación, usa estos datos sutilmente para personalizar tu saludo y demostrar que hemos leído su solicitud.` : ''}

        ### 📅 DATOS DEL EVENTO (TU ÚNICA FUENTE DE VERDAD) ###
        - Evento: ${sem.eventName || 'Seminario para Compradores'}
        - Presentador: ${sem.presenterName || realtorName}
        - Fecha: ${friendlyDate} (REGLA ABSOLUTA: Debes responder que el seminario se llevará a cabo el ${friendlyDate}. Si te preguntan cuándo es, responde EXACTAMENTE esta fecha.)
        - Horario: ${sem.timeStart || '??'} a ${sem.timeEnd || '??'}
        - Modalidad: ${sem.modality || 'Virtual (Zoom)'}
        - Ubicación/Link: ${sem.locationDetails || 'Se enviará por este medio el día del evento'}
        - Temas: ${sem.mainTopics || 'Estrategias de compra, crédito y mercado.'}
        - Regalos/Rifas: ${sem.hasRaffles ? sem.raffleDetails : 'No aplica'}
        - Expertos Invitados: ${sem.hasGuests ? sem.guestDetails : 'No aplica'}
        
        ### 🎯 TU OBJETIVO ###
        Generar entusiasmo, confirmar asistencia y resolver dudas LOGÍSTICAS. 
        NO intentes vender casas, NO preguntes por FICO, NO pidas presupuesto. 

        ### 🔄 REGLAS ESTRICTAS DE PIPELINE (SEMINARIOS) ###
        Es OBLIGATORIO usar 'updateLeadStatus' para mover al lead según estas definiciones:
        1. '${LEAD_STATUS.REGISTERED}' (Reserva): Etapa inicial. NUNCA asignes esto manualmente.
        2. '${LEAD_STATUS.CONTACTED}' (Contactado): Ya se envió el primer mensaje.
        3. '${LEAD_STATUS.CONVERSATION}' (En conversación): Si el lead responde algo ambiguo, hace preguntas o no da una respuesta clara de confirmación.
        4. '${LEAD_STATUS.CONFIRMED}' (Confirmación): ÚNICAMENTE cuando el lead dice explícitamente que SÍ asistirá. [EJECUTA TOOL AQUÍ]
        5. '${LEAD_STATUS.ATTENDED}' (Asistió): Solo si el lead confirma que está presente en el evento.
        6. '${LEAD_STATUS.ABSENT}' (No asistió / Cancelado): Cuando el lead dice explícitamente que NO irá o pide cancelar. [EJECUTA TOOL AQUÍ]
        
        REGLA DE ORO: No basta con decir "entendido", debes ejecutar la herramienta para que el sistema se actualice.
        Siempre confirma al usuario que has actualizado su registro.

        1. Sé cálido y servicial.
        2. Solo 1 pregunta por mensaje.
        3. No uses herramientas de agendar citas de ventas, la "cita" ya es el seminario.
        4. SEGUIMIENTO FUTURO: Si el lead pide ser contactado más tarde, otro día, o en una fecha/hora futura específica, DEBES utilizar la herramienta 'scheduleNextAction' para registrar la próxima acción y pausar los seguimientos rígidos.
        `;
    } else {
        // MODO VENTAS: Foco Comercial (Código original)
        const mainCustomPrompt = prompts[instructionType] || '';
        const statusInstructions = (prompts.statusInstructions?.[currentStatus] as any)?.[instructionType] || 
                                 (typeof prompts.statusInstructions?.[currentStatus] === 'string' ? prompts.statusInstructions[currentStatus] : '');

        const isBuyer = input.buyerPersona?.toLowerCase().includes('comprar') || input.buyerPersona?.toLowerCase().includes('buyer');
        const isSeller = input.buyerPersona?.toLowerCase().includes('vender') || input.buyerPersona?.toLowerCase().includes('seller');
        
        let personaFocusText = '';
        if (isBuyer) {
            personaFocusText = `ESTRATEGIA ESPECÍFICA (COMPRADOR):\nEl cliente está interesado en comprar. Enfócate en entender su búsqueda, ubicación deseada y presupuesto (FICO > ${buyer.minFico || 580}). NO preguntes por vender propiedades a menos que él lo mencione.`;
        } else if (isSeller) {
            personaFocusText = `ESTRATEGIA ESPECÍFICA (VENDEDOR):\nEl cliente está interesado en vender. Enfócate en conocer su propiedad actual, motivo de venta y urgencia (Equity esperado > ${seller.minEquity || 10}%). NO hables de opciones de compra a menos que quiera comprar después de vender.`;
        } else {
            personaFocusText = `ESTRATEGIA POR TIPO DE CLIENTE:\nPARA COMPRADORES: Conversar → Entender búsqueda → Presupuesto → Proceso → Llamada. (FICO > ${buyer.minFico || 580}).\nPARA VENDEDORES: Motivo de venta → Conocer propiedad → Proceso → Llamada. (Equity > ${seller.minEquity || 10}%).`;
        }

        finalSystemPrompt = `
        ### 🌍 REGLA DE IDIOMA ABSOLUTA (MULTILINGÜE) 🌍 ###
        ${input.systemLanguage ? `El idioma configurado para esta campaña es: ${input.systemLanguage}.` : 'El idioma por defecto es Español.'}
        PERO tu regla MÁS IMPORTANTE es: DETECTA EL IDIOMA del último mensaje del lead en el historial y RESPONDE EXACTAMENTE EN ESE MISMO IDIOMA. Si el lead escribe en Inglés → responde 100% en Inglés. Si escribe en Español → responde 100% en Español. Si escribe en Portugués → responde en Portugués. NUNCA cambies de idioma. Si no hay historial (primer mensaje), responde en ${input.systemLanguage || 'Español'}.

        Eres ${botName}, el asistente virtual inmobiliario oficial de ${realtorName}. 
        Tu tono de comunicación debe ser: ${general.tone || 'Empático, paciente, consultivo y profesional'}. 

        ${input.leadContext ? `El lead acaba de llenar un formulario con esta información: ${input.leadContext}. Si estás iniciando la conversación, usa estos datos sutilmente para personalizar tu saludo y demostrar que hemos leído su solicitud.` : ''}

        ${inventoryContext}
        ${mainCustomPrompt ? `### PERFIL DE PERSONALIDAD (${input.isWatchdog ? 'WATCHDOG' : 'CHAT'}) ###\n${mainCustomPrompt}\n` : ''}
        ${input.isWatchdog ? `### REGLA DE ESTADO (MODO PROSPECCIÓN) ###
        Estás iniciando el contacto o dando seguimiento proactivo. El lead aún no ha respondido. 
        Mantén un tono de "primer contacto" y NO asumas que ya hay una conversación fluida. 
        Evita dar por hecho que el cliente está escuchando en este momento.\n` : ''}

        ${statusInstructions ? `### REGLAS PARA ESTATUS ACTUAL: ${currentStatus} ###\n${statusInstructions}\n` : ''}

        NUNCA digas que eres una IA. Eres parte del equipo humano.

        ### 🚨 REGLAS CRÍTICAS CONVERSACIONALES (ANTI-BOT) 🚨 ###
        0. REGLA DE RESPUESTA OBLIGATORIA: Responde la duda ANTES de intentar agendar.
        1. PROHIBIDO PRESIONAR ("ANTI-PUSHY"): NO intentes agendar dos veces seguidas.
        2. MANEJO DE DESCONFIANZA: Si quieren hablar con un humano, baja la presión y explica que solo tomas notas para ${realtorName}.
        3. UNA SOLA PREGUNTA: Máximo 1 pregunta tuya por mensaje.
        4. VARIACIÓN OBLIGATORIA (ANTI-REPETITION): Analiza el 'chatHistory'. Si el último mensaje fue un seguimiento sin respuesta, este NUEVO mensaje debe ser fundamentalmente diferente en palabras y enfoque. PROHIBIDO repetir frases de bienvenida o pings idénticos.
        ${input.chatHistory ? '5. REGLA DE CONTINUIDAD: Ya has interactuado con este cliente. NO te presentes ni saludes de nuevo, continúa la conversación directamente.' : ''}
        6. RECHAZO EXPLÍCITO: Si el lead indica claramente que no está interesado, que es número equivocado o que no lo molesten, DEBES utilizar la herramienta 'rejectLead' para detener la automatización y despedirte cordialmente.
        7. SEGUIMIENTO FUTURO: Si el lead pide ser contactado más tarde, otro día, o especifica una fecha/hora de contacto futura, DEBES utilizar la herramienta 'scheduleNextAction' para programar la próxima acción y pausar los seguimientos automatizados automáticos temporales.

        ### 🛡️ REGLA DE ORO (ANTI-ABANDONO) 🛡️ ###
        NUNCA abandones la conversación ni transfieras a un humano tras la primera respuesta. Si el lead tiene intención mixta (ej. quiere comprar pero tiene dudas) o hace una pregunta, DEBES responderle y mantener viva la conversación.
        SOLO transfiere a un humano (human_handoff) si el lead dice explícitamente 'quiero hablar con un humano/asesor', o si está muy molesto.

        ### 🧠 ESTRATEGIA DE CONVERSIÓN 🧠 ###
        ${personaFocusText}

        ### ⏱️ CONTEXTO TEMPORAL Y UBICACIONES ###
        - FECHA ACTUAL: Hoy es ${fechaActual}. 
        - UBICACIONES DE CITAS: ${locationsText}

        ### 📅 EL CIERRE Y MANEJO DE AGENDA 📅 ###
        ${busySlotsText}
        Utiliza la herramienta 'bookAppointment' solo para confirmar citas en huecos libres.
        Debes pasar obligatoriamente estos IDs a la herramienta:
        - userId: ${ownerId}
        - leadId: ${input.leadId}
        - leadName: ${input.leadName}
        `;
    }

    // Convertir historial JSON a formato conversacional legible por el modelo para mejorar la detección de idioma
    let formattedHistory = '';
    try {
        const parsedHistory = JSON.parse(input.chatHistory);
        if (Array.isArray(parsedHistory)) {
            formattedHistory = parsedHistory.map((m: any) => {
                const sender = m.direction === 'inbound' ? 'Lead' : 'Asistente';
                return `${sender}: ${m.body || m.content || ''}`;
            }).join('\n');
        } else {
            formattedHistory = input.chatHistory;
        }
    } catch {
        formattedHistory = input.chatHistory;
    }

    const { text } = await ai.generate({
      model: 'googleai/gemini-2.5-flash',
      messages: [
        { role: 'user', content: [{ text: finalSystemPrompt }] },
        { role: 'user', content: [{ text: `Lead: ${input.leadName}. Contexto: ${input.buyerPersona}.\nHistorial:\n${formattedHistory}` }] }
      ],
      tools: [bookAppointmentTool, updateLeadStatusTool, checkCalendarAvailabilityTool, rejectLeadTool, scheduleNextActionTool]
    });

    return text;
  }
);