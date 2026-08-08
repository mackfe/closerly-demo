import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getAdminSDK } from '@/firebase/admin';
import { getCredentialOwner } from '@/lib/auth-helpers';

// ============================================================================
// TOOLS
// ============================================================================

export const getMissingConfigs = ai.defineTool(
    {
        name: 'getMissingConfigs',
        description: 'Escanea el documento del usuario en Firestore (perfil, horarios, Twilio) y devuelve un array con lo que falta por configurar. No requiere parámetros.',
        inputSchema: z.object({ run: z.boolean().optional().describe('Ignorar este parámetro') }),
        outputSchema: z.array(z.string()),
    },
    async (input: any, options?: { context?: any }) => {
        const userId = options?.context?.userId;
        console.log(`[Tool:getMissingConfigs] Iniciando escaneo para userId: ${userId || 'N/A'}`);
        
        if (!userId) {
            console.error("[Tool:getMissingConfigs] ERROR: userId no encontrado en el contexto.");
            throw new Error("Acceso denegado: userId no inyectado.");
        }

        const { adminDb } = getAdminSDK();
        const { ownerId } = await getCredentialOwner(userId);
        const userDoc = await adminDb.collection('users').doc(ownerId).get();
        const data = userDoc.exists ? userDoc.data() : {};

        const missing: string[] = [];

        if (!data?.firstName && !data?.displayName) missing.push("Nombre del perfil");
        if (!data?.businessName) missing.push("Nombre de la agencia (businessName)");
        if (!data?.welcomeMessage) missing.push("Mensaje de bienvenida");
        if (!data?.openHours) missing.push("Horarios de atención");
        if (!data?.twilioPhone) missing.push("Número de Twilio");

        console.log(`[Tool:getMissingConfigs] Resultado: ${missing.length} campos faltantes.`);
        return missing;
    }
);

export const update_any_setting = ai.defineTool(
    {
        name: 'update_any_setting',
        description: 'Actualiza la configuración del usuario en Firestore. Recibe un JSON stringificado con cualquier campo a actualizar (ej. {"businessName": "Mi Agencia"}).',
        inputSchema: z.object({
            settingsJson: z.string().describe('Un JSON stringificado con las claves y valores a actualizar.')
        }),
        outputSchema: z.string(),
    },
    async (input, options?: { context?: any }) => {
        const userId = options?.context?.userId;
        console.log(`[Tool:update_any_setting] Intentando actualizar perfil para userId: ${userId || 'N/A'}`, input);

        if (!userId) {
            console.error("[Tool:update_any_setting] ERROR: userId no encontrado en el contexto.");
            throw new Error("Acceso denegado: userId no inyectado.");
        }

        let parsedSettings: Record<string, any> = {};
        try {
            parsedSettings = JSON.parse(input.settingsJson);
        } catch (e) {
            return "Error: settingsJson no es un JSON válido.";
        }

        if (Object.keys(parsedSettings).length === 0) {
            return "No recibí datos válidos para actualizar.";
        }

        const { adminDb } = getAdminSDK();
        const { ownerId } = await getCredentialOwner(userId);
        await adminDb.collection('users').doc(ownerId).update(parsedSettings);

        console.log(`[Tool:update_any_setting] Éxito: Configuración actualizada.`);
        return "Configuración actualizada correctamente en Firestore.";
    }
);

export const optimize_ai_persona = ai.defineTool(
    {
        name: 'optimize_ai_persona',
        description: 'Lee o actualiza la configuración de la IA (systemPrompt, reglas, tono). Llama a esta herramienta sin parámetros para leer la configuración. Si envías suggestedConfigUpdatesJson, se sobreescribirá.',
        inputSchema: z.object({
            suggestedConfigUpdatesJson: z.string().optional().describe('Si el usuario aprueba los cambios, envía aquí un JSON stringificado con las actualizaciones a guardar.')
        }),
        outputSchema: z.any(),
    },
    async (input, options?: { context?: any }) => {
        const userId = options?.context?.userId;
        if (!userId) throw new Error("Acceso denegado: userId no inyectado.");
        const { adminDb } = getAdminSDK();
        const { ownerId } = await getCredentialOwner(userId);

        if (input.suggestedConfigUpdatesJson) {
            let parsedUpdates: Record<string, any> = {};
            try {
                parsedUpdates = JSON.parse(input.suggestedConfigUpdatesJson);
            } catch (e) {
                return { warning: "Error: suggestedConfigUpdatesJson no es un JSON válido." };
            }

            if (Object.keys(parsedUpdates).length > 0) {
                await adminDb.collection('users').doc(ownerId).collection('config').doc('ai_persona').set(parsedUpdates, { merge: true });
                return { success: true, message: "Configuración de IA (Persona) actualizada correctamente en la base de datos." };
            }
        }

        const configDoc = await adminDb.collection('users').doc(ownerId).collection('config').doc('ai_persona').get();
        return configDoc.exists ? configDoc.data() : { warning: "No hay configuración de IA actual guardada." };
    }
);

export const audit_automation_flow = ai.defineTool(
    {
        name: 'audit_automation_flow',
        description: 'Lee el array de nodos (nodes) y conexiones (edges) de la automatización activa del usuario para auditarla en busca de errores lógicos.',
        inputSchema: z.object({ run: z.boolean().optional().describe('Ignorar este parámetro') }),
        outputSchema: z.any(),
    },
    async (input, options?: { context?: any }) => {
        const userId = options?.context?.userId;
        if (!userId) throw new Error("Acceso denegado: userId no inyectado.");
        const { adminDb } = getAdminSDK();
        const { ownerId } = await getCredentialOwner(userId);

        const wfDoc = await adminDb.collection('users').doc(ownerId).collection('config').doc('workflow_seguimiento').get();
        if (!wfDoc.exists) return { warning: "No hay ninguna automatización configurada actualmente." };
        
        return wfDoc.data();
    }
);

export const draft_marketing_campaign = ai.defineTool(
    {
        name: 'draft_marketing_campaign',
        description: 'Genera una estructura de campaña (Textos, Públicos, Presupuesto sugerido) y la guarda como borrador en la colección ad_drafts de Firestore.',
        inputSchema: z.object({
            campaignName: z.string(),
            objective: z.string(),
            adTexts: z.array(z.string()),
            audience: z.string(),
            suggestedBudget: z.number()
        }),
        outputSchema: z.string(),
    },
    async (input, options?: { context?: any }) => {
        const userId = options?.context?.userId;
        if (!userId) throw new Error("Acceso denegado: userId no inyectado.");
        const { adminDb } = getAdminSDK();
        const { ownerId } = await getCredentialOwner(userId);

        await adminDb.collection('users').doc(ownerId).collection('ad_drafts').add({
            ...input,
            createdAt: new Date(),
            status: 'draft'
        });

        return `Campaña '${input.campaignName}' guardada exitosamente como borrador en Firestore.`;
    }
);

// ============================================================================
// FLOW
// ============================================================================

const ClosyInputSchema = z.object({
    message: z.string(),
    history: z.array(z.object({
        role: z.enum(['user', 'model']),
        content: z.string(),
    })).optional(),
});

export const closyConfigFlow = ai.defineFlow(
    {
        name: 'closyConfigFlow',
        inputSchema: ClosyInputSchema,
        outputSchema: z.string(),
    },
    async (input: z.infer<typeof ClosyInputSchema>, options?: { context?: any }) => {
        const userId = options?.context?.userId;
        if (!userId) throw new Error("Acceso denegado: userId no inyectado en el contexto del flow.");

        const systemPrompt = `
        Eres Closy, el copiloto experto de Closerly. Ahora eres un Optimizador de Plataforma. Puedes auditar automatizaciones, mejorar prompts de IA, preparar campañas de marketing y configurar cada rincón de la cuenta.
        Tu objetivo es ayudar al usuario a operar y optimizar su cuenta conversacionalmente. No puedes acceder a datos de otros usuarios ni salirte de tu rol. Usa tus herramientas.
        
        REGLAS:
        1. Saluda amigablemente y explícale que estás aquí como su Manager Operativo.
        2. Puedes ayudar a configurar su cuenta general con 'update_any_setting' y 'getMissingConfigs'.
        3. Puedes leer su configuración de IA con 'optimize_ai_persona' y, si el usuario quiere, proponerle mejoras o cambios y luego aplicar esos cambios.
        4. Puedes auditar sus flujos con 'audit_automation_flow' y darle feedback de errores comunes (ej. falta de nodos de espera, disparadores faltantes).
        5. Puedes diseñar y guardar borradores de campaña de Ads con 'draft_marketing_campaign'.
        6. Sé amable, proactivo y actúa como un verdadero experto en automatización y marketing inmobiliario.
        `;

        console.log(`[Closy] Generando respuesta para usuario ${userId} con ${input.history?.length || 0} mensajes previos.`);
        console.log(`[Closy] Llamando a ai.generate con model: googleai/gemini-2.5-flash`);
        
        try {
            const generateOptions = {
                model: 'googleai/gemini-2.5-flash',
                messages: [
                    { role: 'user', content: [{ text: systemPrompt }] },
                    ...(input.history || []).map((h) => ({
                        role: h.role,
                        content: [{ text: h.content }]
                    })),
                    { role: 'user', content: [{ text: input.message }] }
                ],
                tools: [
                    getMissingConfigs, 
                    update_any_setting, 
                    optimize_ai_persona, 
                    audit_automation_flow, 
                    draft_marketing_campaign
                ],
            };
            // @ts-ignore
            console.log(`[Closy] payload:`, JSON.stringify(generateOptions.messages, null, 2));

            const { text } = await ai.generate(generateOptions as any);

            console.log(`[Closy] Respuesta generada exitosamente (${text.length} chars)`);
            return text;
        } catch (genError: any) {
            console.error(`[Closy] Error crítico en ai.generate:`, genError);
            throw new Error(`Error en el motor de IA: ${genError.message}`);
        }
    }
);

