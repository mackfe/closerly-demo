'use server';
/**
 * @fileOverview Nogo OS Meta Ads Strategy Engine 2026.
 * Genera estrategias de marketing inmobiliario de alto nivel
 * con soporte para tone, CTA y conteo dinámico de creativos.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getAdminSDK } from '@/firebase/admin';

const AICampaignInputSchema = z.object({
  userId: z.string(),
  pilar: z.string(),
  categoria: z.string(),
  subcategoria: z.string(),
  mercado: z.string(),
  idioma: z.string(),
  precioMinimo: z.number(),
  precioMaximo: z.number(),
  ficoMinimo: z.number(),
  downPayment: z.number(),
  sitioWeb: z.string().optional(),
  objective: z.string().optional(),

  budget: z.number().default(20),
  duracion: z.string().default('continua'),
  targetAge: z.string().optional().default('General'),
  targetGender: z.string().optional().default('Todos'),

  tono: z.string().default('emocional'),
  cta: z.string().default('Learn More'),
  cantidadCreativos: z.number().default(3),
  estilosVisuales: z.array(z.string()).default([]),
});

const copyFromTone: Record<string, string> = {
  directo:
    'TONO DIRECTO: Mensajes claros y concisos. Ve al grano sin rodeos. Usa frases cortas e impactantes. Ej: "Deja de pagar renta. Compra tu casa hoy."',
  emocional:
    'TONO EMOCIONAL: Conecta con sueños, aspiraciones y emociones. Apela al corazón. Usa storytelling cálido. Ej: "Imagina despertar en la casa de tus sueños. Ese momento está más cerca de lo que crees."',
  profesional:
    'TONO PROFESIONAL: Establece autoridad y confianza. Lenguaje formal pero accesible. Usa datos y credibilidad. Ej: "Como especialistas certificados en el mercado de Miami, te guiamos en cada paso del proceso hipotecario."',
  casual:
    'TONO CASUAL: Amigable y cercano, como un amigo dando un consejo. Usa tú, lenguaje coloquial, emojis con moderación. Ej: "Oye! Sabías que podrías calificar para tu primera casa con solo 3.5% de enganche?"',
};

const AICampaignOutputSchema = z.object({
  objetivo: z
    .string()
    .describe('Objetivo principal de la campaña según el pilar.'),
  buyerPersona: z
    .string()
    .describe('Descripción psicológica y demográfica del cliente ideal.'),
  beneficiosClave: z
    .array(z.string())
    .describe('Lista de 3 a 4 beneficios clave a destacar.'),
  estrategiaAds: z.object({
    presupuestoSugerido: z.string(),
    segmentacion: z
      .string()
      .describe(
        'Segmentación recomendada en Meta Ads (Recordar Categoría Housing).'
      ),
    formatoRecomendado: z.string(),
  }),
  copys: z
    .array(
      z.object({
        angulo: z
          .string()
          .describe('El ángulo del copy (Ej: Educativo, FOMO, Dolor).'),
        headline: z
          .string()
          .describe('Titular gancho (Corto y directo, 5-10 palabras).'),
        body: z
          .string()
          .describe(
            'Cuerpo del anuncio, persuasivo y alineado al tono indicado.'
          ),
        callToAction: z.string(),
        promptsVisuales: z
          .array(z.string())
          .length(5)
          .describe(
            'Exactamente 5 prompts MUY largos y detallados EN INGLÉS para generar imágenes con IA.'
          ),
      })
    )
    .describe(
      'Generar exactamente la cantidad de variaciones indicada en cantidadCreativos.'
    ),
  formularioMeta: z.object({
    encabezado: z.string(),
    descripcion: z.string(),
    preguntas: z
      .array(
        z.object({
          titulo: z.string(),
          opciones: z.array(z.string()),
          opcionesDescalificadoras: z
            .array(z.string())
            .describe('Cuáles de las opciones descalifican al lead.'),
        })
      )
      .describe('Preguntas clave de perfilamiento.'),
    mensajeCalificado: z.string(),
    mensajeDescalificado: z.string(),
  }),
  friendlySummary: z
    .string()
    .optional()
    .describe('Un resumen amigable para el agente.'),
  ads: z
    .array(
      z.object({
        headline: z.string(),
        primaryText: z.string(),
        creativeConcept: z.string(),
      })
    )
    .optional(),
});

export const aiCampaignBuilderFlow = ai.defineFlow(
  {
    name: 'aiCampaignBuilderFlow',
    inputSchema: AICampaignInputSchema,
    outputSchema: AICampaignOutputSchema,
  },
  async (input) => {
    const { adminDb } = getAdminSDK();
    const userDoc = await adminDb
      .collection('users')
      .doc(input.userId)
      .get();
    const userData = userDoc.data() || {};
    const agentName = userData.firstName || 'Agente';

    let knowledgeBase = '';
    switch (input.pilar) {
      case 'Primeros Compradores':
        knowledgeBase = `PILAR 1: PRIMEROS COMPRADORES. Subcategoría: ${input.subcategoria}. Foco en dejar de pagar renta. IDEAS VISUALES: Pantallas divididas (Renta vs Propiedad). Rango de precio: $${input.precioMinimo.toLocaleString()} – $${input.precioMaximo.toLocaleString()}.`;
        break;
      case 'Sellers (Vendedores)':
        knowledgeBase = `PILAR 2: SELLERS. Subcategoría: ${input.subcategoria}. Habla de "Tu casa, tu equity". IDEAS VISUALES: Casas con letreros de "SOLD". Rango de precio: $${input.precioMinimo.toLocaleString()} – $${input.precioMaximo.toLocaleString()}.`;
        break;
      case 'Inversionistas Extranjeros':
        knowledgeBase = `PILAR 3: INVERSIONISTAS EXTRANJEROS. Subcategoría: ${input.subcategoria}. Lenguaje financiero: ROI, Cap Rate. IDEAS VISUALES: Edificios de lujo, billetes. Rango de precio: $${input.precioMinimo.toLocaleString()} – $${input.precioMaximo.toLocaleString()}.`;
        break;
      case 'Upgrade Buyers':
        knowledgeBase = `PILAR 4: UPGRADE BUYERS. Subcategoría: ${input.subcategoria}. Quieren casa más grande. IDEAS VISUALES: Pantalla dividida de casa pequeña vs mansión. Rango de precio: $${input.precioMinimo.toLocaleString()} – $${input.precioMaximo.toLocaleString()}.`;
        break;
      case 'Nuevas Construcciones':
        knowledgeBase = `PILAR 5: NUEVAS CONSTRUCCIONES. Subcategoría: ${input.subcategoria}. Foco en incentivos. IDEAS VISUALES: Diseños con estilo neón, cuadrículas mostrando 4 casas. Rango de precio: $${input.precioMinimo.toLocaleString()} – $${input.precioMaximo.toLocaleString()}.`;
        break;
      default:
        knowledgeBase = `Actúa como un estratega de Meta Ads Inmobiliario senior. Pilar: ${input.pilar}. Subcategoría: ${input.subcategoria}. Categoría: ${input.categoria}. Rango de precio: $${input.precioMinimo.toLocaleString()} – $${input.precioMaximo.toLocaleString()}.`;
    }

    const ownerId = userData.parentId || input.userId;
    const userRulesDoc = await adminDb
      .collection('users')
      .doc(ownerId)
      .collection('config')
      .doc('marketing_rules')
      .get();

    let dynamicRules: any;

    if (userRulesDoc.exists) {
      dynamicRules = userRulesDoc.data();
    } else {
      const globalRulesDoc = await adminDb
        .doc('config/marketing_rules')
        .get();
      dynamicRules = globalRulesDoc.exists
        ? globalRulesDoc.data()
        : {
            budgetThreshold: 25,
            imageSystemPrompt:
              'Generate a high-quality real estate advertisement image. Style: modern, clean, aspirational.',
            negativePrompt:
              'No stock photo watermarks, no clipart, no distortions.',
            copyRules:
              '- Escribir siempre en español informal (tuteo)\n- Máximo 4-5 oraciones por caption',
          };
    }

    const threshold = dynamicRules?.budgetThreshold || 25;
    const count = input.cantidadCreativos || 3;

    const budgetRule =
      input.budget < threshold
        ? `REGLA DE FORMULARIO (THRESHOLD < $${threshold}): El presupuesto del cliente es BAJO ($${input.budget}/día). NO incluyas ninguna pregunta de perfilamiento en el array 'preguntas' del formularioMeta. Necesitamos un formulario de baja fricción para obtener volumen.`
        : `REGLA DE FORMULARIO (THRESHOLD >= $${threshold}): El presupuesto del cliente es ALTO ($${input.budget}/día). DEBES incluir exactamente 2 preguntas de perfilamiento en el array 'preguntas' del formularioMeta para filtrar a los leads curiosos.`;

    const toneInstruction =
      copyFromTone[input.tono] || copyFromTone.emocional;

    const ctaInstruction = `BOTÓN CTA DEL ANUNCIO: Todos los copys deben usar el CTA "${input.cta}". El texto del anuncio debe guiar naturalmente al lector hacia esa acción.`;

    const styleHints =
      input.estilosVisuales && input.estilosVisuales.length > 0
        ? `ESTILOS VISUALES SOLICITADOS: ${input.estilosVisuales.join(', ')}. Los prompts visuales deben reflejar estos estilos.`
        : 'ESTILOS VISUALES: Usa tu criterio profesional para elegir los mejores estilos visuales.';

    const systemPrompt = `
Eres el "Nogo OS Meta Ads Strategy Engine 2026", un estratega digital y Director de Arte Gráfico de talla mundial.
Estás creando una campaña para el agente ${agentName} en el mercado de ${input.mercado}.

PERFIL PSICOLÓGICO OBJETIVO (APLÍCALO AL REDACTAR LOS COPYS):
- Edad Objetivo: ${input.targetAge}
- Género Objetivo: ${input.targetGender}
- Idioma de la campaña: ${input.idioma}
Debes escribir los copys (textos del anuncio) para que resuenen fuertemente con este rango de edad y género específico, PERO NUNCA menciones que los estamos filtrando por eso.

DIRECCIÓN DE TONO Y VOZ:
${toneInstruction}

${ctaInstruction}

${styleHints}

REGLAS DE DIRECCIÓN DE ARTE (PROMPTS VISUALES):
${dynamicRules?.imageSystemPrompt || ''}
${dynamicRules?.negativePrompt ? `NEGATIVE PROMPT (EVITAR): ${dynamicRules.negativePrompt}` : ''}

DEBES ESCRIBIR LOS PROMPTS ESTRICTAMENTE EN INGLÉS, pero el texto que le pides al modelo que escriba en la imagen debe estar en el idioma solicitado por el usuario (${input.idioma}).

ESTRUCTURA OBLIGATORIA DEL PROMPT VISUAL:
[Ad format & vibe] + [Background Image Description] + [Graphic Overlays & Layout] + [Typography exact text in ${input.idioma}] + [Color Scheme].

REGLAS DE COPYWRITING (CONTROL ADMINISTRATIVO):
${dynamicRules?.copyRules || '- Mensaje persuasivo y directo.'}

REGLAS INVIOLABLES DEL SISTEMA MAESTRO:
1. NUNCA prometas aprobaciones ni tasas fijas.
2. Usa Categoría Especial de Vivienda (Housing).
3. Ruteo Bifurcado basado en FICO: ${input.ficoMinimo}, Down: ${input.downPayment}, Precio: ${input.precioMinimo}–${input.precioMaximo}.
4. ${budgetRule}

KNOWLEDGE BASE APLICADA HOY:
${knowledgeBase}
`;

    const { output } = await ai.generate({
      system: systemPrompt,
      prompt: `Crea la estrategia de campaña y dirección de arte completa para el pilar: ${input.pilar}. Genera exactamente ${count} variaciones de copy (ni una más, ni una menos). Cada copy debe usar el tono "${input.tono}" y el CTA "${input.cta}".`,
      output: { schema: AICampaignOutputSchema },
    });

    return output!;
  }
);
